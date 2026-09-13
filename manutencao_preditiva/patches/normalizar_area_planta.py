# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Achado De Inspecao.area_planta changed from free-text (Data) to a proper
Link (Area De Inspecao), scoped per Cliente, so técnicos get autocomplete
over existing areas instead of retyping (and typo-ing) the plant/room name.

Converts any existing free-text values into Area De Inspecao records and
repoints the Achados at them. Safe to run more than once - re-uses an
existing Area De Inspecao record instead of creating a duplicate, and
skips rows whose area_planta already matches a valid Area name.
"""

import frappe


def execute():
	achados = frappe.get_all(
		"Achado De Inspecao",
		fields=["name", "cliente", "area_planta"],
	)

	area_name_by_key = {}

	for achado in achados:
		if not achado.area_planta or not achado.cliente:
			continue

		if frappe.db.exists("Area De Inspecao", achado.area_planta):
			continue  # already a valid Area De Inspecao name - nothing to do

		key = (achado.cliente, achado.area_planta)
		if key not in area_name_by_key:
			area_name_by_key[key] = _ensure_area(cliente=achado.cliente, area=achado.area_planta)

		frappe.db.set_value(
			"Achado De Inspecao",
			achado.name,
			"area_planta",
			area_name_by_key[key],
			update_modified=False,
		)

	frappe.db.commit()


def _ensure_area(cliente, area):
	existing = frappe.db.get_value("Area De Inspecao", {"cliente": cliente, "area": area})
	if existing:
		return existing

	doc = frappe.get_doc({"doctype": "Area De Inspecao", "cliente": cliente, "area": area})
	doc.insert(ignore_permissions=True)
	return doc.name
