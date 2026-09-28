# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Put every login the Gestão de Utilizadores page manages on the MP Module
Profile - new ones get it on creation, this catches the accounts made
before that. Saved through the User controller so it copies MP's blocked
modules onto each user."""

import frappe

from manutencao_preditiva.api import MANAGED_ROLES, MODULE_PROFILE, _is_manageable


def execute():
	if not frappe.db.exists("Module Profile", MODULE_PROFILE):
		return

	users = frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "role": ("in", list(MANAGED_ROLES))},
		pluck="parent",
		distinct=True,
	)
	for email in users:
		if not _is_manageable(email):
			continue
		user = frappe.get_doc("User", email)
		if user.module_profile == MODULE_PROFILE:
			continue
		user.module_profile = MODULE_PROFILE
		user.flags.ignore_permissions = True
		user.save()
