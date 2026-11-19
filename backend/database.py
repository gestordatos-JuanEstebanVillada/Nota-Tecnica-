import os
import oracledb
from dotenv import load_dotenv

load_dotenv()

SCSE_DB_USER = os.getenv("DB_USER") or os.getenv("SCSE_DB_USER", "onco")
SCSE_DB_PASSWD = os.getenv("DB_PASSWORD") or os.getenv("SCSE_DB_PASSWD", "onco")
SCSE_DB_IP = os.getenv("DB_HOST") or os.getenv("SCSE_DB_IP", "160.2.1.79")
SCSE_DB_PORT = os.getenv("DB_PORT") or os.getenv("SCSE_DB_PORT", "1521")
SCSE_DB_DATABASE = os.getenv("DB_SERVICE") or os.getenv("SCSE_DB_DATABASE", "Ligapru")


def get_connection():
    dsn = f"{SCSE_DB_IP}:{SCSE_DB_PORT}/{SCSE_DB_DATABASE}"
    return oracledb.connect(user=SCSE_DB_USER, password=SCSE_DB_PASSWD, dsn=dsn)