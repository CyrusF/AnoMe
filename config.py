ADMIN_PASSWORD = ""

if __name__ == "__main__":
    from hashlib import md5
    import os

    p = input("enter admin password: ")
    p_hash = md5(p.encode("utf8")).hexdigest()
    config_path = os.path.abspath(__file__)
    with open(config_path, "r") as fr:
        new_config = "".join([
            "ADMIN_PASSWORD = \"%s\"\n" % p_hash if i.startswith("ADMIN_PASSWORD") else i for i in fr.readlines()
        ])
    with open(config_path, "w") as fw:
        fw.write(new_config)
    print("Config written!")
