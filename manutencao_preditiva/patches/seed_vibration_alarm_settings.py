# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Fill Vibration Alarm Settings with the limits printed in the vibration
report (FR.TEC.09) on sites that had the app before it existed. A no-op if
someone has already set their own limits."""

from manutencao_preditiva.manutencao_preditiva.doctype.vibration_alarm_settings.vibration_alarm_settings import (
	seed_defaults,
)


def execute():
	seed_defaults()
