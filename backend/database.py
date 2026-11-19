import os
import traceback
from typing import Optional

import oracledb
from dotenv import load_dotenv

load_dotenv()


def _env_first(*keys: str, default: Optional[str] = None) -> Optional[str]:
    """Usa la primera variable de entorno con valor no vacío."""
    for key in keys:
        raw = os.getenv(key)
        if raw is not None and str(raw).strip():
            return str(raw).strip()
    return default


SCSE_DB_USER = _env_first("DB_USER", "SCSE_DB_USER", default="onco") or "onco"
SCSE_DB_PASSWD = _env_first("DB_PASSWORD", "SCSE_DB_PASSWD")
SCSE_DB_IP = _env_first("DB_HOST", "SCSE_DB_IP", default="160.2.1.79") or "160.2.1.79"
SCSE_DB_PORT = _env_first("DB_PORT", "SCSE_DB_PORT", default="1521") or "1521"
SCSE_DB_DATABASE = _env_first("DB_SERVICE", "SCSE_DB_DATABASE", default="Ligapru") or "Ligapru"


def oracle_config_status() -> dict:
    return {
        "host": SCSE_DB_IP,
        "port": SCSE_DB_PORT,
        "service": SCSE_DB_DATABASE,
        "user": SCSE_DB_USER,
        "password_configured": bool(SCSE_DB_PASSWD),
    }


def get_connection():
    if not SCSE_DB_PASSWD:
        raise RuntimeError(
            "Contraseña Oracle no configurada. Defina DB_PASSWORD (o SCSE_DB_PASSWD) "
            "en el archivo .env de la raíz del proyecto antes de docker compose up."
        )
    dsn = f"{SCSE_DB_IP}:{SCSE_DB_PORT}/{SCSE_DB_DATABASE}"
    try:
        return oracledb.connect(user=SCSE_DB_USER, password=SCSE_DB_PASSWD, dsn=dsn)
    except oracledb.Error as exc:
        traceback.print_exc()
        raise RuntimeError(
            f"No se pudo conectar a Oracle ({SCSE_DB_USER}@{SCSE_DB_IP}:{SCSE_DB_PORT}/{SCSE_DB_DATABASE}): {exc}"
        ) from exc