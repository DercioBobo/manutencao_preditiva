# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""One-off import of the legacy "Action Tracker" Excel files (vibration
analysis and thermography) into Campanha De Inspecao / Achado De Inspecao.

Not wired into hooks.py/patches.txt on purpose - this is historical data
for a specific rollout, not a schema migration every install should run.
Requires openpyxl on the bench's python environment (`pip install openpyxl`).

Run on the target site, e.g.:

	bench --site <site> execute manutencao_preditiva.setup.import_action_trackers.run \\
		--kwargs "{'vibration_file': '/path/to/FR.TEC.014...xlsx', \\
		'thermography_file': '/path/to/FR.TEC.016...xlsx'}"
"""

import frappe
from frappe.utils import cstr, flt

VIBRATION_SEVERITY = {
	1: "Crítico",
	2: "Alarme",
	3: "Boa Condição",
	4: "Aceitável",
	5: "Não Recolhido",
}

# Cell fill colours actually used as severity highlights in the thermography
# tracker (the legend's own default/theme banding colour is deliberately
# NOT in here - only manually-applied highlights mean anything).
THERMO_CRITICAL_RGB = {"FFFF0000"}
THERMO_ALARM_RGB = {"FFFFC000", "FFED7D31", "FFFFA500"}
THERMO_LOW_RGB = {"FFFFFF00"}

ACTION_STATUS_MAP = {
	"": "Pendente",
	"OPEN": "Pendente",
	"PENDING": "Pendente",
	"IN PROGRESS": "Em Curso",
	"ONGOING": "Em Curso",
	"CLOSED": "Concluído",
	"DONE": "Concluído",
	"COMPLETE": "Concluído",
	"COMPLETED": "Concluído",
	"N/A": "Não Aplicável",
	"NA": "Não Aplicável",
}


def run(vibration_file=None, thermography_file=None, vibration_cliente="Kenmare", thermography_cliente="CLN"):
	created = {"campanhas": 0, "achados": 0}

	if vibration_file:
		created["achados"] += import_vibration(vibration_file, vibration_cliente, created)
	if thermography_file:
		created["achados"] += import_thermography(thermography_file, thermography_cliente, created)

	frappe.db.commit()
	print(f"Campanhas criadas: {created['campanhas']}  Achados criados: {created['achados']}")


def import_vibration(file_path, cliente_nome, created):
	import openpyxl

	ensure_customer(cliente_nome)
	wb = openpyxl.load_workbook(file_path, data_only=True)

	total = 0
	campanha = None

	for sheet_name in wb.sheetnames:
		if sheet_name.strip().upper() == "DROPDOWN MENU":
			continue

		ws = wb[sheet_name]
		header_row = _find_header_row(ws, expected_label="Plant")
		if not header_row:
			continue

		if campanha is None:
			data_da_inspecao = ws.cell(row=header_row, column=6).value
			campanha = ensure_campanha(
				cliente=cliente_nome,
				tecnica="Vibração",
				data_da_inspecao=data_da_inspecao,
				referencia_do_documento="FR.TEC.014",
				created=created,
			)

		for row in ws.iter_rows(min_row=header_row + 1, max_row=ws.max_row):
			equipamento = _cellval(row, 3)
			if not equipamento:
				continue

			severidade_raw = _cellval(row, 6)
			try:
				severidade = VIBRATION_SEVERITY.get(int(severidade_raw), "Não Recolhido")
			except (TypeError, ValueError):
				severidade = "Não Recolhido"

			achado = {
				"campanha": campanha,
				"area_planta": _cellval(row, 4) or sheet_name,
				"item": _cellval(row, 1),
				"equipamento_referencia": equipamento,
				"equipamento_descricao": _cellval(row, 5),
				"componente": _cellval(row, 8),
				"severidade": severidade,
				"descricao_do_defeito": _cellval(row, 7) or "-",
				"acao_recomendada": _cellval(row, 9),
				"resposta_do_cliente": _cellval(row, 10),
			}
			if _create_achado_if_new(achado):
				total += 1

	return total


def import_thermography(file_path, cliente_nome, created):
	import openpyxl

	ensure_customer(cliente_nome)
	wb = openpyxl.load_workbook(file_path, data_only=True)

	total = 0
	campanha = ensure_campanha(
		cliente=cliente_nome,
		tecnica="Termografia",
		data_da_inspecao=None,
		referencia_do_documento="FR.TEC.016",
		created=created,
	)

	for sheet_name in wb.sheetnames:
		ws = wb[sheet_name]
		header_row = _find_header_row(ws, expected_label="Item")
		if not header_row:
			continue

		for row in ws.iter_rows(min_row=header_row + 1, max_row=ws.max_row):
			item = _cellval(row, 2)
			if item is None:
				continue

			equipamento = _cellval(row, 4)
			if not equipamento:
				continue

			temp_max = _to_float(_cellval(row, 10))
			temp_actual = _to_float(_cellval(row, 11))
			temp_amb = _to_float(_cellval(row, 12))
			temp_diff = _to_float(_cellval(row, 13))

			severidade = _classify_thermo_severity(row[3])  # Equipment Reference cell, column D

			descricao = (
				f"Ponto quente detectado por termografia: {temp_actual}°C "
				f"(máx. operação {temp_max}°C, ambiente {temp_amb}°C, diferença {temp_diff}°C)."
				if temp_actual is not None
				else "Ponto quente detectado por termografia."
			)

			achado = {
				"campanha": campanha,
				"area_planta": f"{sheet_name} - {_cellval(row, 3)}" if _cellval(row, 3) else sheet_name,
				"item": item,
				"equipamento_referencia": equipamento,
				"equipamento_descricao": _cellval(row, 5),
				"componente": _cellval(row, 7),
				"numero_da_imagem": cstr(_cellval(row, 8) or ""),
				"ordem_de_servico": cstr(_cellval(row, 9) or ""),
				"severidade": severidade,
				"descricao_do_defeito": descricao,
				"acao_recomendada": _cellval(row, 14),
				"plano_de_monitorizacao": _cellval(row, 15),
				"temp_max_operacao": temp_max,
				"temp_actual": temp_actual,
				"temp_ambiente": temp_amb,
				"diferenca_sobre_max": temp_diff,
				"resposta_do_cliente": _cellval(row, 16),
				"responsavel": _cellval(row, 17),
				"prazo": _cellval(row, 18),
				"estado_da_accao": ACTION_STATUS_MAP.get(cstr(_cellval(row, 19) or "").strip().upper(), "Pendente"),
				"data_de_conclusao": _cellval(row, 20),
			}
			if _create_achado_if_new(achado):
				total += 1

	return total


def ensure_customer(nome):
	if frappe.db.exists("Customer", nome):
		return nome

	doc = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": nome,
			"customer_group": frappe.db.get_single_value("Selling Settings", "customer_group") or "All Customer Groups",
			"territory": frappe.db.get_single_value("Selling Settings", "territory") or "All Territories",
		}
	)
	doc.insert(ignore_permissions=True, ignore_mandatory=True)
	return doc.name


def ensure_campanha(cliente, tecnica, data_da_inspecao, referencia_do_documento, created):
	existing = frappe.db.get_value(
		"Campanha De Inspecao",
		{"cliente": cliente, "tecnica": tecnica, "referencia_do_documento": referencia_do_documento},
	)
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Campanha De Inspecao",
			"cliente": cliente,
			"tecnica": tecnica,
			"data_da_inspecao": data_da_inspecao,
			"referencia_do_documento": referencia_do_documento,
		}
	)
	doc.insert(ignore_permissions=True)
	created["campanhas"] += 1
	return doc.name


def _create_achado_if_new(fields):
	dedup_filters = {
		"campanha": fields["campanha"],
		"area_planta": fields["area_planta"],
		"equipamento_referencia": fields["equipamento_referencia"],
		"item": fields.get("item"),
	}
	if frappe.db.exists("Achado De Inspecao", dedup_filters):
		return False

	doc = frappe.get_doc({"doctype": "Achado De Inspecao", **fields})
	doc.insert(ignore_permissions=True)
	return True


def _find_header_row(ws, expected_label, max_scan_rows=30, search_columns=(1, 2, 3)):
	for r in range(1, min(max_scan_rows, ws.max_row) + 1):
		for c in search_columns:
			if cstr(ws.cell(row=r, column=c).value).strip() == expected_label:
				return r
	return None


def _cellval(row, col_1_indexed):
	value = row[col_1_indexed - 1].value
	if isinstance(value, str):
		value = value.strip() or None
	return value


def _to_float(value):
	if value in (None, ""):
		return None
	return flt(value)


def _classify_thermo_severity(cell):
	fg = cell.fill.fgColor
	if fg is None:
		return "Boa Condição"

	if fg.type == "rgb":
		rgb = fg.rgb
		if rgb in THERMO_CRITICAL_RGB:
			return "Crítico"
		if rgb in THERMO_ALARM_RGB:
			return "Alarme"
		if rgb in THERMO_LOW_RGB:
			return "Aceitável"

	return "Boa Condição"
