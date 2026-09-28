# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Parser for the team's FR.TEC.09 vibration Word reports (.docx).

Standard library only - a .docx is a zip of XML - and no frappe import, so
nothing extra has to be installed on the bench and it can be run against
the real files outside of it. The importer is word_import.py.
"""

import calendar
import datetime
import re
import unicodedata
import zipfile
from io import BytesIO
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

MONTHS = {
	"JAN": 1, "FEV": 2, "MAR": 3, "ABR": 4, "MAI": 5, "JUN": 6,
	"JUL": 7, "AGO": 8, "SET": 9, "OUT": 10, "NOV": 11, "DEZ": 12,
}
MONTH_NAMES = {
	"JANEIRO": 1, "FEVEREIRO": 2, "MARCO": 3, "ABRIL": 4, "MAIO": 5, "JUNHO": 6,
	"JULHO": 7, "AGOSTO": 8, "SETEMBRO": 9, "OUTUBRO": 10, "NOVEMBRO": 11, "DEZEMBRO": 12,
}

# "OBSERVAÇÕES:" text on the sheet -> severity (keys without accents).
SEVERITY_WORDS = {
	"NORMAL": "Normal",
	"ACEITAVEL": "Acceptable",
	"ALARME": "Alarm",
	"CRITICO": "Critical",
	"NAO COLETADO": "Not Collected",
	"NAO COLECTADO": "Not Collected",
}
# Cell fill of the "CONDIÇÃO" column in the summary tables - the fallback
# when a sheet's OBSERVAÇÕES holds something else (e.g. a defect name).
SEVERITY_FILLS = {
	"00B050": "Normal",
	"FFFF00": "Acceptable",
	"FFFF66": "Acceptable",
	"F79646": "Alarm",
	"FFC000": "Alarm",
	"FFB266": "Alarm",
	"EE0000": "Critical",
	"FF0000": "Critical",
	"C00000": "Critical",
}

# Browsers can't show these, so they are left out (and reported).
WEB_IMAGE_TYPES = {"png": "png", "jpg": "jpg", "jpeg": "jpg", "gif": "gif", "bmp": "bmp", "webp": "webp"}


def plain(text):
	"""Upper case, no accents, single spaces - for comparing labels."""
	text = unicodedata.normalize("NFKD", text or "")
	text = "".join(c for c in text if not unicodedata.combining(c))
	return re.sub(r"\s+", " ", text).strip().upper()


def _para_text(p):
	parts = []
	for node in p.iter():
		if node.tag == W + "t":
			parts.append(node.text or "")
		elif node.tag == W + "tab":
			parts.append("\t")
	return "".join(parts)


def _cell_lines(tc):
	"""The cell's own paragraphs (not those of tables nested in it)."""
	return [t for t in (_para_text(p).strip() for p in tc.findall(W + "p")) if t]


def _cell_text(tc):
	return " ".join(_cell_lines(tc))


def _rows(tbl):
	return tbl.findall(W + "tr")


def _cells(tr):
	return tr.findall(W + "tc")


def _style(p):
	style = p.find(W + "pPr/" + W + "pStyle")
	return style.get(W + "val") if style is not None else ""


def _fill(tc):
	shd = tc.find(W + "tcPr/" + W + "shd")
	return (shd.get(W + "fill") or "").upper() if shd is not None else ""


def _number(text):
	text = (text or "").strip().replace(",", ".")
	match = re.match(r"^-?\d+(\.\d+)?$", text)
	return float(text) if match else None


def _dedupe_doubled(text):
	"""Word text boxes come out twice ("CDM JARDIMCDM JARDIM")."""
	half = len(text) // 2
	if len(text) % 2 == 0 and text[:half] == text[half:]:
		return text[:half]
	return text


def _period(label):
	"""'JUL/26', 'AGOST/26', 'AGO/2026' -> (2026, 7). None when unreadable."""
	match = re.match(r"^\s*([A-Za-zÀ-ÿ]+)\.?\s*/\s*(\d{2,4})", label or "")
	if not match:
		return None
	month = MONTHS.get(plain(match.group(1))[:3])
	if not month:
		return None
	year = int(match.group(2))
	return (year + 2000 if year < 100 else year, month)


def last_day(year, month):
	return datetime.date(year, month, calendar.monthrange(year, month)[1])


