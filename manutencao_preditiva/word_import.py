# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Import the team's FR.TEC.09 vibration Word reports (.docx).

One Word file = one customer, one area, one month. Each "EQUIPAMENTO:"
table in it is one equipment sheet: two small nested tables of readings
(previous month and this month), the analyst's severity in "OBSERVAÇÕES",
defects / recommendations / actions taken, and a photo of the equipment.

What gets created, per file:
* the Area and every Equipment (with its measurement points) if missing;
* a readings-only Inspection Report for the previous month, holding just
  the previous-month column of every sheet - so the trend starts at once,
  for staff and client alike, without inventing a diagnosis for it;
* the Inspection Report for the month itself, with full sheets and photos.
Both are Issued. Re-running on the same file skips whatever already exists.

Parsing lives in word_report.py (no frappe); this module only writes.
"""

import re

import frappe
from frappe import _

from manutencao_preditiva.word_report import (
	WEB_IMAGE_TYPES,
	last_day,
	plain,
	parse_report,
	read_image,
)

IMPORT_ROLES = ("System Manager", "Tecnico de Inspecao")
REALTIME_EVENT = "mp_word_import"


def _file_content(file_url):
	file = frappe.get_doc("File", {"file_url": file_url})
	return file, file.get_content()


def _find_customer(name):
	if not name:
		return None
	if frappe.db.exists("Customer", name):
		return name
	match = frappe.db.sql(
		"select name from `tabCustomer` where upper(customer_name) = %s or upper(name) = %s limit 1",
		(name.upper(), name.upper()),
	)
	return match[0][0] if match else None


def _find_area(customer, area_name):
	rows = frappe.get_all("Area", filters={"customer": customer}, fields=["name", "area_name"])
	return next((r.name for r in rows if plain(r.area_name) == plain(area_name)), None)


def _equipment_index(customer, area):
	if not area:
		return {}
	rows = frappe.get_all("Equipment", filters={"customer": customer, "area": area}, fields=["name", "description"])
	return {plain(r.description): r.name for r in rows}


def _find_report(customer, area, report_date, readings_only):
	if not area:
		return None
	return frappe.db.get_value(
		"Inspection Report",
		{"customer": customer, "area": area, "report_date": report_date, "readings_only": readings_only},
		["name", "status"],
		as_dict=True,
	)


@frappe.whitelist()
def preview(file_urls, customer=None):
	"""What an import of these files would do - nothing is written."""
	frappe.only_for(IMPORT_ROLES)
	file_urls = frappe.parse_json(file_urls)

	files = []
	for file_url in file_urls:
		file, content = _file_content(file_url)
		try:
			parsed = parse_report(content, file.file_name)
		except Exception:
			files.append({"file_url": file_url, "file": file.file_name, "error": _("Not a readable Word report.")})
			continue

		target = customer or _find_customer(parsed["customer"])
		area = _find_area(target, parsed["area"]) if target else None
		known = _equipment_index(target, area) if target else {}
		report = _find_report(target, area, parsed["report_date"], 0) if target else None

		severities = {}
		for sheet in parsed["sheets"]:
			severities[sheet["severity"] or "?"] = severities.get(sheet["severity"] or "?", 0) + 1
		previous = next((s["previous"]["label"] for s in parsed["sheets"] if s["previous"]), "")

		files.append(
			{
				"file_url": file_url,
				"file": file.file_name,
				"customer": parsed["customer"],
				"customer_match": target,
				"area": parsed["area"],
				"area_exists": bool(area),
				"report_date": parsed["report_date"],
				"service_reference": parsed["service_reference"],
				"prepared_by": parsed["prepared_by"],
				"sheets": len(parsed["sheets"]),
				"new_equipment": sum(1 for s in parsed["sheets"] if plain(s["equipment"]) not in known),
				"with_previous": sum(1 for s in parsed["sheets"] if s["previous"]),
				"previous_label": previous,
				"photos": sum(1 for s in parsed["sheets"] if s["image"]),
				"severities": severities,
				"existing_report": report.name if report else None,
				"warnings": parsed["warnings"],
			}
		)
	return files


@frappe.whitelist()
def start_import(file_urls, customer):
	"""Queue the import - 20 files with photos is far too long for a web
	request. Progress comes back over realtime (REALTIME_EVENT)."""
	frappe.only_for(IMPORT_ROLES)
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer {0} does not exist.").format(customer))
	file_urls = frappe.parse_json(file_urls)
	frappe.enqueue(
		"manutencao_preditiva.word_import.import_job",
		queue="long",
		timeout=3600,
		file_urls=file_urls,
		customer=customer,
		user=frappe.session.user,
	)
	return len(file_urls)


def import_job(file_urls, customer, user):
	frappe.set_user(user)
	results = []
	for index, file_url in enumerate(file_urls, start=1):
		file_name = file_url.rsplit("/", 1)[-1]

		def progress(message, _index=index, _name=file_name):
			frappe.publish_realtime(
				REALTIME_EVENT,
				{"file": _name, "index": _index, "total": len(file_urls), "message": message},
				user=user,
			)

		try:
			result = import_file(file_url, customer, progress)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"Word import failed: {file_name}")
			result = {"file": file_name, "error": frappe.get_traceback().strip().splitlines()[-1]}
		results.append(result)
		progress(result.get("error") or _("Done"))

	frappe.publish_realtime(REALTIME_EVENT, {"finished": True, "results": results}, user=user)
	return results


def import_file(file_url, customer, progress=None):
	progress = progress or (lambda message: None)
	file, content = _file_content(file_url)
	parsed = parse_report(content, file.file_name)
	if not parsed["area"] or not parsed["report_date"]:
		frappe.throw(_("{0}: no area or report date found.").format(file.file_name))

	area = _find_area(customer, parsed["area"]) or _insert(
		{"doctype": "Area", "customer": customer, "area_name": parsed["area"]}
	)
	equipment = _ensure_equipment(customer, area, parsed["sheets"])
	result = {"file": file.file_name, "area": area, "created": 0, "skipped": 0, "warnings": list(parsed["warnings"])}

	# Previous month first, so the month's own sheets find it as their
	# "previous sheet" and fill their Prev. columns from it.
	with_previous = [s for s in parsed["sheets"] if s["previous"] and s["previous"]["period"]]
	if with_previous:
		year, month = with_previous[0]["previous"]["period"]
		previous_report = _ensure_report(
			customer,
			area,
			last_day(year, month),
			readings_only=1,
			fields={
				"prepared_by": parsed["prepared_by"],
				"site_address": parsed["site_address"],
				"notes": _("Readings only - the previous-month column of {0}.").format(file.file_name),
			},
		)
		progress(_("Previous month: {0} sheets").format(len(with_previous)))
		_fill_report(previous_report, with_previous, equipment, "previous", content, result)

	report = _ensure_report(
		customer,
		area,
		parsed["report_date"],
		readings_only=0,
		fields={
			"service_reference": parsed["service_reference"],
			"prepared_by": parsed["prepared_by"],
			"site_address": parsed["site_address"],
			"technicians": "\n".join(parsed["technicians"]),
		},
	)
	current = [s for s in parsed["sheets"] if s["current"]]
	progress(_("This month: {0} sheets").format(len(current)))
	_fill_report(report, current, equipment, "current", content, result, progress)

	# Keep the source file with the report it became.
	file.db_set({"attached_to_doctype": "Inspection Report", "attached_to_name": report.name})
	result["report"] = report.name
	return result


def _insert(doc):
	return frappe.get_doc(doc).insert().name


def _ensure_equipment(customer, area, sheets):
	"""description (plain) -> Equipment name; creates what's missing and adds
	any measurement point the sheets use that the equipment lacks."""
	index = _equipment_index(customer, area)
	for sheet in sheets:
		key = plain(sheet["equipment"])
		points = []
		for table in (sheet["previous"], sheet["current"]):
			for reading in (table or {}).get("readings", []):
				if reading["point"] not in points:
					points.append(reading["point"])

		if key not in index:
			index[key] = _insert(
				{
					"doctype": "Equipment",
					"customer": customer,
					"area": area,
					"description": sheet["equipment"],
					"points": [{"point_code": p} for p in points],
				}
			)
			continue

		doc = frappe.get_doc("Equipment", index[key])
		have = {(p.point_code or "").upper() for p in doc.points}
		missing = [p for p in points if p not in have]
		if missing:
			for point in missing:
				doc.append("points", {"point_code": point})
			doc.save()
	return index


def _ensure_report(customer, area, report_date, readings_only, fields):
	existing = _find_report(customer, area, report_date, readings_only)
	if existing:
		return frappe.get_doc("Inspection Report", existing.name)
	doc = frappe.get_doc(
		{
			"doctype": "Inspection Report",
			"customer": customer,
			"area": area,
			"technique": "Vibration",
			"report_date": report_date,
			"readings_only": readings_only,
			"status": "Draft",
			**{k: v for k, v in fields.items() if v},
		}
	)
	doc.insert()
	return doc


def _fill_report(report, sheets, equipment, column, content, result, progress=None):
	if report.status == "Issued":
		result["skipped"] += len(sheets)
		result["warnings"].append(_("{0} was already Issued - left as it is.").format(report.name))
		return

	done = set(frappe.get_all("Equipment Inspection", filters={"report": report.name}, pluck="equipment"))
	for count, sheet in enumerate(sheets, start=1):
		name = equipment[plain(sheet["equipment"])]
		if name in done:
			result["skipped"] += 1
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Equipment Inspection",
				"report": report.name,
				"equipment": name,
				"readings": [
					{
						"point": r["point"],
						"velocity_mm_s": r["velocity"],
						"acceleration_g": r["acceleration"],
						"temperature_c": r["temperature"],
					}
					for r in sheet[column]["readings"]
				],
			}
		)
		if column == "current":
			doc.update(
				{
					"severity": sheet["severity"],
					"tolerance_percent": sheet["tolerance"] or 0,
					"defects": sheet["defects"],
					"recommendations": sheet["recommendations"],
					"follow_up": sheet["follow_up"],
				}
			)
		doc.insert()

		if column == "current" and sheet["image"]:
			_attach_photo(doc, sheet, content)
		result["created"] += 1
		if progress and count % 10 == 0:
			progress(_("{0} of {1} sheets").format(count, len(sheets)))

	report.reload()
	report.status = "Issued"
	# Old reports carry free-text defects only - classifying them is a
	# separate clean-up, not a reason to leave the import in Draft.
	report.flags.ignore_defect_check = True
	try:
		report.save()
	except frappe.ValidationError as e:
		# e.g. a sheet with no severity - leave it Draft for someone to finish.
		frappe.clear_messages()
		report.reload()
		result["warnings"].append(_("{0} left as Draft: {1}").format(report.name, str(e)))


def _attach_photo(doc, sheet, content):
	extension = WEB_IMAGE_TYPES[sheet["image"].rsplit(".", 1)[-1].lower()]
	slug = re.sub(r"[^A-Za-z0-9]+", "-", sheet["equipment"]).strip("-").lower()[:60] or "equipment"
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{slug}.{extension}",
			"content": read_image(content, sheet["image"]),
			"is_private": 1,
			"attached_to_doctype": "Equipment Inspection",
			"attached_to_name": doc.name,
		}
	).insert()
	doc.append("images", {"image": file.file_url, "caption": sheet["equipment"]})
	doc.save()
