// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.listview_settings["Equipment Inspection"] = {
	add_fields: ["severity"],
	get_indicator(doc) {
		const colours = {
			Normal: "green",
			Acceptable: "yellow",
			Alarm: "orange",
			Critical: "red",
			"Not Collected": "gray",
		};
		if (doc.severity) {
			return [__(doc.severity), colours[doc.severity], "severity,=," + doc.severity];
		}
		return [__("Not assessed"), "light-blue", "severity,=,"];
	},
};
