import io
import json
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


def seleccionar_hoja_nota_tecnica(wb):
    for name in wb.sheetnames:
        ws = wb[name]
        h_a18 = str(ws["A18"].value or "").strip().upper()
        if "AGRUPADOR" in h_a18 or "NT_" in name.upper():
            return ws
    return wb.active


def parsear_excel_nota_tecnica(file_bytes: bytes) -> dict:
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = seleccionar_hoja_nota_tecnica(wb)

    vigencia_raw = ws["B15"].value
    if isinstance(vigencia_raw, datetime):
        vigencia_str = vigencia_raw.strftime("%Y-%m-%d")
    else:
        vigencia_str = str(vigencia_raw or "2026-04-01").strip()[:10]

    cabecera = {
        "titulo_anexo": str(ws["C2"].value or "").strip()[:300],
        "contratante": str(ws["B5"].value or "").strip()[:200],
        "contratista": str(ws["B6"].value or "").strip()[:200],
        "nit_prestador": str(ws["B7"].value or "").strip()[:50],
        "regional": str(ws["B8"].value or "").strip()[:100],
        "departamento": str(ws["B9"].value or "").strip()[:100],
        "municipios": str(ws["B10"].value or "").strip()[:250],
        "regimen": str(ws["B11"].value or "").strip()[:150],
        "ambito": str(ws["B12"].value or "").strip()[:150],
        "grupo_etareo": str(ws["B13"].value or "").strip()[:50],
        "especialidad": str(ws["B14"].value or "").strip()[:100],
        "vigencia": vigencia_str,
        "consecutivo": str(ws["B16"].value or "").strip()[:100],
        "poblacion": int(round(float(ws["F7"].value or 0))),
        "pct_contributivo": round(float(ws["H8"].value or 0.78), 4),
        "pct_subsidiado": round(float(ws["H9"].value or 0.22), 4),
    }

    agrupadores = []
    agrupador_actual = None
    orden_agrup = 0
    fila_fin_tabla = 19

    for r in range(19, ws.max_row + 1):
        val_a = ws.cell(r, 1).value
        val_b = ws.cell(r, 2).value
        val_c = ws.cell(r, 3).value

        if val_a and "CARACTERIZACIÓN DE LA POBLACIÓN" in str(val_a).upper():
            fila_fin_tabla = r - 1
            break

        if not val_a and not val_b:
            continue

        if val_a and (val_b is None or str(val_b).strip() == ""):
            orden_agrup += 1
            agrupador_actual = {
                "orden": orden_agrup,
                "nombre_agrupador": str(val_a).strip()[:250],
                "detalles": [],
            }
            agrupadores.append(agrupador_actual)
        elif val_b is not None and agrupador_actual is not None:
            freq_val = ws.cell(r, 4).value
            cme_val = ws.cell(r, 7).value
            agrupador_actual["detalles"].append({
                "orden": len(agrupador_actual["detalles"]) + 1,
                "codigo_cups": str(val_b).strip()[:30],
                "descripcion": str(val_c or "SIN DESCRIPCION").strip()[:500],
                "frecuencia_anual": float(freq_val) if isinstance(freq_val, (int, float)) else 0.0,
                "costo_medio_evento": float(cme_val) if isinstance(cme_val, (int, float)) else 0.0,
            })

    clausulas_inferiores = []
    for r in range(fila_fin_tabla + 1, ws.max_row + 1):
        fila_data = {}
        for c in range(1, 9):
            v = ws.cell(r, c).value
            if v is not None:
                fila_data[str(c)] = str(v) if isinstance(v, datetime) else v
        if fila_data:
            clausulas_inferiores.append({"row_offset": r - fila_fin_tabla, "cells": fila_data})

    cabecera["clausulas_json"] = json.dumps(clausulas_inferiores, ensure_ascii=False)
    return {"cabecera": cabecera, "agrupadores": agrupadores}


