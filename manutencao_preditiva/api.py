# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import secrets

import frappe
from frappe import _
from frappe.sessions import clear_sessions
from frappe.utils import cint, get_url, validate_email_address
from frappe.utils.password import update_password

ACCESS_MANAGER_ROLES = ("System Manager", "Gestor de Acessos de Cliente")

PORTAL_WORKSPACE = "Portal do Cliente"
OWN_MODULE = "Manutencao Preditiva"

# Roles that mean "this is an internal staff login" - reusing one of these
# emails for a client account would silently scope the staff member's own
# Desk access to a single Customer (a User Permission applies to every
# doctype that links to Customer, not just this app's), so it's blocked
# rather than merged.
INTERNAL_ROLES = ("System Manager", "Tecnico de Inspecao")

# No 0/O/1/l/I - a temp password that's read aloud or copied off a phone
# screen shouldn't hinge on telling those apart.
_PWD_LOWER = "abcdefghjkmnpqrstuvwxyz"
_PWD_UPPER = _PWD_LOWER.upper()
_PWD_DIGITS = "23456789"
_PWD_SYMBOLS = "!@#$%*?"


def _generate_temp_password(length=12):
	rand = secrets.SystemRandom()
	required = [
		rand.choice(_PWD_LOWER),
		rand.choice(_PWD_UPPER),
		rand.choice(_PWD_DIGITS),
		rand.choice(_PWD_SYMBOLS),
	]
	pool = _PWD_LOWER + _PWD_UPPER + _PWD_DIGITS
	required += [rand.choice(pool) for _ in range(length - len(required))]
	rand.shuffle(required)
	return "".join(required)


def _restrict_client_desk(user):
	"""Land the user on Portal do Cliente instead of the generic Desk home,
	and hide every other installed app's module (HR, Website, Tools, ...)
	from the sidebar - a client only ever needs to see their own portal, not
	the internal team's workspaces. Computed fresh from Module Def each call
	so it stays correct as apps are added/removed, and mutates the in-memory
	doc only - caller is responsible for saving.
	"""
	if frappe.db.exists("Workspace", PORTAL_WORKSPACE):
		user.default_workspace = PORTAL_WORKSPACE

	other_modules = frappe.get_all("Module Def", pluck="module_name")
	user.set("block_modules", [{"module": m} for m in other_modules if m != OWN_MODULE])


@frappe.whitelist()
def criar_acesso_cliente(full_name, email, customer, send_welcome=1):
	"""Provision (or extend) Cliente Portal access for one Customer in a
	single call: creates the User if needed (role = Cliente Portal only),
	adds the User Permission that scopes them to that Customer, points their
	desk straight at Portal do Cliente and hides every other app's module
	from their sidebar, sets a ready-to-use temporary password on a brand
	new account, and returns a set-password link too - so a non-technical
	admin doesn't have to visit the User and User Permission screens
	separately, can't leave the portal unscoped by forgetting the permission
	step, and can hand the client working credentials immediately instead of
	depending on outgoing email.

	The temp password is only generated for a brand new account - reusing
	this call to add an existing Cliente Portal user to another Customer
	must not silently invalidate a password they're already using.

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
	temp_password = None

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
		_restrict_client_desk(user)
		user.insert()

		temp_password = _generate_temp_password()
		update_password(email, temp_password)
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
		if not user.enabled:
			user.enabled = 1

		# Always reapplied (not just on first creation) so re-running this
		# tool for an already-provisioned client also declutters their desk -
		# e.g. after this restriction was added, for accounts made before it.
		_restrict_client_desk(user)

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
		"password": temp_password,
		"link": get_url(relative_link),
		"email_sent": bool(send_welcome),
	}


def _require_cliente_portal_user(email):
	"""Guard for the management endpoints below - they must only ever act on
	accounts that are genuinely Cliente Portal logins, never an arbitrary
	User, since this tool's role has no other permission on User at all."""
	if not frappe.db.exists("Has Role", {"parent": email, "role": "Cliente Portal"}):
		frappe.throw(_("{0} não é uma conta de Cliente Portal.").format(email))


@frappe.whitelist()
def listar_acessos_cliente():
	"""Every Cliente Portal account, with the Customer(s) it's scoped to -
	the read side of the Gestão de Acessos tool."""
	frappe.only_for(ACCESS_MANAGER_ROLES)

	return frappe.db.sql(
		"""
		select
			u.name as email,
			u.full_name,
			u.enabled,
			group_concat(distinct up.for_value separator ', ') as customers
		from `tabUser` u
		inner join `tabHas Role` hr on hr.parent = u.name and hr.role = 'Cliente Portal'
		left join `tabUser Permission` up on up.user = u.name and up.allow = 'Customer'
		group by u.name
		order by u.full_name
		""",
		as_dict=True,
	)


@frappe.whitelist()
def repor_password_cliente(email):
	"""Fresh temp password + reset link for an existing Cliente Portal user -
	same result shape as creation, so the UI can reuse the same copy-and-hand
	-over flow."""
	frappe.only_for(ACCESS_MANAGER_ROLES)
	email = (email or "").strip()
	_require_cliente_portal_user(email)

	temp_password = _generate_temp_password()
	update_password(email, temp_password)

	user = frappe.get_doc("User", email)
	relative_link = user._reset_password(send_email=False)

	return {"email": email, "password": temp_password, "link": get_url(relative_link)}


@frappe.whitelist()
def alternar_activo_cliente(email, enabled):
	"""Enable/disable a Cliente Portal login. Disabling also kills any
	sessions already open for them - flipping the flag alone would leave an
	already-logged-in tab working until it naturally expires."""
	frappe.only_for(ACCESS_MANAGER_ROLES)
	email = (email or "").strip()
	_require_cliente_portal_user(email)
	enabled = cint(enabled)

	user = frappe.get_doc("User", email)
	user.enabled = enabled
	user.flags.ignore_permissions = True
	user.save()

	if not enabled:
		clear_sessions(email)

	return {"email": email, "enabled": enabled}


@frappe.whitelist()
def mudar_cliente(email, customer):
	"""Repoint a Cliente Portal user at a different Customer - replaces every
	existing Customer User Permission for them rather than adding to it, to
	keep the app's one-customer-per-login assumption intact even if older or
	manually-created data ever had more than one."""
	frappe.only_for(ACCESS_MANAGER_ROLES)
	email = (email or "").strip()
	customer = (customer or "").strip()
	_require_cliente_portal_user(email)

	if not customer:
		frappe.throw(_("Escolhe um cliente."))
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("O cliente {0} não existe.").format(customer))

	frappe.db.delete("User Permission", {"user": email, "allow": "Customer"})

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

	return {"email": email, "customer": customer}
