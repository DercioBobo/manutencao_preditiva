# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import escape_html, flt, formatdate, getdate

from manutencao_preditiva.manutencao_preditiva.doctype.vibration_alarm_settings.vibration_alarm_settings import (
	load_limits,
)
from manutencao_preditiva.vibration import COLORS, RANKED, SEVERITIES, pie_svg, summarize


def _number(value):
	"""Reading as printed on the report: blank when not measured, otherwise at
	least one decimal (14.0, 5.9) and as many more as the reading has (0.06)."""
	if not flt(value):
		return ""
	text = f"{flt(value):.3f}".rstrip("0")
	return text + "0" if text.endswith(".") else text


def _multiline(text):
	return escape_html(text or "").replace("\n", "<br>")


class InspectionReport(Document):
	def validate(self):
		self.period_label = getdate(self.report_date).strftime("%b/%y").upper()
		self.validate_area_belongs_to_customer()
		self.validate_scope_not_changed()
		self.validate_can_be_issued()

	def validate_area_belongs_to_customer(self):
		area_customer = frappe.db.get_value("Area", self.area, "customer")
		if area_customer != self.customer:
			frappe.throw(_("Area {0} belongs to {1}, not {2}.").format(self.area, area_customer, self.customer))

	def validate_scope_not_changed(self):
		"""Sheets copy the customer and area from here, so moving the report
		once it has sheets would leave them pointing at the old ones."""
		if self.is_new() or not (self.has_value_changed("customer") or self.has_value_changed("area")):
			return
		if frappe.db.exists("Equipment Inspection", {"report": self.name}):
			frappe.throw(_("Customer and Area cannot change once the report has sheets."))

	def validate_can_be_issued(self):
		if self.status != "Issued" or self.is_new():
			return
		sheets = frappe.get_all(
			"Equipment Inspection", filters={"report": self.name}, fields=["name", "equipment", "severity"]
		)
		if not sheets:
			frappe.throw(_("Create the equipment sheets before issuing the report."))
		unassessed = [sheet.equipment for sheet in sheets if not sheet.severity]
		if unassessed:
			frappe.throw(
				_("These equipment have no severity yet: {0}").format(", ".join(unassessed)),
				title=_("Cannot Issue"),
			)

	def onload(self):
		self.set_onload("summary", self.get_summary())

	@frappe.whitelist()
	def create_sheets(self):
		"""One empty sheet for every active equipment of the area that does
		not have one in this report yet."""
		self.check_permission("write")
		if self.is_new():
			frappe.throw(_("Save the report first."))

		done = set(frappe.get_all("Equipment Inspection", filters={"report": self.name}, pluck="equipment"))
		equipment = frappe.get_all(
			"Equipment",
			filters={"customer": self.customer, "area": self.area, "disabled": 0},
			pluck="name",
			order_by="machine, description",
		)

		created = 0
		for name in equipment:
			if name in done:
				continue
			frappe.get_doc({"doctype": "Equipment Inspection", "report": self.name, "equipment": name}).insert()
			created += 1
		return created

	def get_sheet_names(self):
		return frappe.get_all("Equipment Inspection", filters={"report": self.name}, pluck="name")

	def get_summary(self):
		severities = frappe.get_all(
			"Equipment Inspection", filters={"report": self.name}, pluck="severity"
		)
		return summarize(severities)

	def get_print_data(self):
		"""Everything the printed report needs, computed here rather than in
		the template so the counts, percentages and pie can never drift from
		the sheets the way the hand-made ones did."""
		limits = load_limits()
		sheets = [frappe.get_doc("Equipment Inspection", name) for name in self.get_sheet_names()]

		# Worst first, as in the Word report (Alarm before Normal).
		order = list(reversed(SEVERITIES[: len(RANKED)])) + [SEVERITIES[-1]]
		sheets.sort(key=lambda s: (order.index(s.severity) if s.severity in order else len(order), s.equipment_description or ""))

		summary = summarize([s.severity for s in sheets])
		rows = [self._print_sheet(number, sheet) for number, sheet in enumerate(sheets, start=1)]

		return {
			"date": formatdate(self.report_date),
			"summary": summary,
			"total": sum(row["count"] for row in summary),
			"pie": pie_svg(summary),
			"colors": COLORS,
			"bands": [
				{"power": self._band_label(limits.bands, index), "acceptable": a, "alarm": b, "critical": c}
				for index, (_max, a, b, c) in enumerate(sorted(limits.bands))
			],
			"acceleration": limits.acceleration,
			"max_tolerance": limits.max_tolerance,
			"groups": [
				{"severity": severity, "color": COLORS[severity], "sheets": [r for r in rows if r["severity"] == severity]}
				for severity in order
				if any(r["severity"] == severity for r in rows)
			],
			"sheets": rows,
		}

	@staticmethod
	def _band_label(bands, index):
		"""'0 to 15', '16 to 74', ... - the lower bound is the previous band's
		upper bound plus 1, as printed on the report's alarm table."""
		bands = sorted(bands)
		upper = f"{bands[index][0]:g}"
		lower = "0" if index == 0 else f"{bands[index - 1][0] + 1:g}"
		return f"{lower} - {upper}"

	def _print_sheet(self, number, sheet):
		previous = frappe.get_doc("Equipment Inspection", sheet.previous_sheet) if sheet.previous_sheet else None

		def table(doc):
			return [
				{
					"point": row.point,
					"velocity": _number(row.velocity_mm_s),
					"velocity_color": COLORS.get(row.velocity_severity, ""),
					"acceleration": _number(row.acceleration_g),
					"acceleration_color": COLORS.get(row.acceleration_severity, ""),
					"temperature": _number(row.temperature_c),
				}
				for row in doc.readings
			]

		machine = frappe.db.get_value("Equipment", sheet.equipment, "machine")
		return {
			"number": number,
			"machine": machine or "",
			"description": sheet.equipment_description,
			"area": frappe.db.get_value("Area", sheet.area, "area_name"),
			"severity": sheet.severity,
			"color": COLORS.get(sheet.severity, ""),
			"tolerance": f"{flt(sheet.tolerance_percent):g}",
			"date": formatdate(self.report_date),
			"period": self.period_label,
			"current": table(sheet),
			"previous": table(previous) if previous else [],
			"previous_period": frappe.db.get_value("Inspection Report", previous.report, "period_label") if previous else "",
			"defects": _multiline(sheet.defects),
			"recommendations": _multiline(sheet.recommendations),
			"follow_up": _multiline(sheet.follow_up),
			"images": [{"image": row.image, "caption": row.caption or ""} for row in sheet.images],
		}
