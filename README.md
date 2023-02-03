<p align="center"><a href="https://excited.cloud" target="_blank" rel="noopener noreferrer"><img width="100" src="https://github.com/CyrusF/AnoMe/blob/main/static/images/favicon.jpg" alt="AnoMe logo"></a></p>
<h1 align="center">AnoMe</h1>

<p align="center">Just a tiny anonymous question box.</p>

## Why
I need a anonymous question box with some 'private answer' function, and I do not trust the box run by the providers.

## How to
1. Install requirement with `pip3 install -r requirements.txt` or any package manager you like.
2. Run `python3 config.py`, enter your admin password, then hash of your password will automatically recorded.
3. Run `python3 main.py`, it works.
4. Application can be accessed by http://127.0.0.1:5000.

## Before online
1. When you decide to start using, change `sqlite:///example_db` to your database path, or just delete the example_db in root path directly.
2. Disable debug mode with changing `app.debug = True` to False in `main.py`
3. Have fun!

## Screenshots
<img width="1920" src="https://user-images.githubusercontent.com/20309761/146222654-6db42aa1-c20a-4e39-9abf-b25d880372b9.png">
