from flask import Flask
from utils import random_hex_32

app = Flask("AnoMe")
app.secret_key = random_hex_32()
app.debug = True

from database import db
from models import QA

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///example_db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = True
db.init_app(app)
with app.app_context():
    db.create_all()

from flask_admin import Admin
from flask_admin.menu import MenuLink
from auth import AnoMeAdminIndexView, AnoMeAllQaView, AnoMeEmptyQaView, AnoMePublicQaView, AnoMePrivateQaView

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
    admin.add_link(MenuLink(name='Back to Home', category='', url="/"))
    admin.add_link(MenuLink(name='Logout', category='', url="/logout"))

from flask import request, render_template, redirect, session
from config import ADMIN_PASSWORD
from utils import session_secret, refresh_session_secret
from hashlib import md5


@app.route("/", methods=["GET"])
def index():
    data = QA.query.filter(QA.answer != None).filter(QA.is_public == True).all()
    return render_template("index.html", data=data)


@app.route("/question", methods=["POST"])
def question():
    data = QA.query.filter(QA.answer != None).filter(QA.is_public == True).all()
    question = request.form.get("question", "")
    if not question:
        return render_template("index.html", question_error="Say something please ... Question should not empty.",
                               data=data)
    secret = random_hex_32()
    if QA.query.filter(QA.answer == None).filter(QA.question == question).count() != 0:
        return render_template("index.html", question_error="Same question asked ... Just wait for answer.", data=data)
    qa = QA(question=question, secret=secret)
    db.session.add(qa)
    db.session.commit()
    return render_template("index.html", secret_code=secret, data=data)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        login_url = request.full_path
        return render_template("login.html", login_url=login_url)
    if request.method == "POST":
        password = request.form.get("password", None)
        if password is not None and md5(password.encode("utf8")).hexdigest() == ADMIN_PASSWORD:
            session["admin"] = session_secret["admin"]
            print("set admin", session_secret["admin"])
            next_url = request.args.get("next", default="/")
            return redirect(next_url)
        return render_template("login.html", error="Wrong password")


@app.route("/logout", methods=["GET"])
def logout():
    if session.get("admin", "") == session_secret["admin"]:
        refresh_session_secret()
    return redirect("/")


@app.route("/secret", methods=["GET"])
def show_secret():
    secret = request.args.get("s", default=None)
    if secret is None:
        return render_template("secret.html", question="")
    data = QA.query.filter(QA.secret == secret).all()
    if len(data) == 0:
        return render_template("secret.html", secret_error="Oops, secret not found.", question="")
    question = data[0].question
    answer = data[0].answer
    answer = "" if answer is None else answer
    if data[0].answer_timestamp is not None:
        timestamp_str = data[0].answer_timestamp.strftime("%Y-%m-%d %H:%M:%S")
    else:
        timestamp_str = ""
    is_public = data[0].is_public
    is_public = {True: "Published", False: "Private"}.get(is_public)
    return render_template("secret.html",
                           question=question,
                           secret=secret[:4] + "****" + secret[-4:],
                           answer=answer,
                           is_public=is_public,
                           timestamp_str=timestamp_str)


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


app.run()
