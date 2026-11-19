import os
import hashlib
import traceback

import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from passlib.context import CryptContext
from database import get_connection

SECRET_KEY = os.getenv("JWT_SECRET", "liga_cancer_nota_tecnica_2026_secret")
ALGORITHM = "HS256"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

router = APIRouter(prefix="/api/auth", tags=["Autenticación"])


class LoginRequest(BaseModel):
    usuario: str
    password: str


def verificar_password(plain_password: str, stored_password: str) -> bool:
    if stored_password is None:
        return False
    stored_str = str(stored_password).strip()

    # SHA-1 (40 caracteres hexadecimales - estándar de INTRANET_USUARIOS)
    if len(stored_str) == 40:
        if hashlib.sha1(plain_password.encode("utf-8")).hexdigest().lower() == stored_str.lower():
            return True

    # Bcrypt
    if stored_str.startswith(("$2b$", "$2a$", "$2y$")):
        return pwd_context.verify(plain_password, stored_str)

    # SHA-256
    if len(stored_str) == 64:
        if hashlib.sha256(plain_password.encode("utf-8")).hexdigest().lower() == stored_str.lower():
            return True

    # Texto plano legado
    return plain_password == stored_str


@router.post("/login")
def login(data: LoginRequest):
    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT ID, USUARIO, CONTRASENA, NOMBRES, ID_CLASE, ESTADO, ID_AREA, PORTAL_ROL
            FROM INTRANET_USUARIOS
            WHERE UPPER(TRIM(USUARIO)) = UPPER(TRIM(:usr))
            """,
            {"usr": data.usuario},
        )
        row = cur.fetchone()

        if row is None:
            raise HTTPException(status_code=401, detail="Usuario no encontrado en INTRANET_USUARIOS")

        user_id, username, stored_pwd, nombres, id_clase, estado, id_area, portal_rol = row

        if estado is None or str(estado).strip() != "1":
            raise HTTPException(status_code=403, detail="Usuario inactivo en el sistema")

        if not verificar_password(data.password, stored_pwd):
            raise HTTPException(status_code=401, detail="Contraseña incorrecta")

        if portal_rol and str(portal_rol).strip():
            rol_final = str(portal_rol).strip().upper()
        elif int(user_id) == 0 or (id_clase is not None and int(id_clase) == 1):
            rol_final = "ADMINISTRADOR"
        else:
            rol_final = "USUARIO"

        nombre_mostrar = str(nombres or username).strip()
        usuario_limpio = str(username).strip()

        payload = {
            "sub": str(user_id),
            "id": int(user_id),
            "usuario": usuario_limpio,
            "nombre": nombre_mostrar,
            "id_clase": int(id_clase) if id_clase is not None else None,
            "id_area": int(id_area) if id_area is not None else None,
            "rol": rol_final,
            "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": int(user_id),
                "usuario": usuario_limpio,
                "nombre": nombre_mostrar,
                "rol": rol_final,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        return jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")