# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""The thermography import stored temperature/difference values straight
from openpyxl's raw float read (e.g. -24.200000000000003) instead of
rounding them, which then got baked verbatim into descricao_do_defeito's
auto-generated text. import_action_trackers._to_float now rounds to 2
decimals at the source; this patch fixes the values already imported.

Only touches Termografia achados, and only regenerates descricao_do_defeito
when it still matches the known auto-generated prefix - a técnico's or
client's own edits (or the "Resposta do Cliente" fields) are never
touched. Safe to run more than once.
"""

import frappe
from frappe.utils import flt

DESCRICAO_PREFIXO = "Ponto quente detectado por termografia"


def execute():
	rows = frappe.get_all(
		"Achado De Inspecao",
		filters={"tecnica": "Termografia"},
		fields=[
			"name",
			"temp_max_operacao",
			"temp_actual",
			"temp_ambiente",
			"diferenca_sobre_max",
			"descricao_do_defeito",
		],
	)

	for row in rows:
		temp_max = flt(row.temp_max_operacao, 2) if row.temp_max_operacao is not None else None
		temp_actual = flt(row.temp_actual, 2) if row.temp_actual is not None else None
		temp_amb = flt(row.temp_ambiente, 2) if row.temp_ambiente is not None else None
		temp_diff = flt(row.diferenca_sobre_max, 2) if row.diferenca_sobre_max is not None else None

		updates = {}
		if temp_max != row.temp_max_operacao:
			updates["temp_max_operacao"] = temp_max
		if temp_actual != row.temp_actual:
			updates["temp_actual"] = temp_actual
		if temp_amb != row.temp_ambiente:
			updates["temp_ambiente"] = temp_amb
		if temp_diff != row.diferenca_sobre_max:
			updates["diferenca_sobre_max"] = temp_diff

		if (
			row.descricao_do_defeito
			and row.descricao_do_defeito.startswith(DESCRICAO_PREFIXO)
			and temp_actual is not None
		):
			nova_descricao = (
				f"Ponto quente detectado por termografia: {temp_actual}°C "
				f"(máx. operação {temp_max}°C, ambiente {temp_amb}°C, diferença {temp_diff}°C)."
			)
			if nova_descricao != row.descricao_do_defeito:
				updates["descricao_do_defeito"] = nova_descricao

		if updates:
			frappe.db.set_value("Achado De Inspecao", row.name, updates, update_modified=False)

	frappe.db.commit()
