# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class Equipment(Document):
	def validate(self):
		self.validate_area_belongs_to_customer()
		self.validate_unique_points()

	def validate_area_belongs_to_customer(self):
		area_customer = frappe.db.get_value("Area", self.area, "customer")
		if area_customer != self.customer:
			frappe.throw(_("Area {0} belongs to {1}, not {2}.").format(self.area, area_customer, self.customer))

	def validate_unique_points(self):
		seen = set()
		for point in self.points:
			code = (point.point_code or "").strip().upper()
			if code in seen:
				frappe.throw(_("Row {0}: measurement point {1} is listed twice.").format(point.idx, code))
			seen.add(code)
			point.point_code = code
