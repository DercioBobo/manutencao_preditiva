// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Same severity colours used throughout the app (vibration.py/
// report_workbench.js/meus_achados.js) - kept as a plain inline map here
// rather than the app's CSS custom properties, since native Frappe forms
// stay in Frappe's own styling (see README's "Visual design" section for
// why that line was drawn) - this only reuses the *meaning* of the
// colours, not the rest of that design system.
const EQ_SEVERITY_COLOR = {
	Normal: "#2e8b57",
	Acceptable: "#b8960c",
	Alarm: "#d97b29",
	Critical: "#c43b3b",
	"Not Collected": "#8a94a0",
};

function eq_dot(color) {
	return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${
		color || "#d9d9d9"
	};border:1px solid rgba(0,0,0,.15)"></span>`;
}

frappe.ui.form.on("Equipment", {
	setup(frm) {
		frm.set_query("area", () => ({ filters: { customer: frm.doc.customer } }));
	},
	customer(frm) {
		frm.set_value("area", null);
	},
	refresh(frm) {
		frm.trigger("render_inspection_history");
	},

	// Every Equipment Inspection sheet ever done on this equipment, across
	// every report - which report, when, and its severity/status - so
	// there's no need to go hunting through report after report to see
	// this equipment's own trend. The doctype's own "Inspections"
	// Connections entry (see equipment.json) covers filtering/sorting on
	// more fields than this reads at a glance; this panel is for the
	// "what's this equipment's history, right now" case.
	render_inspection_history(frm) {
		const wrapper = frm.fields_dict.inspection_history_html && frm.fields_dict.inspection_history_html.$wrapper;
		if (!wrapper || frm.is_new()) return;

		wrapper.html(`<p class="text-muted">${__("Loading...")}</p>`);

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { equipment: frm.doc.name },
					fields: ["name", "report", "report.period_label as period_label", "severity", "action_status"],
					// report_date exists on both Equipment Inspection and the
					// joined Inspection Report (from the dotted fetch above) -
					// qualify it, same fix as the order_by ambiguous-column bug
					// elsewhere in this app (see WORKFLOW.md).
					order_by: "`tabEquipment Inspection`.report_date desc",
					limit_page_length: 0,
				},
			})
			.then((r) => {
				const rows = r.message || [];
				if (!rows.length) {
					wrapper.html(`<p class="text-muted">${__("No inspections recorded for this equipment yet.")}</p>`);
					return;
				}

				const body = rows
					.map(
						(row) => `
						<tr class="eq-history-row" data-name="${frappe.utils.escape_html(row.name)}" style="cursor:pointer">
							<td>${frappe.utils.escape_html(row.period_label || "")}</td>
							<td><a href="#" class="eq-history-report" data-report="${frappe.utils.escape_html(
								row.report
							)}">${frappe.utils.escape_html(row.report)}</a></td>
							<td>${eq_dot(EQ_SEVERITY_COLOR[row.severity])}${frappe.utils.escape_html(row.severity || "")}</td>
							<td>${frappe.utils.escape_html(row.action_status || "")}</td>
						</tr>`
					)
					.join("");

				wrapper.html(`
					<table class="table table-sm">
						<thead><tr><th>${__("Period")}</th><th>${__("Report")}</th><th>${__("Severity")}</th><th>${__("Status")}</th></tr></thead>
						<tbody>${body}</tbody>
					</table>
				`);

				wrapper.find(".eq-history-report").on("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					frappe.set_route("Form", "Inspection Report", $(this).data("report"));
				});
				wrapper.find(".eq-history-row").on("click", function () {
					frappe.set_route("Form", "Equipment Inspection", $(this).data("name"));
				});
			});
	},
});
