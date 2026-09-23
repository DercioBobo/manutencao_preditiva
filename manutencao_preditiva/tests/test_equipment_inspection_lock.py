# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Once an Inspection Report is Issued, its Equipment Inspection sheets
lock for technical edits (readings, severity, diagnosis, images) - only the
Client Response section stays open. Run without a bench:

	python -m unittest manutencao_preditiva.tests.test_equipment_inspection_lock

Uses fake_frappe.py, a minimal mock - see its docstring for what that does
and doesn't guarantee. This does not replace a real click-through.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fake_frappe as ff  # noqa: E402

frappe = ff.install()

from manutencao_preditiva.manutencao_preditiva.doctype.equipment import equipment as equipment_module  # noqa: E402
from manutencao_preditiva.manutencao_preditiva.doctype.equipment_inspection import (  # noqa: E402
	equipment_inspection as sheet_module,
)
from manutencao_preditiva.manutencao_preditiva.doctype.inspection_report import inspection_report as report_module  # noqa: E402
from manutencao_preditiva.manutencao_preditiva.doctype.vibration_alarm_settings import (  # noqa: E402
	vibration_alarm_settings as settings_module,
)

ff._CONTROLLERS.update(
	{
		"Equipment Inspection": sheet_module.EquipmentInspection,
		"Inspection Report": report_module.InspectionReport,
		"Equipment": equipment_module.Equipment,
		"Vibration Alarm Settings": settings_module.VibrationAlarmSettings,
	}
)


class TestLockAfterIssue(unittest.TestCase):
	def setUp(self):
		ff.reset()

		settings = ff.Document({"bands": []}, "Vibration Alarm Settings")
		settings.save = lambda: None  # the real save() would be a no-op DB write anyway
		ff.SINGLES["Vibration Alarm Settings"] = settings
		settings_module.seed_defaults()

		ff.DB["Customer"] = {"CDM": {"customer_name": "CDM"}}
		ff.DB["Area"] = {"IA-1": {"customer": "CDM", "area_name": "Linha 2"}}

		self.equipment = ff.get_doc(
			{
				"doctype": "Equipment",
				"customer": "CDM",
				"area": "IA-1",
				"description": "BOMBA 1",
				"power_kw": 30,
				"disabled": 0,
				"points": [{"point_code": "M1H"}, {"point_code": "M2H"}],
			}
		).insert()
		self.other_equipment = ff.get_doc(
			{
				"doctype": "Equipment",
				"customer": "CDM",
				"area": "IA-1",
				"description": "BOMBA 2",
				"power_kw": 30,
				"disabled": 0,
				"points": [{"point_code": "M1H"}],
			}
		).insert()

		self.report = ff.get_doc(
			{
				"doctype": "Inspection Report",
				"customer": "CDM",
				"area": "IA-1",
				"technique": "Vibration",
				"report_date": "2026-09-01",
				"status": "Draft",
			}
		).insert()

		self.sheet = ff.get_doc(
			{"doctype": "Equipment Inspection", "report": self.report.name, "equipment": self.equipment.name}
		).insert()
		for row, value in zip(self.sheet.readings, [5.0, 3.0]):
			row.velocity_mm_s = value
		self.sheet.defects = "initial defect note"
		self.sheet.save()

	def issue(self):
		self.report.status = "Issued"
		self.report.save()

	def test_editing_is_free_on_a_draft_report(self):
		sheet = ff.get_doc("Equipment Inspection", self.sheet.name)
		sheet.defects = "edited while still draft"
		sheet.save()  # must not raise
		self.assertEqual(sheet.defects, "edited while still draft")

	def test_technical_edit_blocked_once_issued(self):
		self.issue()
		sheet = ff.get_doc("Equipment Inspection", self.sheet.name)
		sheet.defects = "trying to change after issue"
		with self.assertRaises(ff.ValidationError):
			sheet.save()

	def test_readings_edit_blocked_once_issued(self):
		self.issue()
		sheet = ff.get_doc("Equipment Inspection", self.sheet.name)
		sheet.readings[0].velocity_mm_s = 9.9
		with self.assertRaises(ff.ValidationError):
			sheet.save()

	def test_noop_resave_is_not_a_false_positive(self):
		"""A save that doesn't actually change any locked field (e.g. the
		client's own response-only save reloads the same technical values)
		must not be blocked just because the report is Issued."""
		self.issue()
		sheet = ff.get_doc("Equipment Inspection", self.sheet.name)
		sheet.save()  # must not raise

	def test_client_response_stays_editable_once_issued(self):
		self.issue()
		sheet = ff.get_doc("Equipment Inspection", self.sheet.name)
		sheet.client_response = "We fixed it"
		sheet.action_status = "Done"
		sheet.save()  # must not raise
		self.assertEqual(sheet.action_status, "Done")
		self.assertTrue(sheet.completion_date)

	def test_new_sheet_blocked_once_issued(self):
		self.issue()
		with self.assertRaises(ff.ValidationError):
			ff.get_doc(
				{"doctype": "Equipment Inspection", "report": self.report.name, "equipment": self.other_equipment.name}
			).insert()

	def test_editing_allowed_again_after_reopening_to_draft(self):
		self.issue()
		self.report.status = "Draft"
		self.report.save()

		sheet = ff.get_doc("Equipment Inspection", self.sheet.name)
		sheet.defects = "edited after reopening to draft"
		sheet.save()  # must not raise
		self.assertEqual(sheet.defects, "edited after reopening to draft")


if __name__ == "__main__":
	unittest.main()
