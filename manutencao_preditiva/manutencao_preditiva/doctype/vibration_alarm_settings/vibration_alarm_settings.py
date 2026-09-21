# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from manutencao_preditiva.vibration import (
	DEFAULT_ACCELERATION,
	DEFAULT_MAX_TOLERANCE,
	DEFAULT_VELOCITY_BANDS,
	AlarmLimits,
)


class VibrationAlarmSettings(Document):
	def validate(self):
		self.validate_bands()
		self.validate_acceleration()

	def validate_bands(self):
		if not self.bands:
			frappe.throw(_("Add at least one velocity band."))

		bands = sorted(self.bands, key=lambda band: flt(band.max_power_kw))
		previous_power = None
		for band in bands:
			label = _("Band up to {0} kW").format(band.max_power_kw)
			if flt(band.max_power_kw) <= 0:
				frappe.throw(_("{0}: the power must be above 0.").format(label))
			if previous_power is not None and flt(band.max_power_kw) == previous_power:
				frappe.throw(_("Two bands end at {0} kW.").format(band.max_power_kw))
			if not 0 < flt(band.acceptable_mm_s) < flt(band.alarm_mm_s) < flt(band.critical_mm_s):
				frappe.throw(_("{0}: limits must increase - Acceptable < Alarm < Critical.").format(label))
			previous_power = flt(band.max_power_kw)

		# Keep the grid in power order so the table reads like the printed one.
		self.bands = bands
		for index, band in enumerate(self.bands, start=1):
			band.idx = index

	def validate_acceleration(self):
		if not (
			0
			< flt(self.acceleration_acceptable)
			< flt(self.acceleration_alarm)
			< flt(self.acceleration_critical)
		):
			frappe.throw(_("Acceleration limits must increase - Acceptable < Alarm < Critical."))
		if not 0 <= flt(self.max_tolerance_percent) <= 100:
			frappe.throw(_("Maximum tolerance must be between 0 and 100%."))


def load_limits():
	"""The alarm limits in force, as the plain object vibration.py works with.
	Falls back to the report's defaults if the settings were never saved, so
	nothing breaks on a site that skipped the seeding."""
	settings = frappe.get_doc("Vibration Alarm Settings")
	if not settings.bands:
		return AlarmLimits()

	return AlarmLimits(
		bands=tuple(
			(
				flt(band.max_power_kw),
				flt(band.acceptable_mm_s),
				flt(band.alarm_mm_s),
				flt(band.critical_mm_s),
			)
			for band in settings.bands
		),
		acceleration=(
			flt(settings.acceleration_acceptable),
			flt(settings.acceleration_alarm),
			flt(settings.acceleration_critical),
		),
		max_tolerance=flt(settings.max_tolerance_percent),
	)


def seed_defaults():
	"""Fill the settings with the limits printed in the report (FR.TEC.09).
	Never overwrites limits somebody has already edited."""
	settings = frappe.get_doc("Vibration Alarm Settings")
	if settings.bands:
		return

	for max_power, acceptable, alarm, critical in DEFAULT_VELOCITY_BANDS:
		settings.append(
			"bands",
			{
				"max_power_kw": max_power,
				"acceptable_mm_s": acceptable,
				"alarm_mm_s": alarm,
				"critical_mm_s": critical,
			},
		)
	(
		settings.acceleration_acceptable,
		settings.acceleration_alarm,
		settings.acceleration_critical,
	) = DEFAULT_ACCELERATION
	settings.max_tolerance_percent = DEFAULT_MAX_TOLERANCE
	settings.flags.ignore_permissions = True
	settings.save()
