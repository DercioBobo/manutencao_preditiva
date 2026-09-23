// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Same severity colours used throughout the app - see equipment.js for why
// this stays a plain inline map on native forms rather than the app's own
// CSS custom properties.
const IR_SEVERITY_COLOR = {
	Normal: "#2e8b57",
	Acceptable: "#b8960c",
	Alarm: "#d97b29",
	Critical: "#c43b3b",
	"Not Collected": "#8a94a0",
};

function ir_dot(color) {
	return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${
		color || "#d9d9d9"
	};border:1px solid rgba(0,0,0,.15)"></span>`;
}

frappe.ui.form.on("Inspection Report", {
	setup(frm) {
		frm.set_query("area", () => ({ filters: { customer: frm.doc.customer } }));
	},

	customer(frm) {
		frm.set_value("area", null);
	},

	refresh(frm) {
		frm.page.set_indicator(__(frm.doc.status), frm.doc.status === "Issued" ? "green" : "orange");
		frm.trigger("render_summary");
		frm.trigger("render_sheets_panel");

		if (frm.is_new()) return;

		frm.add_custom_button(__("Create Equipment Sheets"), () => {
			frm.call("create_sheets").then((r) => {
				const created = r.message || 0;
				frappe.show_alert({
					message: created
						? __("{0} sheets created", [created])
						: __("Every equipment of this area already has a sheet"),
					indicator: created ? "green" : "blue",
				});
				frm.reload_doc();
			});
		});

		frm.add_custom_button(__("Open Sheets"), () => {
			frappe.set_route("List", "Equipment Inspection", { report: frm.doc.name });
		});
	},

	// Every equipment covered by this report, right on the form - which
	// equipment, its severity/status, and a defects preview - instead of
	// only being reachable via "Open Sheets" (a separate filtered list) or
	// the Connections tab (a count you have to click through first).
	render_sheets_panel(frm) {
		const wrapper = frm.fields_dict.sheets_html && frm.fields_dict.sheets_html.$wrapper;
		if (!wrapper || frm.is_new()) return;

		wrapper.html(`<p class="text-muted">${__("Loading...")}</p>`);

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { report: frm.doc.name },
					fields: ["name", "equipment", "equipment_description", "severity", "action_status", "defects"],
					order_by: "equipment_description",
					limit_page_length: 0,
				},
			})
			.then((r) => {
				const rows = r.message || [];
				if (!rows.length) {
					wrapper.html(`<p class="text-muted">${__("No sheets yet - use Create Equipment Sheets above.")}</p>`);
					return;
				}

				const body = rows
					.map(
						(row) => `
						<tr class="ir-sheet-row" data-name="${frappe.utils.escape_html(row.name)}" style="cursor:pointer">
							<td>${frappe.utils.escape_html(row.equipment_description || row.equipment)}</td>
							<td>${ir_dot(IR_SEVERITY_COLOR[row.severity])}${frappe.utils.escape_html(row.severity || "")}</td>
							<td>${frappe.utils.escape_html(row.action_status || "")}</td>
							<td class="text-muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${frappe.utils.escape_html(
								row.defects || ""
							)}</td>
						</tr>`
					)
					.join("");

				wrapper.html(`
					<table class="table table-sm">
						<thead><tr><th>${__("Equipment")}</th><th>${__("Severity")}</th><th>${__("Status")}</th><th>${__("Defects")}</th></tr></thead>
						<tbody>${body}</tbody>
					</table>
				`);

				wrapper.find(".ir-sheet-row").on("click", function () {
					frappe.set_route("Form", "Equipment Inspection", $(this).data("name"));
				});
			});
	},

	render_summary(frm) {
		const summary = (frm.doc.__onload || {}).summary;
		const wrapper = frm.fields_dict.summary_html && frm.fields_dict.summary_html.$wrapper;
		if (!wrapper) return;

		const colours = {
			Normal: "#00b050",
			Acceptable: "#ffff66",
			Alarm: "#ffb266",
			Critical: "#ff0000",
			"Not Collected": "#d9d9d9",
		};
		const total = (summary || []).reduce((sum, row) => sum + row.count, 0);
		if (!total) {
			wrapper.html(
				`<p class="text-muted">${__("No assessed sheets yet. Save the report, then use Create Equipment Sheets.")}</p>`
			);
			return;
		}

		const rows = summary
			.map(
				(row) => `<tr>
					<td><span style="display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:8px;
						background:${colours[row.severity]};border:1px solid rgba(0,0,0,.15)"></span>${__(row.severity)}</td>
					<td class="text-right">${row.count}</td>
					<td class="text-right">${row.percent}%</td>
				</tr>`
			)
			.join("");
		wrapper.html(`<table class="table table-sm" style="max-width:360px">
			<thead><tr><th>${__("Severity")}</th><th class="text-right">${__("Qty")}</th><th class="text-right">%</th></tr></thead>
			<tbody>${rows}</tbody></table>`);
	},
});
