# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import secrets

import frappe
from frappe import _
from frappe.sessions import clear_sessions
from frappe.utils import cint, get_url, validate_email_address
from frappe.utils.password import update_password

ACCESS_MANAGER_ROLES = ("System Manager", "Administrador")

PORTAL_WORKSPACE = "Portal do Cliente"
STAFF_WORKSPACE = "Manutencao Preditiva"
OWN_MODULE = "Manutencao Preditiva"
# Created on the site by hand, not shipped with the app.
MODULE_PROFILE = "MP"

# The only logins the Gestão de Acessos page can create or touch, and the
# roles each profile gets. Each staff profile is layered on the one below,
# so Gestor inherits every technician permission and Administrador has
# everything - each role only needs permission rows for what it adds.
PROFILES = {
	"Técnico de Inspeção": ["Tecnico de Inspecao"],
	"Gestor de Inspeção": ["Tecnico de Inspecao", "Gestor de Inspecao"],
	"Administrador": ["Tecnico de Inspecao", "Gestor de Inspecao", "Administrador"],
	"Cliente": ["Cliente Portal"],
}
CLIENT_PROFILE = "Cliente"
MANAGED_ROLES = {role for roles in PROFILES.values() for role in roles}

# Roles Frappe gives everyone implicitly - never a reason to treat an
# account as "managed elsewhere".
AUTOMATIC_ROLES = {"Administrator", "Guest", "All", "Desk User"}

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


MIN_PASSWORD_LENGTH = 8


def _chosen_or_generated_password(password, email, full_name=None):
	"""The password the admin typed, checked, or a generated one when left
	blank. Beyond a minimum length, the site's own password policy (System
	Settings > Enable Password Policy) applies when it's switched on - the
	same check Frappe runs on its own set-password page."""
	password = (password or "").strip()
	if not password:
		return _generate_temp_password()

	if len(password) < MIN_PASSWORD_LENGTH:
		frappe.throw(_("A password tem de ter pelo menos {0} caracteres.").format(MIN_PASSWORD_LENGTH))

	if cint(frappe.get_system_settings("enable_password_policy")):
		from frappe.core.doctype.user.user import test_password_strength

		result = test_password_strength(password, user_data=(email, full_name or "")) or {}
		feedback = result.get("feedback") or {}
		if not feedback.get("password_policy_validation_passed", True):
			hint = feedback.get("warning") or " ".join(feedback.get("suggestions") or [])
			frappe.throw(_("Password demasiado fraca para a política do sistema.") + (f" {hint}" if hint else ""))
	return password


def _setup_desk(user, profile):
	"""Land the user on their profile's workspace and apply the MP Module
	Profile, which decides which modules show in the sidebar - the User
	controller copies its blocked modules onto the user on save. Mutates the
	in-memory doc only - caller is responsible for saving.

	Without MP on the site, clients fall back to hiding every module but
	this app's (computed fresh from Module Def so it stays correct as apps
	are added/removed) and staff see everything.
	"""
	workspace = PORTAL_WORKSPACE if profile == CLIENT_PROFILE else STAFF_WORKSPACE
	if frappe.db.exists("Workspace", workspace):
		user.default_workspace = workspace

	if frappe.db.exists("Module Profile", MODULE_PROFILE):
		user.module_profile = MODULE_PROFILE
		return

	user.module_profile = None
	if profile == CLIENT_PROFILE:
		other_modules = frappe.get_all("Module Def", pluck="module_name")
		user.set("block_modules", [{"module": m} for m in other_modules if m != OWN_MODULE])
	else:
		user.set("block_modules", [])


def _explicit_roles(email):
	roles = frappe.get_all("Has Role", filters={"parent": email, "parenttype": "User"}, pluck="role")
	return set(roles) - AUTOMATIC_ROLES


def _profile_for(roles):
	for profile in ("Administrador", "Gestor de Inspeção", "Técnico de Inspeção", "Cliente"):
		if set(PROFILES[profile]) <= roles:
			return profile
	return None


def _is_manageable(email, roles=None):
	"""Only accounts made purely of this page's roles. Anything carrying
	another role (System Manager above all) is off limits - otherwise an
	Administrador could reset a System Manager's password and log in as them."""
	if email in ("Administrator", "Guest"):
		return False
	roles = _explicit_roles(email) if roles is None else roles
	return bool(roles) and roles <= MANAGED_ROLES


def _require_manageable(email):
	if not frappe.db.exists("User", email) or not _is_manageable(email):
		frappe.throw(_("{0} não pode ser gerido a partir desta página.").format(email))


def _require_not_self(email):
	if email == frappe.session.user:
		frappe.throw(_("Não podes alterar a tua própria conta aqui."))


def _validate_profile(profile, customer):
	if profile not in PROFILES:
		frappe.throw(_("Perfil inválido: {0}").format(profile))
	if profile == CLIENT_PROFILE:
		if not customer:
			frappe.throw(_("Escolhe o cliente para um acesso de cliente."))
		if not frappe.db.exists("Customer", customer):
			frappe.throw(_("O cliente {0} não existe.").format(customer))


def _apply_profile(user, profile):
	"""Replace the user's roles with exactly the profile's and set up the
	desk to match. Mutates the in-memory doc - caller saves."""
	user.set("roles", [{"role": r} for r in PROFILES[profile]])
	_setup_desk(user, profile)


def _set_customer_scope(email, customer):
	"""One Customer User Permission for a client, none for staff - a leftover
	one would silently limit a staff member to a single customer on every
	doctype that links to Customer, not just this app's."""
	frappe.db.delete("User Permission", {"user": email, "allow": "Customer"})
	if not customer:
		return
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


