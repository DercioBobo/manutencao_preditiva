# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Start the Defect Type list with the defects of the vibration Action
Tracker's dropdown (FR.TEC.014), cleaned up. Adds only what is missing."""

from manutencao_preditiva.manutencao_preditiva.doctype.defect_type.defect_type import seed_defaults


def execute():
	seed_defaults()
