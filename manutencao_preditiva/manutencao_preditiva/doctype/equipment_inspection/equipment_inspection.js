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

	// Server-side (prepare_readings()) only builds the readings table on
	// save, for a brand-new sheet - so without this, picking an equipment
	// shows nothing to type into until you save once. Mirrors that same
	// "new + still empty" condition here, just eagerly, so there's always
	// something on screen the moment an equipment is chosen.
	equipment(frm) {
		if (!frm.is_new() || (frm.doc.readings || []).length || !frm.doc.equipment) return;

		const equipment = frm.doc.equipment;
		frappe.call({ method: "frappe.client.get", args: { doctype: "Equipment", name: equipment } }).then((r) => {
			// The field may have changed again while this call was in flight.
			if (frm.doc.equipment !== equipment) return;

			frm.clear_table("readings");
			(r.message.points || []).forEach((point) => {
				frm.add_child("readings", { point: point.point_code });
			});
			frm.refresh_field("readings");
		});
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
