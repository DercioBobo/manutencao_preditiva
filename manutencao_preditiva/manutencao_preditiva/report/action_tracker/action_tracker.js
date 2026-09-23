// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.query_reports["Action Tracker"] = {
	filters: [
		{ fieldname: "customer", label: __("Customer"), fieldtype: "Link", options: "Customer" },
		{
			fieldname: "report",
			label: __("Report"),
			fieldtype: "Link",
			options: "Inspection Report",
			get_query: () => {
				const customer = frappe.query_report.get_filter_value("customer");
				return customer ? { filters: { customer } } : {};
			},
		},
		{ fieldname: "area", label: __("Area"), fieldtype: "Link", options: "Area" },
		{
			fieldname: "severity",
			label: __("Severity"),
			fieldtype: "Select",
			options: "\nNormal\nAcceptable\nAlarm\nCritical\nNot Collected",
		},
		{
			fieldname: "action_status",
			label: __("Action Status"),
			fieldtype: "Select",
			options: "\nOpen\nIn Progress\nDone\nNot Applicable",
		},
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date" },
		{ fieldname: "hide_normal", label: __("Hide Normal / Not Collected"), fieldtype: "Check" },
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "severity" && data && data.severity) {
			const colours = {
				Normal: "#00b050",
				Acceptable: "#ffff66",
				Alarm: "#ffb266",
				Critical: "#ff0000",
				"Not Collected": "#d9d9d9",
			};
			value = `<span style="display:block;padding:0 6px;border-radius:3px;background:${colours[data.severity]};color:#222">${value}</span>`;
		}
		return value;
	},
};
