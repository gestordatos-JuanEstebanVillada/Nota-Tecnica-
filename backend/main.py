import io
import json
import time
import traceback
from datetime import date
from typing import List, Optional
import oracledb
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from database import get_connection, oracle_config_status, asegurar_columna_observacion
from auth import router as auth_router, get_current_user
from excel_service import parsear_excel_nota_tecnica, generar_excel_nota_tecnica

app = FastAPI(title="API Nota Técnica PGP - Liga Contra el Cáncer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.on_event("startup")
def on_startup():
    try:
        asegurar_columna_observacion()
    except Exception as e:
        print("Advertencia al verificar columna OBSERVACION:", e)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if not isinstance(detail, (str, type(None))):
            detail = str(detail)
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/api/health")
def health_check():
    cfg = oracle_config_status()
    return {"status": "ok", "oracle": cfg}


class DetalleUpdate(BaseModel):
    id_detalle: int
    codigo_cups: Optional[str] = None
    descripcion: Optional[str] = None
    frecuencia_anual: float
    costo_medio_evento: float


class NotaUpdatePayload(BaseModel):
    poblacion: int
    detalles: List[DetalleUpdate]


class NuevoAgrupadorPayload(BaseModel):
    nombre_agrupador: str


class NuevoCupsPayload(BaseModel):
    codigo_cups: str
    descripcion: str
    frecuencia_anual: float = 0.0
    costo_medio_evento: float = 0.0
    observacion: Optional[str] = ""


class EstadoContratacionPayload(BaseModel):
    estado_contratacion: str


class ObservacionPayload(BaseModel):
    observacion: str = ""


def parsear_clausulas_y_estados(clausulas_raw) -> tuple[list, dict]:
    if not clausulas_raw:
        return [], {}
    texto = clausulas_raw.read() if hasattr(clausulas_raw, "read") else str(clausulas_raw)
    if not texto.strip():
        return [], {}
    try:
        data = json.loads(texto)
        if isinstance(data, dict):
            return data.get("clausulas", []), data.get("contratacion_estados", {})
        if isinstance(data, list):
            return data, {}
    except Exception:
        pass
    return [], {}


def guardar_clausulas_y_estados(conn, cur, id_nota: int, clausulas: list, estados: dict):
    payload_str = json.dumps(
        {"clausulas": clausulas, "contratacion_estados": estados},
        ensure_ascii=False,
    )
    clob_obj = conn.createlob(oracledb.DB_TYPE_CLOB)
    clob_obj.write(payload_str)
    cur.execute(
        "UPDATE NT_CABECERA SET CLAUSULAS_JSON = :clob_data WHERE ID_NOTA = :id_nota",
        {"clob_data": clob_obj, "id_nota": id_nota},
    )


@app.get("/api/notas-tecnicas")
def listar_notas(user=Depends(get_current_user)):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT ID_NOTA, CONSECUTIVO, CONTRATANTE, ESPECIALIDAD, POBLACION, TO_CHAR(VIGENCIA, 'YYYY-MM-DD')
            FROM NT_CABECERA
            ORDER BY ID_NOTA DESC
        """)
        return [
            {
                "id_nota": int(r[0]),
                "consecutivo": r[1],
                "contratante": r[2],
                "especialidad": r[3],
                "poblacion": int(r[4]),
                "vigencia": r[5],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()
        conn.close()


@app.post("/api/notas-tecnicas/importar")
async def importar_excel(file: UploadFile = File(...), user=Depends(get_current_user)):
    conn = None
    cur = None
    try:
        content = await file.read()
        parsed = parsear_excel_nota_tecnica(content)
        cab = parsed["cabecera"]

        if not parsed["agrupadores"]:
            raise HTTPException(
                status_code=400,
                detail="No se encontraron agrupadores en el archivo Excel.",
            )

        conn = get_connection()
        cur = conn.cursor()

        clob_clausulas = conn.createlob(oracledb.DB_TYPE_CLOB)
        if cab.get("clausulas_json"):
            clob_clausulas.write(cab["clausulas_json"])

        id_nota_var = cur.var(int)
        cur.execute(
            """
            INSERT INTO NT_CABECERA (
                TITULO_ANEXO, CONTRATANTE, CONTRATISTA, NIT_PRESTADOR,
                REGIONAL, DEPARTAMENTO, MUNICIPIOS, REGIMEN, AMBITO,
                GRUPO_ETAREO, ESPECIALIDAD, VIGENCIA, CONSECUTIVO,
                POBLACION, PCT_CONTRIBUTIVO, PCT_SUBSIDIADO,
                CLAUSULAS_JSON, USUARIO_CREACION
            ) VALUES (
                :titulo_anexo, :contratante, :contratista, :nit_prestador,
                :regional, :departamento, :municipios, :regimen, :ambito,
                :grupo_etareo, :especialidad, TO_DATE(:vigencia, 'YYYY-MM-DD'), :consecutivo,
                :poblacion, :pct_contributivo, :pct_subsidiado,
                :clausulas_json, :usuario_creacion
            ) RETURNING ID_NOTA INTO :id_nota
            """,
            {
                "titulo_anexo": cab["titulo_anexo"],
                "contratante": cab["contratante"],
                "contratista": cab["contratista"],
                "nit_prestador": cab["nit_prestador"],
                "regional": cab["regional"],
                "departamento": cab["departamento"],
                "municipios": cab["municipios"],
                "regimen": cab["regimen"],
                "ambito": cab["ambito"],
                "grupo_etareo": cab["grupo_etareo"],
                "especialidad": cab["especialidad"],
                "vigencia": cab["vigencia"],
                "consecutivo": cab["consecutivo"],
                "poblacion": cab["poblacion"],
                "pct_contributivo": cab["pct_contributivo"],
                "pct_subsidiado": cab["pct_subsidiado"],
                "clausulas_json": clob_clausulas,
                "usuario_creacion": user["usuario"],
                "id_nota": id_nota_var,
            },
        )

        id_nota = int(id_nota_var.getvalue()[0])

        for agr in parsed["agrupadores"]:
            id_agr_var = cur.var(int)
            cur.execute(
                """
                INSERT INTO NT_AGRUPADORES (ID_NOTA, ORDEN, NOMBRE_AGRUPADOR)
                VALUES (:id_nota, :orden, :nombre_agrupador)
                RETURNING ID_AGRUPADOR INTO :id_agrupador
                """,
                {
                    "id_nota": id_nota,
                    "orden": agr["orden"],
                    "nombre_agrupador": agr["nombre_agrupador"],
                    "id_agrupador": id_agr_var,
                },
            )
            id_agr = int(id_agr_var.getvalue()[0])

            if agr["detalles"]:
                cur.executemany(
                    """
                    INSERT INTO NT_DETALLE_CUPS (
                        ID_AGRUPADOR, ORDEN, CODIGO_CUPS, DESCRIPCION,
                        FRECUENCIA_ANUAL, COSTO_MEDIO_EVENTO
                    ) VALUES (
                        :id_agrupador, :orden, :codigo_cups, :descripcion,
                        :frecuencia_anual, :costo_medio_evento
                    )
                    """,
                    [
                        {
                            "id_agrupador": id_agr,
                            "orden": d["orden"],
                            "codigo_cups": d["codigo_cups"],
                            "descripcion": d["descripcion"],
                            "frecuencia_anual": round(float(d["frecuencia_anual"]), 12),
                            "costo_medio_evento": round(float(d["costo_medio_evento"]), 4),
                        }
                        for d in agr["detalles"]
                    ],
                )

        conn.commit()
        return {
            "id_nota": id_nota,
            "mensaje": f"Excel importado exitosamente ({len(parsed['agrupadores'])} agrupadores cargados)",
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error Oracle/Backend al importar Excel: {str(e)}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def obtener_nota_completa(id_nota: int):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT ID_NOTA, TITULO_ANEXO, CONTRATANTE, CONTRATISTA, NIT_PRESTADOR,
                   REGIONAL, DEPARTAMENTO, MUNICIPIOS, REGIMEN, AMBITO,
                   GRUPO_ETAREO, ESPECIALIDAD, TO_CHAR(VIGENCIA, 'YYYY-MM-DD'),
                   CONSECUTIVO, POBLACION, PCT_CONTRIBUTIVO, PCT_SUBSIDIADO, CLAUSULAS_JSON
            FROM NT_CABECERA WHERE ID_NOTA = :id_nota
            """,
            {"id_nota": id_nota},
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Nota técnica no encontrada")

        clausulas_list, contratacion_estados = parsear_clausulas_y_estados(row[17])

        nota = {
            "id_nota": int(row[0]),
            "titulo_anexo": row[1],
            "contratante": row[2],
            "contratista": row[3],
            "nit_prestador": row[4],
            "regional": row[5],
            "departamento": row[6],
            "municipios": row[7],
            "regimen": row[8],
            "ambito": row[9],
            "grupo_etareo": row[10],
            "especialidad": row[11],
            "vigencia": row[12],
            "consecutivo": row[13],
            "poblacion": int(row[14]),
            "pct_contributivo": float(row[15]),
            "pct_subsidiado": float(row[16]),
            "clausulas_json": json.dumps(clausulas_list, ensure_ascii=False),
            "agrupadores": [],
        }

        cur.execute(
            """
            SELECT ID_AGRUPADOR, ORDEN, NOMBRE_AGRUPADOR
            FROM NT_AGRUPADORES
            WHERE ID_NOTA = :id_nota
            ORDER BY ORDEN ASC
            """,
            {"id_nota": id_nota},
        )

        for agr_row in cur.fetchall():
            id_agr = int(agr_row[0])
            cur.execute(
                """
                SELECT ID_DETALLE, ORDEN, CODIGO_CUPS, DESCRIPCION,
                       FRECUENCIA_ANUAL, COSTO_MEDIO_EVENTO, OBSERVACION
                FROM NT_DETALLE_CUPS
                WHERE ID_AGRUPADOR = :id_agrupador
                ORDER BY ORDEN ASC
                """,
                {"id_agrupador": id_agr},
            )
            detalles = []
            for d in cur.fetchall():
                id_det = int(d[0])
                estado_raw = contratacion_estados.get(str(id_det))
                estado_norm = "COTIZACIONES" if estado_raw == "CONTRATACION" else estado_raw
                detalles.append({
                    "id_detalle": id_det,
                    "orden": int(d[1]),
                    "codigo_cups": d[2],
                    "descripcion": d[3],
                    "frecuencia_anual": float(d[4]),
                    "costo_medio_evento": float(d[5]),
                    "observacion": str(d[6] or ""),
                    "estado_contratacion": estado_norm,
                })
            nota["agrupadores"].append({
                "id_agrupador": id_agr,
                "orden": int(agr_row[1]),
                "nombre_agrupador": agr_row[2],
                "detalles": detalles,
            })
        return nota
    finally:
        cur.close()
        conn.close()


@app.get("/api/notas-tecnicas/{id_nota}")
def detalle_nota(id_nota: int, user=Depends(get_current_user)):
    return obtener_nota_completa(id_nota)


@app.put("/api/notas-tecnicas/{id_nota}")
def actualizar_nota(id_nota: int, payload: NotaUpdatePayload, user=Depends(get_current_user)):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT CLAUSULAS_JSON FROM NT_CABECERA WHERE ID_NOTA = :id_nota", {"id_nota": id_nota})
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Nota técnica no encontrada")
        _, contratacion_estados = parsear_clausulas_y_estados(row[0])

        cur.execute(
            "UPDATE NT_CABECERA SET POBLACION = :poblacion WHERE ID_NOTA = :id_nota",
            {"poblacion": payload.poblacion, "id_nota": id_nota},
        )

        cur.executemany(
            """
            UPDATE NT_DETALLE_CUPS
            SET FRECUENCIA_ANUAL = :frecuencia_anual,
                COSTO_MEDIO_EVENTO = :costo_medio_evento
            WHERE ID_DETALLE = :id_detalle
            """,
            [
                {
                    "frecuencia_anual": round(float(d.frecuencia_anual), 12),
                    "costo_medio_evento": round(float(d.costo_medio_evento), 4),
                    "id_detalle": d.id_detalle,
                }
                for d in payload.detalles
            ],
        )

        nuevos_editables = [
            {
                "codigo_cups": (d.codigo_cups or "").strip()[:30],
                "descripcion": (d.descripcion or "").strip().upper()[:500],
                "id_detalle": d.id_detalle,
            }
            for d in payload.detalles
            if str(d.id_detalle) in contratacion_estados
            and d.codigo_cups is not None
            and d.descripcion is not None
        ]
        if nuevos_editables:
            cur.executemany(
                """
                UPDATE NT_DETALLE_CUPS
                SET CODIGO_CUPS = :codigo_cups,
                    DESCRIPCION = :descripcion
                WHERE ID_DETALLE = :id_detalle
                """,
                nuevos_editables,
            )

        conn.commit()
        return {"mensaje": "Cambios guardados correctamente en Oracle"}
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.post("/api/notas-tecnicas/{id_nota}/agrupadores")
def crear_agrupador(id_nota: int, payload: NuevoAgrupadorPayload, user=Depends(get_current_user)):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT NVL(MAX(ORDEN), 0) + 1 FROM NT_AGRUPADORES WHERE ID_NOTA = :id_nota", {"id_nota": id_nota})
        next_orden = int(cur.fetchone()[0])
        id_agr_var = cur.var(int)
        cur.execute(
            """
            INSERT INTO NT_AGRUPADORES (ID_NOTA, ORDEN, NOMBRE_AGRUPADOR)
            VALUES (:id_nota, :orden, :nombre_agrupador)
            RETURNING ID_AGRUPADOR INTO :id_agrupador
            """,
            {
                "id_nota": id_nota,
                "orden": next_orden,
                "nombre_agrupador": payload.nombre_agrupador.strip().upper(),
                "id_agrupador": id_agr_var,
            },
        )
        conn.commit()
        return {"id_agrupador": int(id_agr_var.getvalue()[0])}
    finally:
        cur.close()
        conn.close()


@app.post("/api/agrupadores/{id_agrupador}/cups")
def agregar_cups(id_agrupador: int, payload: NuevoCupsPayload, user=Depends(get_current_user)):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT C.ID_NOTA, C.CLAUSULAS_JSON
            FROM NT_AGRUPADORES A
            JOIN NT_CABECERA C ON C.ID_NOTA = A.ID_NOTA
            WHERE A.ID_AGRUPADOR = :id_agrupador
            """,
            {"id_agrupador": id_agrupador},
        )
        cab_row = cur.fetchone()
        if not cab_row:
            raise HTTPException(status_code=404, detail="Agrupador no encontrado")
        id_nota = int(cab_row[0])
        clausulas_list, contratacion_estados = parsear_clausulas_y_estados(cab_row[1])

        cur.execute(
            "SELECT NVL(MAX(ORDEN), 0) + 1 FROM NT_DETALLE_CUPS WHERE ID_AGRUPADOR = :id_agrupador",
            {"id_agrupador": id_agrupador},
        )
        next_orden = int(cur.fetchone()[0])

        id_det_var = cur.var(int)
        obs_limpia = (payload.observacion or "").strip()[:4000] or None
        cur.execute(
            """
            INSERT INTO NT_DETALLE_CUPS (
                ID_AGRUPADOR, ORDEN, CODIGO_CUPS, DESCRIPCION,
                FRECUENCIA_ANUAL, COSTO_MEDIO_EVENTO, OBSERVACION
            ) VALUES (
                :id_agrupador, :orden, :codigo_cups, :descripcion,
                :frecuencia_anual, :costo_medio_evento, :observacion
            ) RETURNING ID_DETALLE INTO :id_detalle
            """,
            {
                "id_agrupador": id_agrupador,
                "orden": next_orden,
                "codigo_cups": payload.codigo_cups.strip()[:30],
                "descripcion": payload.descripcion.strip().upper()[:500],
                "frecuencia_anual": round(float(payload.frecuencia_anual), 12),
                "costo_medio_evento": round(float(payload.costo_medio_evento), 4),
                "observacion": obs_limpia,
                "id_detalle": id_det_var,
            },
        )
        nuevo_id_det = int(id_det_var.getvalue()[0])

        contratacion_estados[str(nuevo_id_det)] = "COTIZACIONES"
        guardar_clausulas_y_estados(conn, cur, id_nota, clausulas_list, contratacion_estados)

        conn.commit()
        return {
            "id_detalle": nuevo_id_det,
            "estado_contratacion": "COTIZACIONES",
            "observacion": obs_limpia or "",
        }
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.patch("/api/detalle-cups/{id_detalle}/observacion")
def actualizar_observacion_cups(
    id_detalle: int, payload: ObservacionPayload, user=Depends(get_current_user)
):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT C.CLAUSULAS_JSON
            FROM NT_DETALLE_CUPS D
            JOIN NT_AGRUPADORES A ON A.ID_AGRUPADOR = D.ID_AGRUPADOR
            JOIN NT_CABECERA C ON C.ID_NOTA = A.ID_NOTA
            WHERE D.ID_DETALLE = :id_detalle
            """,
            {"id_detalle": id_detalle},
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Detalle CUPS no encontrado")

        _, contratacion_estados = parsear_clausulas_y_estados(row[0])
        if str(id_detalle) not in contratacion_estados:
            raise HTTPException(
                status_code=403,
                detail="Solo se permite agregar observaciones a los CUPS nuevos de Cotizaciones.",
            )

        obs_limpia = (payload.observacion or "").strip()[:4000]
        cur.execute(
            """
            UPDATE NT_DETALLE_CUPS
            SET OBSERVACION = :observacion
            WHERE ID_DETALLE = :id_detalle
            """,
            {"observacion": obs_limpia or None, "id_detalle": id_detalle},
        )
        conn.commit()
        return {"id_detalle": id_detalle, "observacion": obs_limpia}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.patch("/api/detalle-cups/{id_detalle}/estado")
def cambiar_estado_contratacion(
    id_detalle: int, payload: EstadoContratacionPayload, user=Depends(get_current_user)
):
    nuevo_estado = payload.estado_contratacion.strip().upper()
    if nuevo_estado == "CONTRATACION":
        nuevo_estado = "COTIZACIONES"
    if nuevo_estado not in ("COTIZACIONES", "OK"):
        raise HTTPException(status_code=400, detail="Estado permitido: COTIZACIONES o OK")

    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT C.ID_NOTA, C.CLAUSULAS_JSON
            FROM NT_DETALLE_CUPS D
            JOIN NT_AGRUPADORES A ON A.ID_AGRUPADOR = D.ID_AGRUPADOR
            JOIN NT_CABECERA C ON C.ID_NOTA = A.ID_NOTA
            WHERE D.ID_DETALLE = :id_detalle
            """,
            {"id_detalle": id_detalle},
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Detalle CUPS no encontrado")

        id_nota = int(row[0])
        clausulas_list, contratacion_estados = parsear_clausulas_y_estados(row[1])

        if str(id_detalle) not in contratacion_estados:
            raise HTTPException(
                status_code=400,
                detail="Este CUPS pertenece al Excel base y no es un ingreso nuevo de Cotizaciones.",
            )

        contratacion_estados[str(id_detalle)] = nuevo_estado
        guardar_clausulas_y_estados(conn, cur, id_nota, clausulas_list, contratacion_estados)
        conn.commit()
        return {"id_detalle": id_detalle, "estado_contratacion": nuevo_estado}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.delete("/api/detalle-cups/{id_detalle}")
def eliminar_cups_nuevo(id_detalle: int, user=Depends(get_current_user)):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT C.ID_NOTA, C.CLAUSULAS_JSON
            FROM NT_DETALLE_CUPS D
            JOIN NT_AGRUPADORES A ON A.ID_AGRUPADOR = D.ID_AGRUPADOR
            JOIN NT_CABECERA C ON C.ID_NOTA = A.ID_NOTA
            WHERE D.ID_DETALLE = :id_detalle
            """,
            {"id_detalle": id_detalle},
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Detalle CUPS no encontrado")

        id_nota = int(row[0])
        clausulas_list, contratacion_estados = parsear_clausulas_y_estados(row[1])

        if str(id_detalle) not in contratacion_estados:
            raise HTTPException(
                status_code=403,
                detail="No se pueden eliminar procedimientos cargados desde el Excel base.",
            )

        cur.execute(
            "DELETE FROM NT_DETALLE_CUPS WHERE ID_DETALLE = :id_detalle",
            {"id_detalle": id_detalle},
        )
        contratacion_estados.pop(str(id_detalle), None)
        guardar_clausulas_y_estados(conn, cur, id_nota, clausulas_list, contratacion_estados)
        conn.commit()
        return {"mensaje": "CUPS eliminado correctamente", "id_detalle": id_detalle}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


def obtener_config_eps_nota(cur, id_nota: int) -> dict:
    cur.execute(
        "SELECT CONTRATANTE, CONSECUTIVO FROM NT_CABECERA WHERE ID_NOTA = :id_nota",
        {"id_nota": id_nota},
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Nota técnica no encontrada")
    contratante = str(row[0] or "")
    consecutivo = row[1]
    if "SANITAS" in contratante.upper():
        return {
            "configurado": True,
            "eps_key": "SANITAS",
            "contratante": contratante,
            "consecutivo": consecutivo,
        }
    return {
        "configurado": False,
        "eps_key": "NO_CONFIGURADA",
        "contratante": contratante,
        "consecutivo": consecutivo,
    }


def _condicion_empresa_pgp(codempresa: str) -> tuple[str, dict]:
    if codempresa in ("10243", "10244"):
        return "t.codempresa = :codempresa", {"codempresa": codempresa}
    return "t.codempresa IN ('10243', '10244')", {}


_MES_NUM_TO_KEY = {
    1: "enero",
    2: "febrero",
    3: "marzo",
    4: "abril",
    5: "mayo",
    6: "junio",
    7: "julio",
    8: "agosto",
    9: "septiembre",
    10: "octubre",
    11: "noviembre",
    12: "diciembre",
}

_MES_KEYS_PGP = list(_MES_NUM_TO_KEY.values())

_CIE10_CACHE = {
    "ts": 0.0,
    "dx_to_agrupador": {},
    "agrupador_to_dxs": {},
    "agrupadores_ordenados": [],
}

_PGP_QUERY_CACHE: dict = {}
_PGP_CACHE_MAX = 30
_PGP_CACHE_TTL = 60

_TMPBI1_COL_NOMBRE: dict = {"col": None}


def _configurar_cursor_pgp(cur) -> None:
    cur.arraysize = 5000
    cur.prefetchrows = 5001


def obtener_mapa_cie10(cur) -> dict:
    ahora = time.time()
    if _CIE10_CACHE["dx_to_agrupador"] and (ahora - _CIE10_CACHE["ts"] < 21600):
        return _CIE10_CACHE

    cur.execute("""
        SELECT
            UPPER(TRIM(i.diacod)) AS diacod,
            MIN(TRIM(h.locnom)) AS locnom
        FROM india i
        INNER JOIN hiloc h ON i.diasub = h.loccod
        WHERE i.diacod IS NOT NULL
          AND h.locnom IS NOT NULL
        GROUP BY UPPER(TRIM(i.diacod))
    """)
    dx_to_agr: dict[str, str] = {}
    agr_to_dxs: dict[str, list[str]] = {}
    for diacod, locnom in cur.fetchall():
        if not diacod or not locnom:
            continue
        diacod_s = str(diacod).strip().upper()
        locnom_s = str(locnom).strip()
        dx_to_agr[diacod_s] = locnom_s
        agr_to_dxs.setdefault(locnom_s, []).append(diacod_s)

    agrupadores = sorted(agr_to_dxs.keys())
    if "OTROS" not in agrupadores:
        agrupadores.append("OTROS")

    _CIE10_CACHE["ts"] = ahora
    _CIE10_CACHE["dx_to_agrupador"] = dx_to_agr
    _CIE10_CACHE["agrupador_to_dxs"] = agr_to_dxs
    _CIE10_CACHE["agrupadores_ordenados"] = agrupadores
    return _CIE10_CACHE


def _pgp_cache_key(
    id_nota: int,
    f_ini: str,
    f_fin: str,
    codempresa: str,
    agrupador: str,
    dx1: str,
    tipo: str,
) -> str:
    return (
        f"{tipo}|{id_nota}|{f_ini}|{f_fin}|{codempresa}|{agrupador}|"
        f"{(dx1 or '').strip().upper()}"
    )


def _pgp_cache_get(tipo: str, key: str):
    entry = _PGP_QUERY_CACHE.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > _PGP_CACHE_TTL:
        _PGP_QUERY_CACHE.pop(key, None)
        return None
    if entry.get("tipo") != tipo:
        return None
    return entry["data"]


def _pgp_cache_set(tipo: str, key: str, data) -> None:
    if len(_PGP_QUERY_CACHE) >= _PGP_CACHE_MAX:
        oldest_key = min(_PGP_QUERY_CACHE, key=lambda k: _PGP_QUERY_CACHE[k]["ts"])
        _PGP_QUERY_CACHE.pop(oldest_key, None)
    _PGP_QUERY_CACHE[key] = {"ts": time.time(), "tipo": tipo, "data": data}


def _condicion_fecha_pgp() -> str:
    return (
        "t.fecha >= TO_DATE(:fecha_inicio, 'YYYY-MM-DD') "
        "AND t.fecha < TO_DATE(:fecha_fin, 'YYYY-MM-DD') + 1"
    )


def _condiciones_agrupador_pgp(
    agrupador: str,
    mapa_cie10: dict,
) -> tuple[list[str], dict, bool]:
    """Retorna (condiciones_extra, params_extra, resultado_vacio_inmediato)."""
    if not agrupador or agrupador == "ALL":
        return [], {}, False

    if agrupador == "OTROS":
        return [
            """(
                t.dx1 IS NULL OR NOT EXISTS (
                    SELECT 1
                    FROM india i
                    INNER JOIN hiloc h ON i.diasub = h.loccod
                    WHERE UPPER(TRIM(i.diacod)) = UPPER(TRIM(t.dx1))
                      AND h.locnom IS NOT NULL
                )
            )"""
        ], {}, False

    agr_to_dxs = mapa_cie10.get("agrupador_to_dxs", {})
    codigos = agr_to_dxs.get(agrupador)
    if codigos is None:
        agr_up = agrupador.strip().upper()
        for nombre, cods in agr_to_dxs.items():
            if nombre.strip().upper() == agr_up:
                codigos = cods
                break

    if not codigos:
        return [], {}, True

    if len(codigos) <= 950:
        binds = []
        params: dict = {}
        for i, cod in enumerate(codigos):
            pname = f"dx_{i}"
            binds.append(f":{pname}")
            params[pname] = cod
        return [f"UPPER(TRIM(t.dx1)) IN ({', '.join(binds)})"], params, False

    return [
        """EXISTS (
            SELECT 1
            FROM india i
            INNER JOIN hiloc h ON i.diasub = h.loccod
            WHERE UPPER(TRIM(i.diacod)) = UPPER(TRIM(t.dx1))
              AND UPPER(TRIM(h.locnom)) = UPPER(TRIM(:agrupador))
              AND h.locnom IS NOT NULL
        )"""
    ], {"agrupador": agrupador}, False


def _construir_filtros_pgp(
    f_ini: str,
    f_fin: str,
    codempresa: str = "ALL",
    agrupador: str = "ALL",
    dx1: str = "",
    mapa_cie10: Optional[dict] = None,
) -> tuple[str, dict, bool]:
    dx1 = (dx1 or "").strip()
    condiciones = [
        "t.tarifa = 'DN'",
        "(t.fuente <> 'AC' OR t.fuente IS NULL)",
        _condicion_fecha_pgp(),
    ]
    params: dict = {"fecha_inicio": f_ini, "fecha_fin": f_fin}

    if codempresa in ("10243", "10244"):
        condiciones.append("t.codempresa = :codempresa")
        params["codempresa"] = codempresa
    else:
        condiciones.append("t.codempresa IN ('10243', '10244')")

    mapa = mapa_cie10 or _CIE10_CACHE

    if dx1:
        condiciones.append(
            "(UPPER(TRIM(t.dx1)) LIKE '%' || UPPER(TRIM(:dx1)) || '%' "
            "OR UPPER(TRIM(t.dx1nom)) LIKE '%' || UPPER(TRIM(:dx1)) || '%')"
        )
        params["dx1"] = dx1
    elif agrupador and agrupador != "ALL":
        cond_agr, params_agr, vacio = _condiciones_agrupador_pgp(agrupador, mapa)
        if vacio:
            return "1=0", params, True
        condiciones.extend(cond_agr)
        params.update(params_agr)

    return " AND ".join(condiciones), params, False


def _resolver_col_nombre_tmpbi1(cur) -> Optional[str]:
    if _TMPBI1_COL_NOMBRE["col"] is not None:
        return _TMPBI1_COL_NOMBRE["col"]
    cur.execute("""
        SELECT COLUMN_NAME
        FROM ALL_TAB_COLUMNS
        WHERE TABLE_NAME = 'TMPBI1'
          AND COLUMN_NAME IN ('NOMBRES', 'NOMBRE', 'PACNOM', 'NOMBRE_PACIENTE', 'PACIENTE')
    """)
    cols_disponibles = {r[0].upper() for r in cur.fetchall()}
    col_nombre = next(
        (c for c in ("NOMBRES", "NOMBRE", "PACNOM", "NOMBRE_PACIENTE", "PACIENTE") if c in cols_disponibles),
        None,
    )
    _TMPBI1_COL_NOMBRE["col"] = col_nombre
    return col_nombre


def _pivot_resumen_pgp_python(rows_agregadas) -> list:
    grupos: dict[tuple, dict] = {}
    for agrupa, tarifa, codemp, empresa, num_mes, pacientes, valor_total in rows_agregadas:
        if num_mes is None:
            continue
        mes_i = int(num_mes)
        mes_key = _MES_NUM_TO_KEY.get(mes_i)
        if not mes_key:
            continue
        key = (agrupa, tarifa, codemp, empresa)
        if key not in grupos:
            grupos[key] = {
                "pacientes": {m: 0.0 for m in _MES_KEYS_PGP},
                "total": {m: 0.0 for m in _MES_KEYS_PGP},
            }
        grupos[key]["pacientes"][mes_key] += float(pacientes or 0)
        grupos[key]["total"][mes_key] += float(valor_total or 0)

    filas = []
    for (agrupa, tarifa, codemp, empresa), datos in sorted(grupos.items(), key=lambda x: (str(x[0][2]), str(x[0][0]))):
        for metrica, meses_map in (("Pacientes", datos["pacientes"]), ("Total", datos["total"])):
            acumulado = sum(meses_map.values())
            fila = {
                "agrupaempresa": agrupa,
                "tarifa": tarifa,
                "codempresa": codemp,
                "empresa": empresa,
                "metrica": metrica,
                "acumulado": acumulado,
            }
            for mk in _MES_KEYS_PGP:
                fila[mk] = meses_map[mk]
            filas.append(fila)

    filas.sort(key=lambda r: (str(r["codempresa"]), 0 if r["metrica"] == "Pacientes" else 1))
    return filas


def _pgp_resumen_sanitas(
    cur,
    mapa_cie10: dict,
    f_ini: str,
    f_fin: str,
    codempresa: str = "ALL",
    agrupador: str = "ALL",
    dx1: str = "",
) -> tuple[list, int]:
    where_sql, params, vacio = _construir_filtros_pgp(
        f_ini, f_fin, codempresa, agrupador, dx1, mapa_cie10
    )
    if vacio:
        return [], 0

    _configurar_cursor_pgp(cur)
    query_agr = f"""
        SELECT
            GROUPING(t.agrupaempresa) AS g_agr,
            GROUPING(t.codempresa) AS g_cod,
            GROUPING(EXTRACT(MONTH FROM t.fecha)) AS g_mes,
            t.agrupaempresa,
            t.tarifa,
            t.codempresa,
            t.empresa,
            EXTRACT(MONTH FROM t.fecha) AS num_mes,
            COUNT(DISTINCT t.identificacion) AS pacientes_unicos,
            SUM(NVL(t.total, 0)) AS valor_total
        FROM tmpbi1 t
        WHERE {where_sql}
        GROUP BY GROUPING SETS (
            (t.agrupaempresa, t.tarifa, t.codempresa, t.empresa, EXTRACT(MONTH FROM t.fecha)),
            ()
        )
    """
    cur.execute(query_agr, params)
    rows_mensuales = []
    pacientes_unicos_rango = 0
    for g_agr, g_cod, g_mes, agrupa, tarifa, codemp, empresa, num_mes, pac, val in cur.fetchall():
        if g_agr == 1 and g_cod == 1 and g_mes == 1:
            pacientes_unicos_rango = int(pac or 0)
        elif g_agr == 0 and g_mes == 0:
            rows_mensuales.append((agrupa, tarifa, codemp, empresa, num_mes, pac, val))

    filas = _pivot_resumen_pgp_python(rows_mensuales)
    return filas, pacientes_unicos_rango


def _pgp_detalle_sanitas(
    cur,
    mapa_cie10: dict,
    f_ini: str,
    f_fin: str,
    codempresa: str = "ALL",
    agrupador: str = "ALL",
    dx1: str = "",
) -> list:
    where_sql, params, vacio = _construir_filtros_pgp(
        f_ini, f_fin, codempresa, agrupador, dx1, mapa_cie10
    )
    if vacio:
        return []

    col_nombre = _resolver_col_nombre_tmpbi1(cur)
    col_nombre_sql = f"t.{col_nombre}" if col_nombre else "''"
    dx_to_agr = mapa_cie10.get("dx_to_agrupador", {})

    query = f"""
        SELECT
            TO_CHAR(TRUNC(t.fecha), 'YYYY-MM-DD') AS fecha,
            TO_CHAR(t.fecha, 'YYYY-MM') AS mes,
            t.agrupaempresa,
            t.tarifa,
            t.codempresa,
            CASE t.codempresa
                WHEN '10243' THEN 'EPS SANITAS CONTRIBUTIVO'
                WHEN '10244' THEN 'EPS SANITAS SUBSIDIADO'
                ELSE t.empresa
            END AS empresa,
            t.fuente,
            t.identificacion,
            {col_nombre_sql} AS nombre_paciente,
            t.dx1,
            t.dx1nom,
            NVL(t.total, 0) AS total
        FROM tmpbi1 t
        WHERE {where_sql}
        ORDER BY
            t.fecha ASC,
            t.codempresa ASC,
            t.identificacion ASC
    """
    _configurar_cursor_pgp(cur)
    cur.execute(query, params)
    registros = []
    for r in cur.fetchall():
        dx1_val = str(r[9] or "").strip()
        agrupador_row = dx_to_agr.get(dx1_val.upper(), "OTROS")
        registros.append({
            "fecha": r[0],
            "mes": r[1],
            "agrupaempresa": r[2],
            "tarifa": r[3],
            "codempresa": r[4],
            "empresa": r[5],
            "fuente": r[6] or "",
            "identificacion": str(r[7] or ""),
            "nombres": str(r[8] or "").strip(),
            "agrupador": agrupador_row,
            "dx1": dx1_val,
            "dx1nom": str(r[10] or "").strip(),
            "total": float(r[11] or 0),
        })
    return registros


@app.get("/api/notas-tecnicas/{id_nota}/pgp-resumen-mensual")
def obtener_resumen_mensual_pgp_por_nota(
    id_nota: int,
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    codempresa: str = Query("ALL"),
    agrupador: str = Query("ALL"),
    dx1: str = Query(""),
    user=Depends(get_current_user),
):
    anio_actual = date.today().year
    f_ini = fecha_inicio or f"{anio_actual}-01-01"
    f_fin = fecha_fin or f"{anio_actual}-12-31"

    conn = get_connection()
    cur = conn.cursor()
    try:
        eps_info = obtener_config_eps_nota(cur, id_nota)
        if not eps_info["configurado"]:
            return {
                "configurado": False,
                "contratante": eps_info["contratante"],
                "fecha_inicio": f_ini,
                "fecha_fin": f_fin,
                "agrupadores": [],
                "data": [],
            }
        if eps_info["eps_key"] == "SANITAS":
            cache_key = _pgp_cache_key(id_nota, f_ini, f_fin, codempresa, agrupador, dx1, "resumen")
            cached = _pgp_cache_get("resumen", cache_key)
            if cached is not None:
                return cached

            mapa_cie10 = obtener_mapa_cie10(cur)
            lista_agrupadores = list(mapa_cie10.get("agrupadores_ordenados", []))
            filas, pacientes_unicos = _pgp_resumen_sanitas(
                cur, mapa_cie10, f_ini, f_fin, codempresa, agrupador, dx1
            )
            payload = {
                "configurado": True,
                "contratante": eps_info["contratante"],
                "fecha_inicio": f_ini,
                "fecha_fin": f_fin,
                "agrupadores": lista_agrupadores,
                "pacientes_unicos_rango": pacientes_unicos,
                "data": filas,
            }
            _pgp_cache_set("resumen", cache_key, payload)
            return payload
        return {
            "configurado": False,
            "contratante": eps_info["contratante"],
            "fecha_inicio": f_ini,
            "fecha_fin": f_fin,
            "agrupadores": [],
            "data": [],
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error consultando resumen PGP en tmpbi1: {str(e)}")
    finally:
        cur.close()
        conn.close()


@app.get("/api/notas-tecnicas/{id_nota}/pgp-detalle-pacientes")
def obtener_detalle_pacientes_pgp_por_nota(
    id_nota: int,
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    codempresa: str = Query("ALL"),
    agrupador: str = Query("ALL"),
    dx1: str = Query(""),
    user=Depends(get_current_user),
):
    anio_actual = date.today().year
    f_ini = fecha_inicio or f"{anio_actual}-01-01"
    f_fin = fecha_fin or f"{anio_actual}-12-31"

    conn = get_connection()
    cur = conn.cursor()
    try:
        eps_info = obtener_config_eps_nota(cur, id_nota)
        if not eps_info["configurado"]:
            return {
                "configurado": False,
                "contratante": eps_info["contratante"],
                "fecha_inicio": f_ini,
                "fecha_fin": f_fin,
                "total_registros": 0,
                "data": [],
            }
        if eps_info["eps_key"] == "SANITAS":
            cache_key = _pgp_cache_key(id_nota, f_ini, f_fin, codempresa, agrupador, dx1, "detalle")
            cached = _pgp_cache_get("detalle", cache_key)
            if cached is not None:
                return cached

            mapa_cie10 = obtener_mapa_cie10(cur)
            registros = _pgp_detalle_sanitas(
                cur, mapa_cie10, f_ini, f_fin, codempresa, agrupador, dx1
            )
            payload = {
                "configurado": True,
                "contratante": eps_info["contratante"],
                "fecha_inicio": f_ini,
                "fecha_fin": f_fin,
                "total_registros": len(registros),
                "data": registros,
            }
            _pgp_cache_set("detalle", cache_key, payload)
            return payload
        return {
            "configurado": False,
            "contratante": eps_info["contratante"],
            "fecha_inicio": f_ini,
            "fecha_fin": f_fin,
            "total_registros": 0,
            "data": [],
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error consultando detalle de pacientes PGP: {str(e)}")
    finally:
        cur.close()
        conn.close()


@app.get("/api/notas-tecnicas/{id_nota}/exportar")
def exportar_excel(id_nota: int, user=Depends(get_current_user)):
    nota = obtener_nota_completa(id_nota)
    xlsx_bytes = generar_excel_nota_tecnica(nota)
    filename = f"NT_{nota['consecutivo'] or id_nota}_EXPORT.xlsx"
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )