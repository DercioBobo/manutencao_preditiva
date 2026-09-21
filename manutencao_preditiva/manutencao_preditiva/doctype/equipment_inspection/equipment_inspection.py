# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today

from manutencao_preditiva.manutencao_preditiva.doctype.vibration_alarm_settings.vibration_alarm_settings import (
	load_limits,
)
from manutencao_preditiva.vibration import NOT_COLLECTED, evaluate, worst


class EquipmentInspection(Document):
	"""One equipment, in one report: the readings the technician typed, how
	they compare with last time, and the analyst's diagnosis."""

	def validate(self):
		self.load_report_context()
		self.load_equipment_context()
		self.validate_unique_in_report()
		self.prepare_readings()
		self.link_previous_sheet()
		self.evaluate_readings()
		self.set_severity()
		self.set_completion_date()

	def load_report_context(self):
		report = frappe.db.get_value(
			"Inspection Report", self.report, ["customer", "area", "report_date"], as_dict=True
		)
		if not report:
			frappe.throw(_("Report {0} does not exist.").format(self.report))
		self.customer = report.customer
		self.area = report.area
		self.report_date = report.report_date

	def load_equipment_context(self):
		equipment = frappe.db.get_value(
			"Inspection Equipment", self.equipment, ["customer", "description", "power_kw"], as_dict=True
		)
		if not equipment:
			frappe.throw(_("Equipment {0} does not exist.").format(self.equipment))
		if equipment.customer != self.customer:
			frappe.throw(
				_("{0} belongs to {1}, but this report is for {2}.").format(
					self.equipment, equipment.customer, self.customer
				)
			)
		# fetch_from only runs after validate(), and the alarm band below needs the power now.
		self.equipment_description = equipment.description
		self.power_kw = equipment.power_kw

	def validate_unique_in_report(self):
		duplicate = frappe.db.exists(
			"Equipment Inspection",
			{"report": self.report, "equipment": self.equipment, "name": ["!=", self.name or ""]},
		)
		if duplicate:
			frappe.throw(
				_("{0} already has a sheet in this report: {1}.").format(self.equipment, duplicate),
				title=_("Duplicate Sheet"),
			)

	def prepare_readings(self):
		"""A new sheet starts with one empty row per measurement point the
		equipment is set up with, so the technician only types numbers."""
		if not self.is_new() or self.readings:
			return
		for point in frappe.get_doc("Inspection Equipment", self.equipment).points:
			self.append("readings", {"point": point.point_code})

	def link_previous_sheet(self):
		"""The equipment's latest earlier sheet - its readings are copied
		into the Prev. columns so the trend is visible while typing."""
		previous = frappe.get_all(
			"Equipment Inspection",
			filters={
				"equipment": self.equipment,
				"name": ["!=", self.name or ""],
				"report_date": ["<", self.report_date],
			},
			order_by="report_date desc, creation desc",
			limit=1,
			pluck="name",
		)
		self.previous_sheet = previous[0] if previous else None

		previous_by_point = {}
		if self.previous_sheet:
			for row in frappe.get_doc("Equipment Inspection", self.previous_sheet).readings:
				previous_by_point[(row.point or "").strip().upper()] = row

		for row in self.readings:
			row.point = (row.point or "").strip().upper()
			before = previous_by_point.get(row.point)
			row.previous_velocity_mm_s = before.velocity_mm_s if before else None
			row.previous_acceleration_g = before.acceleration_g if before else None
			row.previous_temperature_c = before.temperature_c if before else None

	def evaluate_readings(self):
		limits = load_limits()

		if not 0 <= flt(self.tolerance_percent) <= limits.max_tolerance:
			frappe.throw(
				_("Tolerance must be between 0 and {0}% (see Vibration Alarm Settings).").format(
					limits.max_tolerance
				)
			)

		found = []
		for row in self.readings:
			if flt(row.velocity_mm_s) and not flt(self.power_kw):
				frappe.throw(
					_(
						"Row {0}: set the rated power (kW) of {1} - the velocity alarm limits depend on it."
					).format(row.idx, self.equipment)
				)
			velocity, acceleration = evaluate(
				limits,
				flt(self.power_kw),
				flt(self.tolerance_percent),
				flt(row.velocity_mm_s),
				flt(row.acceleration_g),
			)
			row.velocity_severity = velocity or ""
			row.acceleration_severity = acceleration or ""
			found += [velocity, acceleration]

		self.suggested_severity = worst(found) or ""

	def set_severity(self):
		"""Severity follows the suggestion until the analyst sets it. It only
		follows while it still equals the previous suggestion; anything else
		is a judgement call that a re-typed reading must not overwrite."""
		before = self.get_doc_before_save()
		old_suggestion = before.suggested_severity if before else ""

		if self.suggested_severity and (not self.severity or self.severity == old_suggestion):
			self.severity = self.suggested_severity

		if self.severity and self.severity != NOT_COLLECTED and not self.suggested_severity:
			frappe.throw(
				_("Enter at least one reading, or set the severity to {0}.").format(_(NOT_COLLECTED))
			)

	def set_completion_date(self):
		if self.action_status == "Done" and not self.completion_date:
			self.completion_date = today()
