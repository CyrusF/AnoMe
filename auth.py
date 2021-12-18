from flask_admin.contrib.sqla.view import ModelView, func
from flask_admin import AdminIndexView, expose
from flask import redirect, url_for, request, session
from utils import session_secret
from models import QA, Likes


class AnoMeAdminIndexView(AdminIndexView):

    @expose()
    def index(self):
        public_count = QA.query.filter(QA.answer != None).filter(QA.is_public == True).count()
        private_count = QA.query.filter(QA.answer != None).filter(QA.is_public == False).count()
        empty_count = QA.query.filter(QA.answer == None).count()
        self._template_args["public_count"] = public_count
        self._template_args["private_count"] = private_count
        self._template_args["empty_count"] = empty_count
        return super(AnoMeAdminIndexView, self).index()

    def is_visible(self):
        return False

    def is_accessible(self):
        return session.get("admin", "") == session_secret["admin"]

    def inaccessible_callback(self, name, **kwargs):
        return redirect(url_for("login", next=request.full_path))


class AnoMeView(ModelView):
    def is_accessible(self):
        return session.get("admin", "") == session_secret["admin"]

    def inaccessible_callback(self, name, **kwargs):
        return redirect(url_for("login", next=request.full_path))


class AnoMeAllQaView(AnoMeView):
    pass


class AnoMeEmptyQaView(AnoMeAllQaView):
    column_searchable_list = ("question", "answer", "secret")
    column_filters = ("question", "answer", "secret")

    form_widget_args = {
        "question": {
            "rows": 3
        },
        "answer": {
            "rows": 10
        },
        "secret": {
            "readonly": True
        },
    }

    def get_query(self):
        return self.session.query(self.model).filter(self.model.answer == None)

    def get_count_query(self):
        return self.session.query(func.count("*")).filter(self.model.answer == None)


class AnoMePublicQaView(AnoMeAllQaView):
    def get_query(self):
        return self.session.query(self.model).filter(self.model.answer != None).filter(self.model.is_public == True)

    def get_count_query(self):
        return self.session.query(func.count("*")).filter(self.model.answer != None).filter(
            self.model.is_public == True)


class AnoMePrivateQaView(AnoMeAllQaView):
    def get_query(self):
        return self.session.query(self.model).filter(self.model.answer != None).filter(self.model.is_public == False)

    def get_count_query(self):
        return self.session.query(func.count("*")).filter(self.model.answer != None).filter(
            self.model.is_public == False)
