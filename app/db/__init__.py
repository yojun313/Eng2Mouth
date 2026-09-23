import os

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient

load_dotenv()

MONGO_HOST = os.getenv("MONGO_HOST", "localhost")
MONGO_PORT = int(os.getenv("MONGO_PORT", "27017"))
MONGO_USER = os.getenv("MONGO_USERNAME", "")
MONGO_PASSWORD = os.getenv("MONGO_PASSWORD", "")
MONGO_DB = os.getenv("MONGO_DB", "eng2mouth")
MONGO_AUTH_DB = "admin"

if MONGO_USER:
    _uri = f"mongodb://{MONGO_USER}:{MONGO_PASSWORD}@{MONGO_HOST}:{MONGO_PORT}/?authSource={MONGO_AUTH_DB}"
else:
    _uri = f"mongodb://{MONGO_HOST}:{MONGO_PORT}/"

client = MongoClient(_uri, serverSelectionTimeoutMS=5000)

db = client[MONGO_DB]
users_col = db["users"]
sessions_col = db["sessions"]
calls_col = db["calls"]
phrases_col = db["phrases"]
daily_picks_col = db["daily_picks"]


def ensure_indexes():
    users_col.create_index([("username", ASCENDING)], unique=True)
    users_col.create_index([("email", ASCENDING)])
    sessions_col.create_index([("session_id", ASCENDING)], unique=True)
    calls_col.create_index([("id", ASCENDING)], unique=True)
    calls_col.create_index([("owner", ASCENDING), ("started_at", DESCENDING)])
    phrases_col.create_index([("owner", ASCENDING), ("created_at", DESCENDING)])
    daily_picks_col.create_index(
        [("owner", ASCENDING), ("date", ASCENDING)], unique=True
    )
