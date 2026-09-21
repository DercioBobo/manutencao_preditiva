# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Vibration severity rules, kept free of any frappe import so they can be
unit-tested (and reasoned about) on their own.

The rules come from the "Tabelas de Alarme" page of the vibration report
(FR.TEC.09):

* Velocity (mm/s) is judged against a table that depends on the motor's
  rated power. Each band has three limits - Acceptable, Alarm and Critical.
  A reading that reaches a limit is at that severity; below the first limit
  the equipment is Normal.
* Acceleration (g's) has a single table, whatever the power.
* The analyst may apply a tolerance (up to 10%) that raises every limit.

The result is only ever a *suggestion*: the analyst's diagnosis (e.g.
bearing defects seen in the spectrum) can put an equipment at a higher
severity than its raw readings.
"""

from dataclasses import dataclass
from math import cos, pi, sin

NORMAL = "Normal"
ACCEPTABLE = "Acceptable"
ALARM = "Alarm"
CRITICAL = "Critical"
NOT_COLLECTED = "Not Collected"

# Least to most severe. NOT_COLLECTED is a status, not a level of severity,
# so it never takes part in ranking.
RANKED = (NORMAL, ACCEPTABLE, ALARM, CRITICAL)
SEVERITIES = RANKED + (NOT_COLLECTED,)

COLORS = {
	NORMAL: "#00b050",
	ACCEPTABLE: "#ffff66",
	ALARM: "#ffb266",
	CRITICAL: "#ff0000",
	NOT_COLLECTED: "#d9d9d9",
}

# (up to kW, acceptable, alarm, critical) in mm/s - as printed in the report.
DEFAULT_VELOCITY_BANDS = (
	(15, 2.6, 3.8, 6.3),
	(74, 4.4, 6.3, 10.2),
	(295, 7.2, 10.2, 15),
	(735, 10.5, 15, 18),
)
DEFAULT_ACCELERATION = (0.9, 1.5, 2.5)
DEFAULT_MAX_TOLERANCE = 10


@dataclass(frozen=True)
class AlarmLimits:
	bands: tuple = DEFAULT_VELOCITY_BANDS
	acceleration: tuple = DEFAULT_ACCELERATION
	max_tolerance: float = DEFAULT_MAX_TOLERANCE

	def velocity_limits(self, power_kw):
		"""The band for a motor of this power: the first one whose upper
		bound covers it. Anything above the last band is judged by the last
		band rather than left unjudged."""
		if not power_kw or not self.bands:
			return None
		for band in sorted(self.bands):
			if power_kw <= band[0]:
				return band[1:]
		return sorted(self.bands)[-1][1:]


def classify(value, limits, tolerance_percent=0):
	"""Severity of one reading against (acceptable, alarm, critical) limits.

	A blank reading is None, not Normal. Frappe stores an empty Float as 0,
	and a real reading of exactly 0 is not physically possible, so 0 means
	"not measured" too.
	"""
	if not value or not limits:
		return None
	factor = 1 + (tolerance_percent or 0) / 100
	acceptable, alarm, critical = (round(limit * factor, 6) for limit in limits)
	if value >= critical:
		return CRITICAL
	if value >= alarm:
		return ALARM
	if value >= acceptable:
		return ACCEPTABLE
	return NORMAL


def evaluate(limits, power_kw, tolerance_percent, velocity=None, acceleration=None):
	"""(velocity severity, acceleration severity) of one measurement point."""
	return (
		classify(velocity, limits.velocity_limits(power_kw), tolerance_percent),
		classify(acceleration, limits.acceleration, tolerance_percent),
	)


def worst(severities):
	"""Most severe of the ranked severities given, ignoring blanks."""
	ranked = [s for s in severities if s in RANKED]
	return max(ranked, key=RANKED.index) if ranked else None


def summarize(severities):
	"""One row per severity - count and share of the total - in fixed order,
	zeros included, so the summary table and pie always show the same five
	rows. Blank severities (sheets not yet assessed) are left out."""
	assessed = [s for s in severities if s in SEVERITIES]
	total = len(assessed)
	return [
		{
			"severity": severity,
			"count": assessed.count(severity),
			"percent": round(100 * assessed.count(severity) / total, 1) if total else 0,
			"color": COLORS[severity],
		}
		for severity in SEVERITIES
	]


def pie_svg(summary, size=180):
	"""Inline SVG pie of summarize() rows. Inline, so it survives being
	rendered to PDF with no chart library or image file involved."""
	total = sum(row["count"] for row in summary)
	if not total:
		return ""

	radius = size / 2
	slices = [row for row in summary if row["count"]]

	if len(slices) == 1:
		body = f'<circle cx="{radius}" cy="{radius}" r="{radius}" fill="{slices[0]["color"]}" stroke="#fff"/>'
	else:
		body = ""
		angle = -pi / 2
		for row in slices:
			sweep = 2 * pi * row["count"] / total
			x1, y1 = radius + radius * cos(angle), radius + radius * sin(angle)
			x2, y2 = radius + radius * cos(angle + sweep), radius + radius * sin(angle + sweep)
			large_arc = 1 if sweep > pi else 0
			body += (
				f'<path d="M{radius:.2f} {radius:.2f} L{x1:.2f} {y1:.2f} '
				f'A{radius:.2f} {radius:.2f} 0 {large_arc} 1 {x2:.2f} {y2:.2f} Z" '
				f'fill="{row["color"]}" stroke="#fff"/>'
			)
			angle += sweep

	return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">{body}</svg>'
