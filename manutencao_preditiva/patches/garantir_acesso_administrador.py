# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Make the Administrador role work on sites where the plain rename in
renomear_gestor_de_acessos was skipped (e.g. an "Administrador" role already
existed), which left the Gestão de Utilizadores page and the Gestao de
Acessos workspace still pointing at the old role - "Sem permissão para
Página" for every Administrador.

Also brings existing Administradores up to the full staff profile (see
api.PROFILES). Idempotent, so safe on sites where everything already lined
up."""

import frappe

OLD_ROLE = "Gestor de Acessos de Cliente"
ADMIN_ROLE = "Administrador"
STAFF_ROLES = ("Tecnico de Inspecao", "Gestor de Inspecao", ADMIN_ROLE)

PAGE = "criar-acesso-de-cliente"
WORKSPACE = "Gestao de Acessos"


def execute():
	# Fixtures sync after patches, so on the first migrate these may not exist yet.
	for role in STAFF_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)

	if frappe.db.exists("Role", OLD_ROLE):
		holders = frappe.get_all(
			"Has Role", filters={"role": OLD_ROLE, "parenttype": "User"}, pluck="parent", distinct=True
		)
		for email in holders:
			frappe.get_doc("User", email).add_roles(ADMIN_ROLE)
		frappe.db.delete("Has Role", {"role": OLD_ROLE})
		frappe.delete_doc("Role", OLD_ROLE, ignore_permissions=True, force=True)

	_ensure_role_row("Page", PAGE)
	_ensure_role_row("Workspace", WORKSPACE)

	admins = frappe.get_all(
		"Has Role", filters={"role": ADMIN_ROLE, "parenttype": "User"}, pluck="parent", distinct=True
	)
	for email in admins:
		if email in ("Administrator", "Guest"):
			continue
		frappe.get_doc("User", email).add_roles(*STAFF_ROLES)

	frappe.clear_cache()


def _ensure_role_row(parenttype, parent):
	if not frappe.db.exists(parenttype, parent):
		return
	if frappe.db.exists("Has Role", {"parenttype": parenttype, "parent": parent, "role": ADMIN_ROLE}):
		return
	frappe.get_doc(
		{
			"doctype": "Has Role",
			"parenttype": parenttype,
			"parent": parent,
			"parentfield": "roles",
			"role": ADMIN_ROLE,
		}
	).db_insert()
