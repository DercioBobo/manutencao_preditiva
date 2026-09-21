// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

const SEVERITY_INDICATOR = {
	Normal: "green",
	Acceptable: "yellow",
	Alarm: "orange",
	Critical: "red",
	"Not Collected": "gray",
};

frappe.ui.form.on("Equipment Inspection", {
	setup(frm) {
		frm.set_query("equipment", () => ({
			filters: { customer: frm.doc.customer, area: frm.doc.area, disabled: 0 },
		}));
	},

	refresh(frm) {
		if (frm.doc.severity) {
			frm.page.set_indicator(__(frm.doc.severity), SEVERITY_INDICATOR[frm.doc.severity]);
		}
		if (
			frm.doc.severity &&
			frm.doc.suggested_severity &&
			frm.doc.severity !== frm.doc.suggested_severity
		) {
			frm.dashboard.add_comment(
				__("Severity {0} differs from the {1} suggested by the readings.", [
					__(frm.doc.severity),
					__(frm.doc.suggested_severity),
				]),
				"blue",
				true
			);
		}
	},
});
