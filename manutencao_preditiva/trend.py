# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Per-equipment reading history for the trend charts (Equipment form,
client portal finding dialog)."""

import frappe
from frappe.utils import flt, getdate

from manutencao_preditiva.vibration import RANKED


@frappe.whitelist()
def condition_history(max_periods=12):
	"""Every equipment's severity month by month - the evolution matrix and
	condition-over-time chart on My Findings.

	One column per calendar month that has any sheet (the latest
	max_periods), so a readings-only month sits next to the diagnosed
	ones. Sheets come from frappe.get_list: a client only gets their own
	customer's Issued reports. change compares each equipment's two latest
	diagnosed months (worse / better / same)."""
	sheets = frappe.get_list(
		"Equipment Inspection",
		fields=[
			"name",
			"equipment",
			"equipment_description",
			"area",
			"report_date",
			"severity",
			"readings_only",
			"action_status",
		],
		order_by="report_date asc",
		limit_page_length=0,
	)

	def month(d):
		d = getdate(d)
		return f"{d.year}-{d.month:02d}", d.strftime("%b/%y").upper()

	periods = {}
	for s in sheets:
		key, label = month(s.report_date)
		periods[key] = label
	keys = sorted(periods)[-int(max_periods) :]
	kept = set(keys)

	equipment = {}
	for s in sheets:
		key, _label = month(s.report_date)
		if key not in kept:
			continue
		row = equipment.setdefault(
			s.equipment,
			{"equipment": s.equipment, "description": s.equipment_description, "area": s.area, "cells": {}},
		)
		# Two sheets in one month (shouldn't happen): the diagnosed one wins.
		if key in row["cells"] and s.readings_only:
			continue
		row["cells"][key] = {
			"sheet": s.name,
			"report_date": s.report_date,
			"severity": s.severity or None,
			"readings_only": s.readings_only,
			"action_status": s.action_status,
		}

	for row in equipment.values():
		diagnosed = [row["cells"][k]["severity"] for k in keys if k in row["cells"] and row["cells"][k]["severity"]]
		row["latest"] = diagnosed[-1] if diagnosed else None
		row["change"] = None
		if len(diagnosed) >= 2 and diagnosed[-1] in RANKED and diagnosed[-2] in RANKED:
			step = RANKED.index(diagnosed[-1]) - RANKED.index(diagnosed[-2])
			row["change"] = "worse" if step > 0 else "better" if step < 0 else "same"

	area_codes = {row["area"] for row in equipment.values() if row["area"]}
	areas = dict(
		frappe.get_all("Area", filters={"name": ["in", list(area_codes)]}, fields=["name", "area_name"], as_list=True)
	) if area_codes else {}

	return {
		"periods": [{"key": k, "label": periods[k]} for k in keys],
		"areas": areas,
		"equipment": sorted(
			equipment.values(), key=lambda r: (areas.get(r["area"], "") or "", r["description"] or "")
		),
	}


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
