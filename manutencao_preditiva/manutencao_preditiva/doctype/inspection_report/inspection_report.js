// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

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
