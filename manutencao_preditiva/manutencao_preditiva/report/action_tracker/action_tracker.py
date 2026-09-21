# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""The summary the team used to build by hand in Excel: one row per
equipment sheet, with the client's response next to it. Use the report
view's Export > Excel to get the file.

Reads through get_list, not get_all, so a client only ever gets their own
customer's issued sheets.
"""

import frappe
from frappe import _

FIELDS = [
	"name",
	"report",
	"report_date",
	"customer",
	"area",
	"equipment",
	"equipment_description",
	"severity",
	"defects",
	"recommendations",
	"follow_up",
	"client_response",
	"responsible",
	"due_date",
	"action_status",
	"completion_date",
]


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Sheet"), "fieldname": "name", "fieldtype": "Link", "options": "Equipment Inspection", "width": 130},
		{"label": _("Report"), "fieldname": "report", "fieldtype": "Link", "options": "Inspection Report", "width": 130},
		{"label": _("Date"), "fieldname": "report_date", "fieldtype": "Date", "width": 95},
		{"label": _("Customer"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 150},
		{"label": _("Area"), "fieldname": "area", "fieldtype": "Link", "options": "Inspection Area", "width": 150},
		{"label": _("Equipment"), "fieldname": "equipment", "fieldtype": "Link", "options": "Inspection Equipment", "width": 110},
		{"label": _("Description"), "fieldname": "equipment_description", "fieldtype": "Data", "width": 220},
		{"label": _("Severity"), "fieldname": "severity", "fieldtype": "Data", "width": 100},
		{"label": _("Defects Found"), "fieldname": "defects", "fieldtype": "Data", "width": 240},
		{"label": _("Recommendations"), "fieldname": "recommendations", "fieldtype": "Data", "width": 280},
		{"label": _("Actions Taken / Follow-up"), "fieldname": "follow_up", "fieldtype": "Data", "width": 240},
		{"label": _("Client Response"), "fieldname": "client_response", "fieldtype": "Data", "width": 240},
		{"label": _("Responsible"), "fieldname": "responsible", "fieldtype": "Data", "width": 130},
		{"label": _("Due Date"), "fieldname": "due_date", "fieldtype": "Date", "width": 95},
		{"label": _("Action Status"), "fieldname": "action_status", "fieldtype": "Data", "width": 110},
		{"label": _("Completion Date"), "fieldname": "completion_date", "fieldtype": "Date", "width": 110},
	]


def get_data(filters):
	conditions = [
		[field, "=", filters[field]]
		for field in ("customer", "report", "area", "severity", "action_status")
		if filters.get(field)
	]
	if filters.get("from_date"):
		conditions.append(["report_date", ">=", filters.from_date])
	if filters.get("to_date"):
		conditions.append(["report_date", "<=", filters.to_date])
	if filters.get("hide_normal"):
		conditions.append(["severity", "not in", ["Normal", "Not Collected"]])

	return frappe.get_list(
		"Equipment Inspection",
		filters=conditions,
		fields=FIELDS,
		order_by="report_date desc, area, equipment_description",
		limit_page_length=0,
	)
