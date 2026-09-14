# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, get_url, validate_email_address

ACCESS_MANAGER_ROLES = ("System Manager", "Gestor de Acessos de Cliente")

# Roles that mean "this is an internal staff login" - reusing one of these
# emails for a client account would silently scope the staff member's own
# Desk access to a single Customer (a User Permission applies to every
# doctype that links to Customer, not just this app's), so it's blocked
# rather than merged.
INTERNAL_ROLES = ("System Manager", "Tecnico de Inspecao")


@frappe.whitelist()
def criar_acesso_cliente(full_name, email, customer, send_welcome=1):
	"""Provision (or extend) Cliente Portal access for one Customer in a
	single call: creates the User if needed (role = Cliente Portal only),
	adds the User Permission that scopes them to that Customer, and returns
	a set-password link - so a non-technical admin doesn't have to visit
	the User and User Permission screens separately, and can't leave the
	portal unscoped by forgetting the permission step.

	Restricted to System Manager / Gestor de Acessos de Cliente; the writes
	below run with ignore_permissions=True so that role needs no direct
	permission on User or User Permission itself.
	"""
	frappe.only_for(ACCESS_MANAGER_ROLES)

	full_name = (full_name or "").strip()
	email = (email or "").strip()
	customer = (customer or "").strip()
	send_welcome = cint(send_welcome)

	if not full_name or not email or not customer:
		frappe.throw(_("Nome, Email e Cliente são obrigatórios."))

	validate_email_address(email, throw=True)

	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("O cliente {0} não existe.").format(customer))

	created_user = not frappe.db.exists("User", email)

	if created_user:
		first_name, _sep, last_name = full_name.partition(" ")
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"last_name": last_name or None,
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": "Cliente Portal"}],
			}
		)
		user.flags.ignore_permissions = True
		user.insert()
	else:
		user = frappe.get_doc("User", email)
		existing_roles = {r.role for r in user.roles}
		if existing_roles & set(INTERNAL_ROLES):
			frappe.throw(
				_(
					"{0} já é uma conta interna ({1}). Use um email diferente para o acesso do cliente."
				).format(email, ", ".join(existing_roles & set(INTERNAL_ROLES)))
			)
		if "Cliente Portal" not in existing_roles:
			user.append("roles", {"role": "Cliente Portal"})
			user.flags.ignore_permissions = True
			user.save()
		if not user.enabled:
			user.enabled = 1
			user.flags.ignore_permissions = True
			user.save()

	already_scoped = frappe.db.exists(
		"User Permission",
		{"user": email, "allow": "Customer", "for_value": customer},
	)
	if not already_scoped:
		perm = frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": email,
				"allow": "Customer",
				"for_value": customer,
				"apply_to_all_doctypes": 1,
			}
		)
		perm.flags.ignore_permissions = True
		perm.insert()

	relative_link = user._reset_password(send_email=bool(send_welcome))

	return {
		"created_user": created_user,
		"email": email,
		"link": get_url(relative_link),
		"email_sent": bool(send_welcome),
	}