def _parse_readings(tbl):
	rows = _rows(tbl)
	if len(rows) < 2:
		return None
	head = _cells(rows[0])
	label = _cell_text(head[1]) if len(head) > 1 else ""
	readings = []
	for tr in rows[2:]:
		values = [_cell_text(tc) for tc in _cells(tr)]
		if not values or not values[0].strip():
			continue
		point = plain(values[0]).replace(" ", "")
		temperature = next((_number(v) for v in values[3:] if _number(v) is not None), None)
		readings.append(
			{
				"point": point,
				"velocity": _number(values[1]) if len(values) > 1 else None,
				"acceleration": _number(values[2]) if len(values) > 2 else None,
				"temperature": temperature,
			}
		)
	return {"label": label.strip(), "period": _period(label), "readings": readings}


def _labelled(lines, label):
	"""Value after 'LABEL:' in the title cell's lines, up to the next label."""
	text = "\n".join(lines)
	match = re.search(label + r"\s*:\s*(.*?)\s*(?=\n|LOCAL\s*:|OBSERVA\w*\s*:|$)", text, re.I)
	return match.group(1).strip() if match else ""


def _parse_sheet(tbl, targets):
	rows = _rows(tbl)
	title_cells = _cells(rows[0])
	lines = _cell_lines(title_cells[0])
	sheet = {
		"equipment": re.sub(r"\s+", " ", _labelled(lines, "EQUIPAMENTO")).strip(),
		"local": _labelled(lines, "LOCAL"),
		"observation": _labelled(lines, r"OBSERVA\w*"),
		"tolerance": None,
		"tables": [],
		"defects": "",
		"recommendations": "",
		"follow_up": "",
		"image": None,
	}
	tolerance = re.search(r"TOLER\w*\s*:\s*([\d.,]+)", " ".join(_cell_text(tc) for tc in title_cells), re.I)
	if tolerance:
		sheet["tolerance"] = _number(tolerance.group(1))

	for tr in rows[1:]:
		cells = _cells(tr)
		for tc in cells:
			for nested in tc.findall(W + "tbl"):
				table = _parse_readings(nested)
				if table and table["readings"]:
					sheet["tables"].append(table)
			if sheet["image"] is None and not tc.findall(W + "tbl"):
				blip = next((n for n in tc.iter() if n.tag.endswith("}blip")), None)
				if blip is not None:
					sheet["image"] = targets.get(blip.get(REL + "embed"))
		if len(cells) < 2 or cells[1].findall(W + "tbl"):
			continue
		label = plain(_cell_text(cells[0]))
		value = "\n".join(_cell_lines(cells[1])).strip()
		if "DEFEITOS" in label:
			sheet["defects"] = value
		elif "RECOMENDA" in label:
			sheet["recommendations"] = value
		elif "ACOES TOMADAS" in label:
			sheet["follow_up"] = value
	return sheet


def _parse_summary(tbl, colours):
	"""EQUIPAMENTOS "..." tables: description -> severity from the fill."""
	for tr in _rows(tbl)[3:]:
		cells = _cells(tr)
		if len(cells) < 2:
			continue
		description = plain(_cell_text(cells[1]))
		severity = next((SEVERITY_FILLS[_fill(tc)] for tc in cells[2:] if _fill(tc) in SEVERITY_FILLS), None)
		if description and severity:
			colours[description] = severity


