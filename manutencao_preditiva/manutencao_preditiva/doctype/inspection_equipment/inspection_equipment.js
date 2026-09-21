// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.ui.form.on("Inspection Equipment", {
	setup(frm) {
		frm.set_query("area", () => ({ filters: { customer: frm.doc.customer } }));
	},
	customer(frm) {
		frm.set_value("area", null);
	},
});
