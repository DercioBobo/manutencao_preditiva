// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.listview_settings["Inspection Report"] = {
	add_fields: ["status"],
	get_indicator(doc) {
		return [__(doc.status), doc.status === "Issued" ? "green" : "orange", "status,=," + doc.status];
	},
};
