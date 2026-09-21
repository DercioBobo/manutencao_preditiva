# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Draft reports stay internal: a client only sees a report, and the sheets
in it, once its status is Issued. Staff (System Manager / Tecnico de
Inspecao) see everything.

Two hooks per doctype, because Frappe uses one for lists/reports/link
searches (a SQL condition) and the other for a single document being opened.
"""

import frappe

STAFF_ROLES = {"System Manager", "Tecnico de Inspecao"}


def _sees_drafts(user):
	return user == "Administrator" or bool(STAFF_ROLES & set(frappe.get_roles(user)))


def report_query_conditions(user=None):
	user = user or frappe.session.user
	if _sees_drafts(user):
		return ""
	return "`tabInspection Report`.status = 'Issued'"


def sheet_query_conditions(user=None):
	user = user or frappe.session.user
	if _sees_drafts(user):
		return ""
	return (
		"exists (select 1 from `tabInspection Report` ir "
		"where ir.name = `tabEquipment Inspection`.report and ir.status = 'Issued')"
	)


def report_has_permission(doc, ptype=None, user=None, **kwargs):
	if _sees_drafts(user or frappe.session.user):
		return True
	return doc.status == "Issued"


def sheet_has_permission(doc, ptype=None, user=None, **kwargs):
	if _sees_drafts(user or frappe.session.user):
		return True
	return frappe.db.get_value("Inspection Report", doc.report, "status") == "Issued"
