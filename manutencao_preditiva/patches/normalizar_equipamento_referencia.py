# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Achado De Inspecao.equipamento_referencia changed from free-text (Data)
to a proper Link (Equipamento De Inspecao), scoped per Cliente - same
rationale as area_planta: predictive maintenance depends on trending one
specific piece of equipment across campaigns, which free text ("PS 4072"
vs "PS-4072" vs "PS4072") quietly breaks. equipamento_descricao also
became a read-only field fetched from the new master instead of being
retyped on every finding.

Converts existing free-text equipamento_referencia values into
Equipamento De Inspecao records (backfilling each new record's own
descricao from the first non-empty equipamento_descricao found for it)
and repoints the Achados at them. Safe to run more than once.
"""

import frappe


def execute():
	achados = frappe.get_all(
		"Achado De Inspecao",
		fields=["name", "cliente", "equipamento_referencia", "equipamento_descricao"],
	)

	equipamento_name_by_key = {}

	for achado in achados:
		if not achado.equipamento_referencia or not achado.cliente:
			continue

		if frappe.db.exists("Equipamento De Inspecao", achado.equipamento_referencia):
			continue  # already a valid Equipamento De Inspecao name - nothing to do

		key = (achado.cliente, achado.equipamento_referencia)
		if key not in equipamento_name_by_key:
			equipamento_name_by_key[key] = _ensure_equipamento(
				cliente=achado.cliente,
				equipamento=achado.equipamento_referencia,
				descricao=achado.equipamento_descricao,
			)

		frappe.db.set_value(
			"Achado De Inspecao",
			achado.name,
			"equipamento_referencia",
			equipamento_name_by_key[key],
			update_modified=False,
		)

	frappe.db.commit()


def _ensure_equipamento(cliente, equipamento, descricao):
	existing = frappe.db.get_value("Equipamento De Inspecao", {"cliente": cliente, "equipamento": equipamento})
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Equipamento De Inspecao",
			"cliente": cliente,
			"equipamento": equipamento,
			"descricao": descricao,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name
