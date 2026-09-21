# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Pure-Python tests for the severity rules - run without a bench:

	python -m unittest manutencao_preditiva.tests.test_vibration

The reference readings are the CDM Jardim report (June 2026, Linha 2
Pastorizadora), where the analyst's own colours are known.
"""

import unittest

from manutencao_preditiva import vibration as v

LIMITS = v.AlarmLimits()


class TestClassify(unittest.TestCase):
	def test_limits_are_inclusive_lower_bounds(self):
		band = (4.4, 6.3, 10.2)
		self.assertEqual(v.classify(4.3, band), v.NORMAL)
		self.assertEqual(v.classify(4.4, band), v.ACCEPTABLE)
		self.assertEqual(v.classify(6.3, band), v.ALARM)
		self.assertEqual(v.classify(10.2, band), v.CRITICAL)

	def test_blank_reading_is_not_normal(self):
		self.assertIsNone(v.classify(None, (4.4, 6.3, 10.2)))
		self.assertIsNone(v.classify(0, (4.4, 6.3, 10.2)))

	def test_tolerance_raises_every_limit(self):
		band = (4.4, 6.3, 10.2)
		self.assertEqual(v.classify(6.5, band), v.ALARM)
		self.assertEqual(v.classify(6.5, band, tolerance_percent=10), v.ACCEPTABLE)  # alarm now 6.93


class TestBands(unittest.TestCase):
	def test_band_by_power(self):
		self.assertEqual(LIMITS.velocity_limits(11), (2.6, 3.8, 6.3))
		self.assertEqual(LIMITS.velocity_limits(15), (2.6, 3.8, 6.3))
		self.assertEqual(LIMITS.velocity_limits(16), (4.4, 6.3, 10.2))
		self.assertEqual(LIMITS.velocity_limits(74), (4.4, 6.3, 10.2))
		self.assertEqual(LIMITS.velocity_limits(75), (7.2, 10.2, 15))
		self.assertEqual(LIMITS.velocity_limits(296), (10.5, 15, 18))

	def test_above_last_band_uses_last_band(self):
		self.assertEqual(LIMITS.velocity_limits(900), (10.5, 15, 18))

	def test_unknown_power_cannot_be_judged(self):
		self.assertIsNone(LIMITS.velocity_limits(0))
		self.assertIsNone(LIMITS.velocity_limits(None))


class TestAgainstReport(unittest.TestCase):
	"""June readings of the pumps (16-74 kW band) vs the analyst's verdict.
	Raw readings never *contradict* the report: where the report is more
	severe than the suggestion, it is the analyst's bearing diagnosis."""

	def suggest(self, power, tolerance, points):
		found = []
		for velocity, acceleration in points:
			found += v.evaluate(LIMITS, power, tolerance, velocity, acceleration)
		return v.worst(found)

	def test_normal_equipment(self):
		# Bomba 1 primeiro banho, Blower, Deck: reported NORMAL
		self.assertEqual(self.suggest(30, 0, [(3.0, 0.5), (1.3, 0.1), (2.7, None)]), v.NORMAL)
		self.assertEqual(self.suggest(30, 0, [(2.5, 0.1), (2.8, 0.1), (4.3, None)]), v.NORMAL)
		self.assertEqual(self.suggest(30, 0, [(0.3, 0.1), (0.3, 0.1), (0.4, 0.06), (0.2, 0.06)]), v.NORMAL)

	def test_alarm_equipment(self):
		# Bomba 3 zona de choque A: M2A 7.3 mm/s, reported ALARME
		self.assertEqual(self.suggest(30, 0, [(5.4, 0.3), (3.0, 0.1), (7.3, None)]), v.ALARM)
		# Bomba 5 zona de arrefecimento: M2A 6.4 mm/s, reported ALARME
		self.assertEqual(self.suggest(30, 0, [(3.6, 0.5), (3.0, 0.6), (6.4, None)]), v.ALARM)

	def test_analyst_can_be_more_severe_than_readings(self):
		# Bomba 4 (bearing defects): every velocity is Normal, acceleration 1.2 g only
		# reaches Acceptable - yet the analyst reported ALARME. Hence "suggested".
		self.assertEqual(self.suggest(30, 0, [(0.9, 0.9), (0.9, 1.2), (1.3, None)]), v.ACCEPTABLE)


class TestSummary(unittest.TestCase):
	def test_report_summary_is_computed_not_typed(self):
		# 6 in Alarm + 3 Normal: the Word report printed 76% / 24%.
		summary = v.summarize([v.ALARM] * 6 + [v.NORMAL] * 3)
		by_severity = {row["severity"]: row for row in summary}
		self.assertEqual(by_severity[v.ALARM]["percent"], 66.7)
		self.assertEqual(by_severity[v.NORMAL]["percent"], 33.3)
		self.assertEqual([row["severity"] for row in summary], list(v.SEVERITIES))

	def test_unassessed_sheets_are_left_out(self):
		summary = v.summarize([v.ALARM, "", None])
		self.assertEqual(sum(row["count"] for row in summary), 1)

	def test_worst_ignores_blanks_and_not_collected(self):
		self.assertEqual(v.worst([None, v.NORMAL, v.ALARM, v.ACCEPTABLE]), v.ALARM)
		self.assertIsNone(v.worst([None, v.NOT_COLLECTED]))


class TestPie(unittest.TestCase):
	def test_pie(self):
		self.assertEqual(v.pie_svg(v.summarize([])), "")
		self.assertIn("<circle", v.pie_svg(v.summarize([v.NORMAL] * 4)))
		svg = v.pie_svg(v.summarize([v.ALARM] * 6 + [v.NORMAL] * 3))
		self.assertEqual(svg.count("<path"), 2)


if __name__ == "__main__":
	unittest.main()
