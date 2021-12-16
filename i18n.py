i18n_text = {
    "ZH-CN": {
        "empty question": "说些什么吧……不能提交空白问题。",
        "same question": "同样的问题已经有啦……不如静待回答？",
        "wrong password": "密码不正确……为什么会这样呢？",
        "no secret": "诶，没有找到这个提问。",
        "published": "已公开",
        "private": "秘密",
        "no answer": "未回答",
        "find secret": "搜寻秘密答案",
        "answer question": "回答/仅管理员",
        "keep code": "请保存好您的提问代码：",
        "keep code hint": "如果您的提问被「秘密地」回答了，您可以使用此代码搜寻秘密答案～",
        "ask here": "在这里提问吧……",
        "submit": "提交问题",
        "public qa": "公开的问答",
        "no public qa": "抱歉，目前还没有呢……",
        "admin password": "管理员密码",
        "login": "登入",
        "already asked": "已经提问了吗？请提供提问代码……",
        "show secret": "寻找答案",
        "no answer secret": "还没有回答……要不等一会？",
    },
    "EN-US": {
        "empty question": "Say something please ... Question should not empty.",
        "same question": "Same question asked ... Just wait for answer.",
        "wrong password": "Wrong password ... WHY?",
        "no secret": "Oops, secret not found.",
        "published": "Published",
        "private": "Private",
        "no answer": "To be answered",
        "find secret": "FIND  SECRET",
        "answer question": "ANSWER(admin)",
        "keep code": "Keep your secret code: ",
        "keep code hint": "When your question is answered but set to private, use the code to view answer.",
        "ask here": "Ask me something here ...",
        "submit": "Submit",
        "public qa": "Public Q&A",
        "no public qa": "No answered question now ...",
        "admin password": "Password",
        "login": "Login",
        "already asked": "Already asked? Give me secret code.",
        "show secret": "Show secret",
        "no answer secret": "No answer now ... wait a moment ?",
    }
}

def i18n(lang, k=None):
    t = i18n_text.get(lang, i18n_text["EN-US"])
    if k is None:
        return t
    if k in t.keys():
        return t[k]
    return i18n_text["EN-US"].get(k, "???")