def generar_excel_nota_tecnica(nota: dict) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "NT_ONCO_PREREIRA"
    ws.views.sheetView[0].showOutlineSymbols = True
    ws.outline_properties.summaryBelow = False

    font_bold = Font(name="Calibri", size=10, bold=True)
    font_reg = Font(name="Calibri", size=10)
    font_white_bold = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    fill_header = PatternFill("solid", fgColor="D9E1F2")
    fill_kpi_dark = PatternFill("solid", fgColor="1F4E78")
    fill_kpi_sub = PatternFill("solid", fgColor="FCE4D6")
    fill_group = PatternFill("solid", fgColor="E9EDF4")

    thin = Side(border_style="thin", color="8EA9DB")
    border_cell = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.merge_cells("C2:H2")
    ws["C2"] = nota.get("titulo_anexo") or "Anexo Nota Técnica - Atención Primaria - CONTRATO DE PRESTACION DE SERVICIOS DE SALUD POR MODELO DE PAGO GLOBAL PROSPECTIVO HOSPITALARIO"
    ws["C2"].font = Font(name="Calibri", size=11, bold=True)
    ws["C2"].fill = fill_header
    ws["C2"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 30

    meta_rows = [
        (5, "CONTRATANTE:", nota["contratante"]),
        (6, "CONTRATISTA:", nota["contratista"]),
        (7, "NIT DEL PRESTADOR", nota["nit_prestador"]),
        (8, "REGIONAL:", nota["regional"]),
        (9, "DEPARTAMENTO:", nota["departamento"]),
        (10, "MUNICIPIOS DE COBERTURA:", nota["municipios"]),
        (11, "REGIMEN", nota["regimen"]),
        (12, "AMBITO", nota["ambito"]),
        (13, "GRUPO ETAREO", nota["grupo_etareo"]),
        (14, "ESPECIALIDAD (Cuando aplique)", nota["especialidad"]),
        (15, "VIGENCIA", nota["vigencia"]),
        (16, "CONSECUTIVO DE CONTRATO", nota["consecutivo"]),
    ]
    for r, label, val in meta_rows:
        ws.cell(r, 1, label).font = font_bold
        ws.cell(r, 1).fill = fill_header
        ws.cell(r, 2, val).font = font_bold if r in (6, 7, 14) else font_reg

    ws.merge_cells("F5:H5")
    ws["F5"] = "NOTA TECNICA"
    ws["F5"].font = font_bold
    ws["F5"].fill = fill_kpi_sub
    ws["F5"].alignment = Alignment(horizontal="center")

    for col_idx, titulo in [(6, "POBLACION"), (7, "VALOR TOTAL DEL MES"), (8, "CXU")]:
        c = ws.cell(6, col_idx, titulo)
        c.font = font_white_bold
        c.fill = fill_kpi_dark
        c.alignment = Alignment(horizontal="center")

    ws["F7"] = nota["poblacion"]
    ws["F7"].number_format = "#,##0"
    ws["F7"].font = Font(name="Calibri", size=11, bold=True)

    headers = [
        "Agrupador", "Cups", "Descripción", "Frecuencia anual",
        "Eventos año", "Evento mes", "Costo medio evento",
        "Costo total", "CxU", "Agrupador"
    ]
    ws.row_dimensions[18].height = 28
    for idx, h in enumerate(headers, start=1):
        cell = ws.cell(18, idx, h)
        cell.font = font_bold
        cell.fill = fill_header
        cell.border = border_cell
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    current_row = 19
    for agr in nota["agrupadores"]:
        group_row = current_row
        detalles = agr["detalles"]
        start_child = group_row + 1
        end_child = group_row + len(detalles)

        ws.row_dimensions[group_row].outline_level = 1
        ws.cell(group_row, 1, agr["nombre_agrupador"]).font = font_bold
        ws.cell(group_row, 10, agr["nombre_agrupador"]).font = font_bold

        if len(detalles) > 0:
            ws.cell(group_row, 4, f"=SUBTOTAL(9,D{start_child}:D{end_child})").number_format = "0.0000"
            ws.cell(group_row, 5, f"=SUBTOTAL(9,E{start_child}:E{end_child})").number_format = "#,##0"
            ws.cell(group_row, 6, f"=SUBTOTAL(9,F{start_child}:F{end_child})").number_format = "#,##0.00"
            ws.cell(group_row, 7, f"=IFERROR(H{group_row}/F{group_row},0)").number_format = "$ #,##0"
            ws.cell(group_row, 8, f"=SUBTOTAL(9,H{start_child}:H{end_child})").number_format = "$ #,##0"
            ws.cell(group_row, 9, f"=SUBTOTAL(9,I{start_child}:I{end_child})").number_format = "$ #,##0"

        for c in range(1, 11):
            cell = ws.cell(group_row, c)
            cell.font = font_bold
            cell.fill = fill_group
            cell.border = border_cell

        current_row += 1

        for det in detalles:
            r = current_row
            ws.row_dimensions[r].outline_level = 2
            ws.cell(r, 1, agr["nombre_agrupador"])
            ws.cell(r, 2, det["codigo_cups"])
            ws.cell(r, 3, det["descripcion"])

            c_freq = ws.cell(r, 4, det["frecuencia_anual"])
            c_freq.number_format = "0.0000"

            c_ev_a = ws.cell(r, 5, f"=D{r}*$F$7")
            c_ev_a.number_format = "#,##0"

            c_ev_m = ws.cell(r, 6, f"=E{r}/12")
            c_ev_m.number_format = "#,##0.00"

            c_cme = ws.cell(r, 7, det["costo_medio_evento"])
            c_cme.number_format = "$ #,##0"

            c_tot = ws.cell(r, 8, f"=F{r}*G{r}")
            c_tot.number_format = "$ #,##0"

            c_cxu = ws.cell(r, 9, f"=H{r}/$F$7")
            c_cxu.number_format = "$ #,##0"

            ws.cell(r, 10, agr["nombre_agrupador"])

            for c in range(1, 11):
                ws.cell(r, c).border = border_cell
                ws.cell(r, c).font = font_reg

            current_row += 1

    last_table_row = max(19, current_row - 1)

    ws["G7"] = f'=SUMIF(C19:C{last_table_row},"",H19:H{last_table_row})'
    ws["G7"].number_format = "$ #,##0"
    ws["G7"].font = Font(name="Calibri", size=11, bold=True)

    ws["H7"] = "=G7/F7"
    ws["H7"].number_format = "$ #,##0"
    ws["H7"].font = Font(name="Calibri", size=11, bold=True)

    pct_c = nota.get("pct_contributivo", 0.78)
    pct_s = nota.get("pct_subsidiado", 0.22)
    ws["F8"] = "CONTRIBUTIVO"
    ws["G8"] = f"=G7*{pct_c}"
    ws["G8"].number_format = "$ #,##0"
    ws["H8"] = pct_c
    ws["H8"].number_format = "0%"

    ws["F9"] = "SUBSIDIADO"
    ws["G9"] = "=G7-G8"
    ws["G9"].number_format = "$ #,##0"
    ws["H9"] = pct_s
    ws["H9"].number_format = "0%"

    if nota.get("clausulas_json"):
        try:
            raw_clausulas = json.loads(nota["clausulas_json"])
            clausulas = (
                raw_clausulas.get("clausulas", [])
                if isinstance(raw_clausulas, dict)
                else raw_clausulas
            )
            for item in clausulas:
                target_r = last_table_row + item["row_offset"]
                for col_str, val in item["cells"].items():
                    ws.cell(target_r, int(col_str), val)
        except Exception:
            pass

    widths = {1: 38, 2: 14, 3: 55, 4: 16, 5: 15, 6: 15, 7: 20, 8: 22, 9: 15, 10: 32}
    for col_idx, w in widths.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = w

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()