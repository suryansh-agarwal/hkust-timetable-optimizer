# api/config.py
import os
DATA_DIR = os.getenv("DATA_DIR", "./data")  # on Render set to /var/data
os.makedirs(DATA_DIR, exist_ok=True)
