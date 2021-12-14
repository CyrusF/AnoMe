# AnoMe
Just a tiny anonymous question box

## Why
I need a anonymous question box with some 'private answer' function, and I do not trust the box run by the porviders.

## How to
1. Install requirement with `pip3 install -r requirements.txt` or any package manager you like.
2. Run `python3 setup.py`, enter your admin password, then hash of your password will automatically recorded.
3. Run `python3 main.py`, it works.
4. Application can be accessed by http://127.0.0.1:5000.

## Before online
1. When you decide to start using, change `sqlite:///example_db` to your database path, or just delete the example_db in root path directly.
2. Disable debug mode with changing `app.debug = True` to False in `main.py`
3. Have fun!

## Screenshots
<img width="1394" alt="image" src="https://user-images.githubusercontent.com/20309761/145978565-78030480-9da9-4afa-96a3-73b4b74aceab.png">
<img width="1394" alt="image" src="https://user-images.githubusercontent.com/20309761/145978813-973aff9d-2d3f-489c-9921-da3b16ba8edd.png">
<img width="1394" alt="image" src="https://user-images.githubusercontent.com/20309761/145978915-858ac8f6-1886-4468-a16c-0b1e5065cb8e.png">
