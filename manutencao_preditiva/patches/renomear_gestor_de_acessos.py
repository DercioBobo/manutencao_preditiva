# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Gestor de Acessos de Cliente now manages staff logins too, so it became
Administrador. Renamed rather than recreated so everyone who already held it
keeps it (rename_doc repoints every Has Role row). Runs pre-model-sync so the
Page and Workspace JSON that already reference the new name sync cleanly."""

import frappe

OLD = "Gestor de Acessos de Cliente"
NEW = "Administrador"


def execute():
	if not frappe.db.exists("Role", OLD) or frappe.db.exists("Role", NEW):
		return
	frappe.rename_doc("Role", OLD, NEW, force=True)
	frappe.db.set_value("Role", NEW, "role_name", NEW)