def parse_report(content, filename=""):
	"""Everything the importer needs from one .docx, as plain data."""
	archive = zipfile.ZipFile(BytesIO(content))
	rels = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
	targets = {r.get("Id"): "word/" + r.get("Target").lstrip("/").replace("word/", "", 1) for r in rels.iter(PKG_REL + "Relationship")}
	body = ET.fromstring(archive.read("word/document.xml")).find(W + "body")

	# The cover page is laid out with text boxes or a borderless table,
	# depending on the file - so read the innermost paragraphs of both, one
	# line each, rather than a whole box run together (twice, as Word keeps
	# a fallback copy of every text box).
	paragraphs, sheets, colours = [], [], {}

	def add_lines(element):
		for p in element.iter(W + "p"):
			if any(inner is not p for inner in p.iter(W + "p")):
				continue
			text = _para_text(p).strip()
			if text and not (paragraphs and paragraphs[-1][0] == text):
				paragraphs.append((text, p))

	for element in body:
		if element.tag == W + "p":
			add_lines(element)
		elif element.tag == W + "tbl":
			rows = _rows(element)
			if not rows or not _cells(rows[0]):
				continue
			first = plain(_cell_text(_cells(rows[0])[0]))
			if first.startswith("EQUIPAMENTO:"):
				sheets.append(_parse_sheet(element, targets))
			elif "PLANTA" in plain(" ".join(_cell_text(tc) for tc in _cells(rows[0]))):
				_parse_summary(element, colours)
			elif not sheets:
				add_lines(element)

	report = {
		"file": filename,
		"service_reference": "",
		"customer": "",
		"prepared_by": "",
		"site_address": "",
		"report_date": None,
		"technicians": [],
		"area": "",
		"sheets": [],
		"warnings": [],
	}
	ref = re.search(r"R\d+_(\d{3,6})_", filename or "")
	if ref:
		report["service_reference"] = ref.group(1)

	texts = [t for t, _el in paragraphs]
	# "LABEL: value", or the value on the next line when the label stands alone.
	header = "\n".join(line.strip() for t in texts[:40] for line in t.split("\t") if line.strip())
	match = re.search(r"PREPARADO POR:[ ]*\n?([^\n]+)", header)
	if match:
		report["prepared_by"] = re.sub(r"\s+", " ", match.group(1)).strip().title()
	match = re.search(r"ENDERE\w+:[ ]*\n?([^\n]+)", header)
	if match:
		report["site_address"] = re.sub(r"\s+", " ", match.group(1)).strip()
	match = re.search(r"DATA: (\d{1,2}) DE (\w+) DE (\d{4})", plain(header))
	if match and MONTH_NAMES.get(match.group(2)):
		report["report_date"] = datetime.date(int(match.group(3)), MONTH_NAMES[match.group(2)], int(match.group(1)))

	# "Apresentar relatórios de vibração realizados na CDM JARDIM" - more
	# reliable than the cover's Title, which some files fill with the header.
	match = re.search(r"realizados na\s+(.+?)[\s.]*$", "\n".join(texts[:60]), re.I | re.M)
	if match:
		report["customer"] = match.group(1).strip()
	else:
		title = next((t for t, el in paragraphs[:10] if _style(el) == "Title"), "")
		report["customer"] = _dedupe_doubled(title) if len(title) < 120 else ""

	keys = [plain(t) for t in texts]
	if "TECNICOS RESPONSAVEIS" in keys:
		for text in texts[keys.index("TECNICOS RESPONSAVEIS") + 1 :]:
			if plain(text).startswith("PRINCIPIOS") or len(report["technicians"]) >= 6:
				break
			report["technicians"].append(text.title())
	for index, text in enumerate(keys):
		if text.startswith("AREA DE TRABALHO") and index + 1 < len(texts):
			report["area"] = re.sub(r"\s+", " ", texts[index + 1]).strip()
			break

	# The month of the report: from the header date, else from the sheets.
	if not report["report_date"]:
		periods = [t["period"] for s in sheets for t in s["tables"] if t["period"]]
		if periods:
			year, month = max(periods)
			report["report_date"] = last_day(year, month)
	current = (report["report_date"].year, report["report_date"].month) if report["report_date"] else None

	seen = set()
	for sheet in sheets:
		name = sheet["equipment"] or "?"
		sheet["current"] = next((t for t in sheet["tables"] if t["period"] == current), None)
		sheet["previous"] = next((t for t in sheet["tables"] if t["period"] and current and t["period"] < current), None)
		if not sheet["current"] and len(sheet["tables"]) == 2 and not sheet["previous"]:
			sheet["previous"], sheet["current"] = sheet["tables"]
		del sheet["tables"]

		word = plain(sheet["observation"])
		sheet["severity"] = next((v for k, v in SEVERITY_WORDS.items() if word.startswith(k)), None)
		if not sheet["severity"]:
			sheet["severity"] = colours.get(plain(name))
			if sheet["severity"]:
				report["warnings"].append(
					f"{name}: OBSERVAÇÕES says '{sheet['observation'] or '(blank)'}' - severity {sheet['severity']} taken from the summary table colour."
				)
			else:
				report["warnings"].append(f"{name}: no severity found - left for the readings to suggest.")
		if not sheet["current"]:
			report["warnings"].append(f"{name}: no readings for this month.")
		if sheet["image"] and sheet["image"].rsplit(".", 1)[-1].lower() not in WEB_IMAGE_TYPES:
			report["warnings"].append(f"{name}: photo is .{sheet['image'].rsplit('.', 1)[-1]} (not viewable in a browser) - skipped.")
			sheet["image"] = None
		if sheet["tolerance"] is not None and not 0 <= sheet["tolerance"] <= 10:
			report["warnings"].append(f"{name}: tolerance {sheet['tolerance']} ignored (must be 0-10%).")
			sheet["tolerance"] = None
		key = plain(name)
		if key in seen:
			report["warnings"].append(f"{name}: appears twice in this file - only the first sheet is imported.")
			continue
		seen.add(key)
		report["sheets"].append(sheet)

	if not report["area"]:
		report["warnings"].append("No 'AREA DE TRABALHO' found.")
	if not report["report_date"]:
		report["warnings"].append("No report date found.")
	return report


def read_image(content, path):
	return zipfile.ZipFile(BytesIO(content)).read(path)
