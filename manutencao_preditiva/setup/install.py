# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

from manutencao_preditiva.manutencao_preditiva.doctype.vibration_alarm_settings.vibration_alarm_settings import (
	seed_defaults,
)


def after_install():
	seed_defaults()
