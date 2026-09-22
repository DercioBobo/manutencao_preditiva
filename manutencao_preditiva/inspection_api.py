# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Whitelisted entry points for Registo Rápido de Achados (page, not a
Frappe form) - it can't call a Document's own whitelisted method the way a
form does (frm.call), so this wraps the ones it needs.
"""

import frappe


@frappe.whitelist()
def create_equipment_sheets(report):
	"""One empty sheet per active equipment of the report's area that
	doesn't have one yet. Equipment Inspection.create_sheets() already
	checks write permission on the report - see there for details."""
	doc = frappe.get_doc("Inspection Report", report)
	return doc.create_sheets()
