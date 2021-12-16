import sys

from flask import Flask
from utils import random_hex_32

app = Flask("AnoMe")
app.secret_key = random_hex_32()
app.debug = True

from database import db
from models import QA, Likes

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///example_db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = True
db.init_app(app)
with app.app_context():
    db.create_all()

from flask_admin import Admin
from flask_admin.menu import MenuLink
from auth import AnoMeView, AnoMeAdminIndexView, AnoMeAllQaView, AnoMeEmptyQaView, AnoMePublicQaView, AnoMePrivateQaView

app.config["FLASK_ADMIN_SWATCH"] = "cerulean"
admin = Admin(app, name="AnoMe", template_mode="bootstrap4", index_view=AnoMeAdminIndexView(
    name="Dashboard",
    template="admin_index.html",
    url="/admin"
))
with app.app_context():
    admin.add_view(AnoMeAllQaView(QA, db.session, name="AllQuestion", endpoint="/all_questions"))
    admin.add_view(AnoMeEmptyQaView(QA, db.session, name="ToAnswer", endpoint="/to_answer"))
    admin.add_view(AnoMePublicQaView(QA, db.session, name="Public", endpoint="/public_answer"))
    admin.add_view(AnoMePrivateQaView(QA, db.session, name="Private", endpoint="/private_answer"))
    admin.add_view(AnoMeView(Likes, db.session, name="Likes", endpoint="/likes"))
    admin.add_link(MenuLink(name='Back to Home', category='', url="/"))
    admin.add_link(MenuLink(name='Logout', category='', url="/logout"))

from flask import request, render_template, redirect, session
from config import ADMIN_PASSWORD
from utils import session_secret, refresh_session_secret
from hashlib import md5
from i18n import i18n

lang = "EN-US"
if len(sys.argv) > 1:
    lang = sys.argv[1]


@app.route("/", methods=["GET"])
def index():
    data = QA.query.filter(QA.answer != None).filter(QA.is_public == True) \
        .outerjoin(Likes, QA.id == Likes.QA_id).add_entity(Likes) \
        .order_by(Likes.likes.desc(), QA.id.desc()) \
        .all()
    return render_template("index.html", data=data, i18n_t=i18n(lang))


@app.route("/question", methods=["POST"])
def question():
    data = QA.query.filter(QA.answer != None).filter(QA.is_public == True) \
        .outerjoin(Likes, QA.id == Likes.QA_id).add_entity(Likes) \
        .order_by(Likes.likes.desc(), QA.id.desc()) \
        .all()
    question = request.form.get("question", "")
    if not question:
        return render_template("index.html", question_error=i18n(lang, "empty question"),
                               data=data, i18n_t=i18n(lang))
    secret = random_hex_32()
    if QA.query.filter(QA.answer == None).filter(QA.question == question).count() != 0:
        return render_template("index.html", question_error=i18n(lang, "same question"), data=data, i18n_t=i18n(lang))
    qa = QA(question=question, secret=secret)
    db.session.add(qa)
    db.session.commit()
    return render_template("index.html", secret_code=secret, data=data, i18n_t=i18n(lang))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        login_url = request.full_path
        return render_template("login.html", login_url=login_url, i18n_t=i18n(lang))
    if request.method == "POST":
        password = request.form.get("password", None)
        if password is not None and md5(password.encode("utf8")).hexdigest() == ADMIN_PASSWORD:
            session["admin"] = session_secret["admin"]
            print("set admin", session_secret["admin"])
            next_url = request.args.get("next", default="/")
            return redirect(next_url)
        return render_template("login.html", error=i18n(lang, "wrong password"), i18n_t=i18n(lang))


@app.route("/logout", methods=["GET"])
def logout():
    if session.get("admin", "") == session_secret["admin"]:
        refresh_session_secret()
    return redirect("/")


@app.route("/like", methods=["GET"])
def like():
    qa_id = request.args.get("q", default=None)
    operator = request.args.get("op", default="1")  # like
    if qa_id is None:
        return "0"
    if operator not in "01":
        return "0"
    likes = Likes.query.filter(Likes.QA_id == qa_id).one_or_none()
    if likes is None:
        if operator == "1":
            new_likes = Likes(QA_id=qa_id, likes=1)
            db.session.add(new_likes)
            db.session.commit()
            return "1"
        else:
            return "0"
    else:
        if operator == "1":
            likes.likes += 1
            db.session.commit()
        else:
            if likes.likes > 0:
                likes.likes -= 1
                db.session.commit()
        return str(likes.likes)


@app.route("/secret", methods=["GET"])
def show_secret():
    secret = request.args.get("s", default=None)
    if secret is None:
        return render_template("secret.html", question="", i18n_t=i18n(lang))
    data = QA.query \
        .filter(QA.secret == secret) \
        .outerjoin(Likes, QA.id == Likes.QA_id) \
        .add_entity(Likes) \
        .all()
    if len(data) == 0:
        return render_template("secret.html", secret_error=i18n(lang, "no secret"), question="", i18n_t=i18n(lang))
    question = data[0].QA.question
    is_public = data[0].QA.is_public
    is_public = {True: i18n(lang, "published"), False: i18n(lang, "private")}.get(is_public)
    answer = data[0].QA.answer
    is_public = i18n(lang, "no answer") if answer is None else is_public
    answer = "" if answer is None else answer
    if data[0].QA.answer_timestamp is not None:
        timestamp_str = data[0].QA.answer_timestamp.strftime("%Y-%m-%d %H:%M:%S")
    else:
        timestamp_str = ""
    if data[0].Likes is None:
        likes = 0
    else:
        likes = data[0].Likes.likes
    qa_id = data[0].QA.id
    return render_template("secret.html",
                           question=question,
                           secret=secret[:4] + "****" + secret[-4:],
                           answer=answer,
                           is_public=is_public,
                           likes=likes,
                           qa_id=qa_id,
                           timestamp_str=timestamp_str,
                           i18n_t=i18n(lang))


# Set init db for demo
# @app.route("/setup_demo")
# def setup_demo():
#     demo_question = "Et mea etiam iisque percipitur, etiam putant an pri"
#     demo_answer = "Lorem ipsum dolor sit amet, an ius illum definiebas. Quod dissentias consequuntur at ius, in " \
#                   "sea maluisset appellantur. Vis ea nibh similique, autem propriae eloquentiam ut vix. Vis id " \
#                   "audire fabulas deterruisset, sonet primis essent mea cu, vix id appetere conceptam."
#     for i in range(20):
#         db.session.add(QA(question=demo_question))
#     for i in range(10):
#         db.session.add(QA(question=demo_question, answer=demo_answer, is_public=True))
#     from datetime import datetime
#     for i in range(5):
#         db.session.add(QA(question=demo_question, answer=demo_answer,
#                           is_public=True, answer_timestamp=datetime.now()))
#     for i in range(5):
#         db.session.add(QA(question=demo_question, answer=demo_answer))
#     db.session.commit()
#     return index()


app.run(host='127.0.0.1', port=5000)
