import io
import json
import traceback
from datetime import date
from typing import List, Optional
import oracledb
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from database import get_connection, oracle_config_status
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


class EstadoContratacionPayload(BaseModel):
    estado_contratacion: str


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
                       FRECUENCIA_ANUAL, COSTO_MEDIO_EVENTO
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
        cur.execute(
            """
            INSERT INTO NT_DETALLE_CUPS (
                ID_AGRUPADOR, ORDEN, CODIGO_CUPS, DESCRIPCION, FRECUENCIA_ANUAL, COSTO_MEDIO_EVENTO
            ) VALUES (
                :id_agrupador, :orden, :codigo_cups, :descripcion, :frecuencia_anual, :costo_medio_evento
            ) RETURNING ID_DETALLE INTO :id_detalle
            """,
            {
                "id_agrupador": id_agrupador,
                "orden": next_orden,
                "codigo_cups": payload.codigo_cups.strip()[:30],
                "descripcion": payload.descripcion.strip().upper()[:500],
                "frecuencia_anual": round(float(payload.frecuencia_anual), 12),
                "costo_medio_evento": round(float(payload.costo_medio_evento), 4),
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
        }
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


def _pgp_resumen_sanitas(cur, f_ini: str, f_fin: str) -> list:
    query = """
        WITH base AS (
            SELECT 
                agrupaempresa,
                tarifa,
                codempresa,
                empresa,
                EXTRACT(MONTH FROM fecha) AS num_mes,
                COUNT(DISTINCT identificacion) AS pacientes,
                SUM(total) AS valor_total
            FROM tmpbi1
            WHERE codempresa IN ('10243', '10244')
              AND tarifa = 'DN'
              AND (fuente <> 'AC' OR fuente IS NULL)
              AND TRUNC(fecha) BETWEEN TO_DATE(:fecha_inicio, 'YYYY-MM-DD') 
                                   AND TO_DATE(:fecha_fin, 'YYYY-MM-DD')
            GROUP BY 
                agrupaempresa,
                tarifa,
                codempresa,
                empresa,
                EXTRACT(MONTH FROM fecha)
        ),
        despivote_metricas AS (
            SELECT agrupaempresa, tarifa, codempresa, empresa, num_mes, 'Pacientes' AS metrica, 1 AS orden_m, pacientes AS valor FROM base
            UNION ALL
            SELECT agrupaempresa, tarifa, codempresa, empresa, num_mes, 'Total' AS metrica, 2 AS orden_m, valor_total AS valor FROM base
        )
        SELECT 
            agrupaempresa,
            tarifa,
            codempresa,
            empresa,
            metrica,
            NVL(enero, 0) AS enero,
            NVL(febrero, 0) AS febrero,
            NVL(marzo, 0) AS marzo,
            NVL(abril, 0) AS abril,
            NVL(mayo, 0) AS mayo,
            NVL(junio, 0) AS junio,
            NVL(julio, 0) AS julio,
            NVL(agosto, 0) AS agosto,
            NVL(septiembre, 0) AS septiembre,
            NVL(octubre, 0) AS octubre,
            NVL(noviembre, 0) AS noviembre,
            NVL(diciembre, 0) AS diciembre
        FROM despivote_metricas
        PIVOT (
            SUM(valor)
            FOR num_mes IN (
                1 AS enero, 2 AS febrero, 3 AS marzo, 4 AS abril,
                5 AS mayo, 6 AS junio, 7 AS julio, 8 AS agosto,
                9 AS septiembre, 10 AS octubre, 11 AS noviembre, 12 AS diciembre
            )
        )
        ORDER BY 
            codempresa,
            orden_m
    """
    cur.execute(query, {"fecha_inicio": f_ini, "fecha_fin": f_fin})
    filas = []
    for r in cur.fetchall():
        meses = [float(r[i] or 0) for i in range(5, 17)]
        filas.append({
            "agrupaempresa": r[0],
            "tarifa": r[1],
            "codempresa": r[2],
            "empresa": r[3],
            "metrica": r[4],
            "enero": meses[0],
            "febrero": meses[1],
            "marzo": meses[2],
            "abril": meses[3],
            "mayo": meses[4],
            "junio": meses[5],
            "julio": meses[6],
            "agosto": meses[7],
            "septiembre": meses[8],
            "octubre": meses[9],
            "noviembre": meses[10],
            "diciembre": meses[11],
            "acumulado": sum(meses),
        })
    return filas


def _pgp_detalle_sanitas(cur, f_ini: str, f_fin: str) -> list:
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
    expr_nombre = f"{col_nombre} AS nombres" if col_nombre else "'' AS nombres"

    query = f"""
        SELECT 
            TO_CHAR(TRUNC(fecha), 'YYYY-MM-DD') AS fecha,
            TO_CHAR(fecha, 'YYYY-MM') AS mes,
            agrupaempresa,
            tarifa,
            codempresa,
            empresa,
            fuente,
            identificacion,
            {expr_nombre},
            NVL(total, 0) AS total
        FROM tmpbi1
        WHERE codempresa IN ('10243', '10244')
          AND tarifa = 'DN'
          AND (fuente <> 'AC' OR fuente IS NULL)
          AND TRUNC(fecha) BETWEEN TO_DATE(:fecha_inicio, 'YYYY-MM-DD') 
                               AND TO_DATE(:fecha_fin, 'YYYY-MM-DD')
        ORDER BY 
            fecha ASC,
            codempresa ASC,
            identificacion ASC
    """
    cur.execute(query, {"fecha_inicio": f_ini, "fecha_fin": f_fin})
    return [
        {
            "fecha": r[0],
            "mes": r[1],
            "agrupaempresa": r[2],
            "tarifa": r[3],
            "codempresa": r[4],
            "empresa": r[5],
            "fuente": r[6] or "",
            "identificacion": str(r[7] or ""),
            "nombres": str(r[8] or "").strip(),
            "total": float(r[9] or 0),
        }
        for r in cur.fetchall()
    ]


@app.get("/api/notas-tecnicas/{id_nota}/pgp-resumen-mensual")
def obtener_resumen_mensual_pgp_por_nota(
    id_nota: int,
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
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
                "data": [],
            }
        if eps_info["eps_key"] == "SANITAS":
            filas = _pgp_resumen_sanitas(cur, f_ini, f_fin)
            return {
                "configurado": True,
                "contratante": eps_info["contratante"],
                "fecha_inicio": f_ini,
                "fecha_fin": f_fin,
                "data": filas,
            }
        return {
            "configurado": False,
            "contratante": eps_info["contratante"],
            "fecha_inicio": f_ini,
            "fecha_fin": f_fin,
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
            registros = _pgp_detalle_sanitas(cur, f_ini, f_fin)
            return {
                "configurado": True,
                "contratante": eps_info["contratante"],
                "fecha_inicio": f_ini,
                "fecha_fin": f_fin,
                "total_registros": len(registros),
                "data": registros,
            }
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