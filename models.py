from database import db
from datetime import datetime
from utils import random_hex_32


def _default_repr(class_obj):
    return "<%s>" % ", ".join(["%s:%s" % i for i in sorted(list(class_obj.__dict__.items()), key=lambda x: x[0])])


class QA(db.Model):
    id = db.Column(db.INTEGER, primary_key=True)
    question = db.Column(db.String, nullable=False)
    answer = db.Column(db.String, default=None)
    question_timestamp = db.Column(db.DateTime, default=datetime.now)
    answer_timestamp = db.Column(db.DateTime, default=None)
    is_public = db.Column(db.Boolean, nullable=True, default=False)
    secret = db.Column(db.String, default=random_hex_32)

    def __repr__(self):
        return _default_repr(self)
