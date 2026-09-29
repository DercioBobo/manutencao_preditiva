# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import validate_email_address


class Area(Document):
	def validate(self):
		self.clean_emails()

	def clean_emails(self):
		"""Accept one per line, or separated by commas/semicolons; store one
		valid address per line, without duplicates."""
		emails = []
		for value in re.split(r"[\s,;]+", self.emails or ""):
			if not value:
				continue
			if not validate_email_address(value):
				frappe.throw(_("{0} is not a valid email address.").format(value), title=_("Emails"))
			if value.lower() not in (e.lower() for e in emails):
				emails.append(value)
		self.emails = "\n".join(emails)

	def on_update(self):
		"""Reports, equipment and sheets keep a copy of these emails (their
		Area Emails field, used by email notifications) - refresh it on
		every one of them when the list changes."""
		if not self.has_value_changed("emails"):
			return
		for doctype in ("Inspection Report", "Equipment", "Equipment Inspection"):
			frappe.db.set_value(doctype, {"area": self.name}, "area_emails", self.emails, update_modified=False)
