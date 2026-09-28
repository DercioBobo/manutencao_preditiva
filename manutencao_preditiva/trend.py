# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Per-equipment reading history for the trend charts (Equipment form,
client portal finding dialog)."""

import frappe
from frappe.utils import flt


@frappe.whitelist()
def equipment_trend(equipment, limit=24):
	"""Velocity and acceleration of every measurement point, one value per
	sheet, oldest first. Sheets come from frappe.get_list so the caller's
	own permissions apply - a client only gets their customer's Issued
	reports - and readings-only sheets are included on purpose: that's the
	history they exist for."""
	sheets = frappe.get_list(
		"Equipment Inspection",
		filters={"equipment": equipment},
		fields=["name", "report", "report_date", "severity", "readings_only"],
		order_by="report_date desc",
		limit_page_length=int(limit),
	)
	sheets.reverse()
	if not sheets:
		return {"periods": [], "velocity": {}, "acceleration": {}}

	periods = dict(
		frappe.get_all(
			"Inspection Report",
			filters={"name": ["in", [s.report for s in sheets]]},
			fields=["name", "period_label"],
			as_list=True,
		)
	)
	readings = frappe.get_all(
		"Vibration Reading",
		filters={"parenttype": "Equipment Inspection", "parent": ["in", [s.name for s in sheets]]},
		fields=["parent", "point", "velocity_mm_s", "acceleration_g"],
		order_by="idx asc",
	)

	position = {s.name: i for i, s in enumerate(sheets)}
	velocity, acceleration = {}, {}
	for row in readings:
		i = position[row.parent]
		for series, value in ((velocity, row.velocity_mm_s), (acceleration, row.acceleration_g)):
			if flt(value):
				series.setdefault(row.point, [None] * len(sheets))[i] = flt(value)

	return {
		"periods": [
			{
				"label": periods.get(s.report) or str(s.report_date),
				"date": s.report_date,
				"severity": s.severity,
				"readings_only": s.readings_only,
			}
			for s in sheets
		],
		"velocity": velocity,
		"acceleration": acceleration,
	}