@frappe.whitelist()
def criar_utilizador(full_name, email, profile, customer=None, send_welcome=1, password=None):
	"""Create a login with one of the page's profiles in a single call:
	roles, desk setup, the Customer scope for a client, a ready-to-use
	password (the one the admin chose, or a generated one) and a
	set-password link - so the admin never needs
	the User or User Permission screens, and can hand over working
	credentials without depending on outgoing email.

	Restricted to System Manager / Administrador; the writes run with
	ignore_permissions=True so that role needs no direct permission on User
	or User Permission itself.
	"""
	frappe.only_for(ACCESS_MANAGER_ROLES)

	full_name = (full_name or "").strip()
	email = (email or "").strip().lower()
	customer = (customer or "").strip() if profile == CLIENT_PROFILE else None
	send_welcome = cint(send_welcome)

	if not full_name or not email or not profile:
		frappe.throw(_("Nome, Email e Perfil são obrigatórios."))
	validate_email_address(email, throw=True)
	_validate_profile(profile, customer)

	if frappe.db.exists("User", email):
		frappe.throw(_("Já existe uma conta com o email {0}. Gere-a na lista abaixo.").format(email))
	# Checked before the User exists, so a rejected password creates nothing.
	temp_password = _chosen_or_generated_password(password, email, full_name)

	first_name, _sep, last_name = full_name.partition(" ")
	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": first_name,
			"last_name": last_name or None,
			"user_type": "System User",
			"send_welcome_email": 0,
		}
	)
	_apply_profile(user, profile)
	user.flags.ignore_permissions = True
	user.insert()

	_set_customer_scope(email, customer)

	update_password(email, temp_password)
	relative_link = user._reset_password(send_email=bool(send_welcome))

	return {
		"email": email,
		"profile": profile,
		"password": temp_password,
		"link": get_url(relative_link),
		"email_sent": bool(send_welcome),
	}


@frappe.whitelist()
def listar_utilizadores():
	"""Every account holding one of the page's roles. Accounts that also
	carry other roles come back flagged read-only, so the admin can see they
	exist without being able to touch them."""
	frappe.only_for(ACCESS_MANAGER_ROLES)

	rows = frappe.db.sql(
		"""
		select
			u.name as email,
			u.full_name,
			u.enabled,
			u.last_login,
			group_concat(distinct up.for_value separator ', ') as customers
		from `tabUser` u
		left join `tabUser Permission` up on up.user = u.name and up.allow = 'Customer'
		where u.name not in ('Administrator', 'Guest')
			and exists (
				select 1 from `tabHas Role` hr
				where hr.parent = u.name and hr.parenttype = 'User' and hr.role in %(roles)s
			)
		group by u.name
		order by u.full_name
		""",
		{"roles": tuple(MANAGED_ROLES)},
		as_dict=True,
	)
	if not rows:
		return []

	roles_by_user = {}
	for r in frappe.get_all(
		"Has Role",
		filters={"parent": ("in", [row.email for row in rows]), "parenttype": "User"},
		fields=["parent", "role"],
	):
		roles_by_user.setdefault(r.parent, set()).add(r.role)

	for row in rows:
		roles = roles_by_user.get(row.email, set()) - AUTOMATIC_ROLES
		row.profile = _profile_for(roles)
		row.manageable = _is_manageable(row.email, roles)
		row.is_self = row.email == frappe.session.user

	return rows


@frappe.whitelist()
def repor_password(email, password=None):
	"""New password (chosen by the admin, or generated when blank) + reset
	link - same result shape as creation, so the UI reuses the same
	copy-and-hand-over flow."""
	frappe.only_for(ACCESS_MANAGER_ROLES)
	email = (email or "").strip()
	_require_manageable(email)

	user = frappe.get_doc("User", email)
	temp_password = _chosen_or_generated_password(password, email, user.full_name)
	update_password(email, temp_password)

	relative_link = user._reset_password(send_email=False)

	return {"email": email, "password": temp_password, "link": get_url(relative_link)}


@frappe.whitelist()
def alternar_activo(email, enabled):
	"""Enable/disable a login. Disabling also kills any sessions already
	open - flipping the flag alone would leave a logged-in tab working until
	it naturally expires."""
	frappe.only_for(ACCESS_MANAGER_ROLES)
	email = (email or "").strip()
	_require_manageable(email)
	_require_not_self(email)
	enabled = cint(enabled)

	user = frappe.get_doc("User", email)
	user.enabled = enabled
	user.flags.ignore_permissions = True
	user.save()

	if not enabled:
		clear_sessions(email)

	return {"email": email, "enabled": enabled}


@frappe.whitelist()
def mudar_perfil(email, profile, customer=None):
	"""Switch a login to another profile, or a client to another Customer.
	Roles are replaced rather than added to and the Customer scope is
	rebuilt, so a client moved to staff doesn't stay limited to one
	customer, and staff moved to client doesn't keep internal access. Open
	sessions are ended so the change applies immediately."""
	frappe.only_for(ACCESS_MANAGER_ROLES)
	email = (email or "").strip()
	customer = (customer or "").strip() if profile == CLIENT_PROFILE else None
	_require_manageable(email)
	_require_not_self(email)
	_validate_profile(profile, customer)

	user = frappe.get_doc("User", email)
	_apply_profile(user, profile)
	user.flags.ignore_permissions = True
	user.save()

	_set_customer_scope(email, customer)
	clear_sessions(email)

	return {"email": email, "profile": profile, "customer": customer}
