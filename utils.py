from hashlib import md5
from time import time
from random import randint


def random_hex_32():
    return md5((str(randint(1 << 31, 1 << 32 - 1)) + str(time())).encode("utf-8")).hexdigest()


session_secret = {"admin": random_hex_32()}


def refresh_session_secret():
    session_secret["admin"] = random_hex_32()
