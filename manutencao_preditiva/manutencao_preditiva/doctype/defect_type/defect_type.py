# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

"""The controlled list a sheet's defects are picked from - what makes
"which defects do we find most" countable, where the old free-text
"Defects Found" had "Lack of bearing lubrication", "Lack of bering
lubrication" and "Lubrication Breackdown" as three different things.

Technicians add to it themselves, so the guard against duplicates lives
here: the same name ignoring case/accents/spacing is refused outright, and
a merely similar one is reported back (create_defect_type) for the
technician to either pick the existing type or confirm the new one."""

import json
import re
import unicodedata
from difflib import SequenceMatcher

import frappe
from frappe import _
from frappe.model.document import Document

# Inspection Report.technique -> the Check field on Defect Type.
TECHNIQUE_FIELDS = {
	"Vibration": "vibration",
	"Thermography": "thermography",
	"Ultrasound": "ultrasound",
	"Oil Analysis": "oil_analysis",
}

# Above this, two names are "probably the same defect" - catches typos
# ("bering", "Misaligment"), plurals ("Bearings defects") and synonyms that
# share most letters ("Imbalance"), without flagging "Bearing defect" vs
# "Bearing damage" (0.71), which the tracker deliberately keeps apart.
SIMILARITY = 0.75

# Seeded from the DROPDOWN MENU of the vibration Action Tracker (FR.TEC.014),
# typos fixed and one type per defect: combined entries ("Lack of bearing
# lubrication & Unbalance") are two rows on the sheet now, and where it was
# found ("on the impeller") is the row's location. Non-defects (Normal, Good
# Condition, Not in Operation, MP Lda to monitor) are severities, not here.
# (name, group, techniques)
DEFAULT_DEFECTS = [
	("Bearing defect", "Bearing", ["Vibration", "Ultrasound"]),
	("Bearing damage", "Bearing", ["Vibration", "Ultrasound"]),
	("Lack of bearing lubrication", "Lubrication", ["Vibration", "Ultrasound"]),
	("Lubrication breakdown", "Lubrication", ["Vibration", "Ultrasound", "Oil Analysis"]),
	("Unbalance", "Unbalance", ["Vibration"]),
	("Misalignment", "Alignment", ["Vibration", "Thermography"]),
	("Pulley / sheave misalignment", "Alignment", ["Vibration"]),
	("Belt misalignment", "Alignment", ["Vibration"]),
	("Looseness", "Looseness", ["Vibration"]),
	("Axial run-out", "Rotor / Run-out", ["Vibration"]),
	("Coupling wear", "Wear", ["Vibration", "Thermography"]),
	("Belt and pulley wear", "Wear", ["Vibration"]),
	("Signs of wear", "Wear", ["Vibration", "Oil Analysis"]),
	("Overheated connection", "Electrical", ["Thermography"]),
	("Phase load imbalance", "Electrical", ["Thermography"]),
]


def normalize(name):
	"""'  Lack of Bearing  Lubrificação ' -> 'lack of bearing lubrificacao'."""
	text = unicodedata.normalize("NFKD", name or "")
	text = "".join(c for c in text if not unicodedata.combining(c)).lower()
	return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _score(a, b):
	direct = SequenceMatcher(None, a, b).ratio()
	reordered = SequenceMatcher(None, " ".join(sorted(a.split())), " ".join(sorted(b.split()))).ratio()
	return max(direct, reordered)


@frappe.whitelist()
def find_similar(defect_name, exclude=None):
	"""Existing types that look like defect_name, closest first:
	[{"name", "defect_group", "exact": bool}]."""
	wanted = normalize(defect_name)
	if not wanted:
		return []
	found = []
	for row in frappe.get_all("Defect Type", fields=["name", "defect_group", "disabled"]):
		if row.name == exclude:
			continue
		existing = normalize(row.name)
		score = 1.0 if existing == wanted else _score(wanted, existing)
		if score >= SIMILARITY:
			found.append({**row, "exact": existing == wanted, "score": score})
	found.sort(key=lambda r: -r["score"])
	return found[:5]


@frappe.whitelist()
def create_defect_type(defect_name, defect_group="Other", techniques=None, force=0):
	"""Create a type from a sheet. Never creates a duplicate:
	- same name (ignoring case/accents/spacing) -> {"exists": name}
	- similar names and not force -> {"similar": [...]} for the user to choose
	- otherwise -> {"name": new name}"""
	defect_name = " ".join((defect_name or "").split())
	if not defect_name:
		frappe.throw(_("Enter the defect name."))

	similar = find_similar(defect_name)
	exact = next((r for r in similar if r["exact"]), None)
	if exact:
		return {"exists": exact["name"]}
	if similar and not frappe.utils.cint(force):
		return {"similar": similar}

	if isinstance(techniques, str):
		techniques = json.loads(techniques)
	doc = frappe.get_doc({"doctype": "Defect Type", "defect_name": defect_name, "defect_group": defect_group})
	for technique, fieldname in TECHNIQUE_FIELDS.items():
		doc.set(fieldname, 1 if technique in (techniques or []) else 0)
	doc.insert()
	return {"name": doc.name}


def seed_defaults():
	"""Fill an empty list with DEFAULT_DEFECTS. Leaves a list someone has
	already started alone, apart from adding the missing defaults."""
	for name, group, techniques in DEFAULT_DEFECTS:
		# Exact only - "Belt misalignment" is similar to "Misalignment" and both belong.
		if any(r["exact"] for r in find_similar(name)):
			continue
		doc = frappe.get_doc({"doctype": "Defect Type", "defect_name": name, "defect_group": group})
		for technique, fieldname in TECHNIQUE_FIELDS.items():
			doc.set(fieldname, 1 if technique in techniques else 0)
		doc.insert(ignore_permissions=True)


class DefectType(Document):
	def validate(self):
		self.defect_name = " ".join((self.defect_name or "").split())
		if not any(self.get(fieldname) for fieldname in TECHNIQUE_FIELDS.values()):
			frappe.throw(_("Tick at least one technique that can find this defect."))

		exact = next((r for r in find_similar(self.defect_name, exclude=self.name) if r["exact"]), None)
		if exact:
			frappe.throw(
				_("{0} already exists - use it instead of creating it again.").format(frappe.bold(exact["name"])),
				title=_("Duplicate Defect"),
			)
