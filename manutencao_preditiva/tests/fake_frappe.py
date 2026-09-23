# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt
"""Minimal in-memory stand-in for frappe - just enough to drive this app's
controllers outside a bench, for the tests in this package that exercise
actual doctype controllers (not pure logic like vibration.py already has
its own bench-free tests for).

Not a faithful frappe reimplementation - only the pieces this app's
controllers actually call. A passing test here does not replace clicking
through the real thing on a bench; see WORKFLOW.md.

`install()` replaces `sys.modules["frappe"]` (and frappe.model/frappe.utils)
for the rest of the process - only ever call it from a standalone script or
test run via `python -m unittest manutencao_preditiva.tests.<module>`,
never in a context where the real frappe might also be imported (e.g.
`bench run-tests`), since it would shadow the real module.
"""

import copy
import sys
import types
from datetime import date, datetime

DB = {}  # doctype -> {name: dict}
COUNTER = {}
CHILD_TABLES = {
	"Equipment Inspection": {"readings": "Vibration Reading", "images": "Equipment Inspection Image"},
	"Equipment": {"points": "Equipment Measurement Point"},
	"Vibration Alarm Settings": {"bands": "Vibration Alarm Band"},
}
SINGLES = {}
_CONTROLLERS = {}


def reset():
	"""Clears all in-memory state - call at the start of each test so one
	test's records can't leak into the next."""
	DB.clear()
	COUNTER.clear()
	SINGLES.clear()


class ValidationError(Exception):
	pass


class Row(dict):
	def __getattr__(self, k):
		return self.get(k)

	def __setattr__(self, k, v):
		self[k] = v


def _(s):
	return s


def throw(msg, title=None):
	raise ValidationError(msg)


def whitelist(*a, **k):
	if a and callable(a[0]):
		return a[0]
	return lambda f: f


class Document:
	def __init__(self, data=None, doctype=None):
		data = dict(data or {})
		self.doctype = doctype or data.pop("doctype")
		self._before = None
		self._new = "name" not in data
		for table in CHILD_TABLES.get(self.doctype, {}):
			data[table] = [Row(r) for r in data.get(table, [])]
		for k, v in data.items():
			setattr(self, k, v)
		self.name = data.get("name")
		self.flags = types.SimpleNamespace()

	def __getattr__(self, k):
		if k.startswith("_"):
			raise AttributeError(k)
		return None

	def get(self, fieldname, default=None):
		v = getattr(self, fieldname)
		return v if v is not None else default

	def is_new(self):
		return self._new

	def get_doc_before_save(self):
		return self._before

	def has_value_changed(self, f):
		return self._before is not None and getattr(self._before, f) != getattr(self, f)

	def check_permission(self, *_):
		pass

	def set_onload(self, k, v):
		pass

	def append(self, table, row):
		r = Row(row)
		r["idx"] = len(getattr(self, table)) + 1
		getattr(self, table).append(r)
		return r

	def as_dict(self):
		d = {k: v for k, v in self.__dict__.items() if not k.startswith("_") and k not in ("flags",)}
		for table in CHILD_TABLES.get(self.doctype, {}):
			d[table] = [dict(r) for r in d[table]]
		return d

	def _store(self):
		DB.setdefault(self.doctype, {})[self.name] = copy.deepcopy(self.as_dict())

	def insert(self):
		prefix = {"Equipment Inspection": "EI", "Inspection Report": "IR"}.get(self.doctype, self.doctype[:3].upper())
		COUNTER[prefix] = COUNTER.get(prefix, 0) + 1
		self.name = f"{prefix}-{COUNTER[prefix]:05d}"
		self._new = True
		self.validate()
		self._store()
		self._new = False
		return self

	def save(self):
		self._before = Document(copy.deepcopy(DB[self.doctype][self.name]), self.doctype)
		self._new = False
		self.validate()
		self._store()
		return self

	def validate(self):
		pass


def _match(rec, filters):
	for k, cond in (filters or {}).items():
		v = rec.get(k)
		if isinstance(cond, list):
			op, x = cond
			if op == "!=" and not v != x:
				return False
			if op == "<" and not (v is not None and v < x):
				return False
		elif v != cond:
			return False
	return True


def get_all(doctype, filters=None, fields=None, pluck=None, order_by=None, limit=None):
	rows = [dict(r, name=n) for n, r in DB.get(doctype, {}).items() if _match(r, filters)]
	if order_by:
		for part in reversed([p.strip() for p in order_by.split(",")]):
			field, _sp, direction = part.partition(" ")
			rows.sort(key=lambda r: (r.get(field) or "") if field != "creation" else r["name"], reverse=direction == "desc")
	if limit:
		rows = rows[:limit]
	if pluck:
		return [r.get(pluck) for r in rows]
	return [Row(r) for r in rows]


class _Db:
	def get_value(self, doctype, name, fields, as_dict=False):
		rec = DB.get(doctype, {}).get(name)
		if rec is None:
			return None
		if isinstance(fields, list):
			return Row({f: rec.get(f) for f in fields}) if as_dict else tuple(rec.get(f) for f in fields)
		return rec.get(fields)

	def exists(self, doctype, filters):
		if isinstance(filters, str):
			return filters in DB.get(doctype, {})
		found = [n for n, r in DB.get(doctype, {}).items() if _match(r, filters)]
		return found[0] if found else None


def get_doc(arg, name=None):
	if isinstance(arg, dict):
		doc_cls = _CONTROLLERS.get(arg["doctype"], Document)
		return doc_cls(arg)
	if arg in SINGLES:
		return SINGLES[arg]
	doc_cls = _CONTROLLERS.get(arg, Document)
	return doc_cls(copy.deepcopy(DB[arg][name]), arg)


def install():
	frappe = types.ModuleType("frappe")
	frappe._ = _
	frappe.throw = throw
	frappe.whitelist = whitelist
	frappe.get_all = get_all
	frappe.get_doc = get_doc
	frappe.db = _Db()
	frappe.ValidationError = ValidationError
	model = types.ModuleType("frappe.model")
	document = types.ModuleType("frappe.model.document")
	document.Document = Document
	utils = types.ModuleType("frappe.utils")
	utils.flt = lambda v, p=None: float(v or 0)
	utils.today = lambda: date.today().isoformat()
	utils.escape_html = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
	utils.getdate = lambda d: d if isinstance(d, date) else datetime.strptime(d, "%Y-%m-%d").date()
	utils.formatdate = lambda d: utils.getdate(d).strftime("%d-%m-%Y")
	frappe.model, frappe.utils = model, utils
	model.document = document
	sys.modules.update(
		{"frappe": frappe, "frappe.model": model, "frappe.model.document": document, "frappe.utils": utils}
	)
	return frappe
