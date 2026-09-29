# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Wipe the inspection data so the Word reports can be imported from
scratch: every Equipment Inspection sheet, Inspection Report, Equipment and
Area, their photos and uploaded .docx files, and their naming series.

Customers, users, access rights and Vibration Alarm Settings are kept, as
are the legacy Portuguese doctypes.

Dry run by default - it only prints what it would delete:

	bench --site <site> execute manutencao_preditiva.setup.reset_inspection_data.run

Then, to really delete:

	bench --site <site> execute manutencao_preditiva.setup.reset_inspection_data.run --kwargs "{'confirm': 'DELETE'}"
"""

import re

import frappe

# Parents with their child tables, deleted children first.
DOCTYPES = (
	("Equipment Inspection", ("Vibration Reading", "Equipment Inspection Image")),
	("Inspection Report", ()),
	("Equipment", ("Equipment Measurement Point",)),
	("Area", ()),
)

# Series keys (tabSeries.name) the current autonames count in - see each
# doctype's "autoname". "EQ-" is left alone when the legacy Equipamento De
# Inspecao still has records numbered from it (see _reset_series).
SERIES_PATTERNS = (r"^Area-$", r"^EQ-$", r"^IR-\d{2}-$", r"^EQIP-\d{2}-$")


def run(confirm=None):
	really = confirm == "DELETE"
	doctypes = [dt for dt, _children in DOCTYPES]

	files = frappe.get_all(
		"File",
		filters={"attached_to_doctype": ["in", doctypes]},
		pluck="name",
	)
	counts = {dt: frappe.db.count(dt) for dt in doctypes}
	print("Would delete:" if not really else "Deleting:")
	for dt, n in counts.items():
		print(f"  {dt}: {n}")
	print(f"  Files (photos, uploaded reports): {len(files)}")
	print(f"  Naming series: {', '.join(_series_to_reset()) or '-'}")

	if not really:
		print("\nDry run - nothing deleted. Re-run with --kwargs \"{'confirm': 'DELETE'}\" to delete.")
		return

	# Through the File controller, so the files on disk go too.
	for name in files:
		frappe.delete_doc("File", name, ignore_permissions=True, force=True, delete_permanently=True)

	# Straight table deletes rather than delete_doc: sheets link to each other
	# (previous_sheet) and to reports/equipment, so per-document deletes would
	# trip over link checks in every possible order.
	for dt, children in DOCTYPES:
		for child in children:
			frappe.db.delete(child, {"parenttype": dt})
		frappe.db.delete(dt)
		for log in ("Version", "Comment"):
			frappe.db.delete(log, {"ref_doctype" if log == "Version" else "reference_doctype": dt})

	_reset_series()
	frappe.db.commit()
	frappe.clear_cache()
	print("\nDone.")


def _series_to_reset():
	# tabSeries is a plain table, not a DocType - no get_all/set_value on it.
	names = [row[0] for row in frappe.db.sql("select name from `tabSeries`")]
	return [n for n in names if any(re.match(p, n) for p in SERIES_PATTERNS)]


def _reset_series():
	for name in _series_to_reset():
		current = 0
		if name == "EQ-":
			# Shared with the legacy Equipamento De Inspecao (EQ-.##): restart
			# after its highest number, so new legacy records can't collide.
			used = frappe.get_all("Equipamento De Inspecao", filters={"name": ["like", "EQ-%"]}, pluck="name")
			current = max((int(n[3:]) for n in used if n[3:].isdigit()), default=0)
		frappe.db.sql("update `tabSeries` set current = %s where name = %s", (current, name))
