// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt
//
// The "see everything interlinked" hub: pick or create an Inspection
// Report, see its whole team-facing picture in one place - status, severity
// summary, every Equipment Inspection sheet in it - and jump to the PDF.
// This is now the only staff-side entry point for technical data entry -
// Quick Finding Entry (Registo Rápido de Achados) was retired 2026-09-23
// once this page could do everything it did and more (report creation,
// browsing Issued reports too, status/print actions); its two features
// this page didn't already have - search/severity-chip filtering and a
// Cards view - were ported in below rather than left behind, and its
// equipment-picker + readings/diagnosis/gallery editor were the starting
// point for this page's own (see render_sheets_card()/open_sheet_dialog()).
//
// Clicking a sheet opens it in a Dialog right here, not a page navigation -
// so there's still only ONE editing surface for a sheet's technical
// content, not two: the native Equipment Inspection form (full-featured,
// linked from "Open Full Form" inside the dialog for anything this lighter
// editor doesn't cover, e.g. more than one new image) and this Dialog.
// A real side panel or a second full page were both considered and
// rejected - a Dialog is a well-worn Frappe component, and hand-building
// panel positioning/animation with no bench to preview it against was not
// worth the risk for what is ultimately a cosmetic difference.
//
// Staff-only (System Manager / Tecnico de Inspecao) - not client-facing,
// see My Findings for that.

frappe.provide("manutencao_preditiva");

frappe.pages["report-workbench"].on_page_load = function (wrapper) {
	wrapper.rw = new manutencao_preditiva.ReportWorkbench(wrapper);
};

frappe.pages["report-workbench"].on_page_show = function (wrapper) {
	if (!wrapper.rw) return;
	wrapper.rw.load_recent_reports();
	if (wrapper.rw.report) wrapper.rw.load_report(wrapper.rw.report);
};

const RW_SEVERITY_OPTIONS = ["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"];

const RW_SEVERITY_HEX = {
	Critical: "#c4453a",
	Alarm: "#d99226",
	Acceptable: "#b8a021",
	Normal: "#3a9d5b",
	"Not Collected": "#6b7680",
};

const RW_STATUS_HEX = {
	Open: "#d99226",
	"In Progress": "#2b6cb0",
	Done: "#3a9d5b",
	"Not Applicable": "#6b7680",
};

const RW_REPORT_STATUS_HEX = { Draft: "#6b7680", Issued: "#3a9d5b" };

function rw_badge(text, color) {
	if (!text) return "";
	return `<span class="rw-badge" style="background:${color || "#6b7680"}">${frappe.utils.escape_html(text)}</span>`;
}

manutencao_preditiva.ReportWorkbench = class ReportWorkbench {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.report = null;
		this.report_doc = null;
		this.sheet_rows = [];
		this.sheets_view_mode = "table";
		this.sheets_search = "";
		this.sheets_severity_filter = "all";
		this.recent_rows = [];
		this.recent_status_filter = "all";
		this.recent_search = "";

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Report Workbench"),
			single_column: true,
		});

		this.render_shell();
		this.load_recent_reports();
	}

	render_shell() {
		this.$container = $('<div class="rw">').appendTo(this.page.body);
		this.render_picker();
		this.$workbench = $("<div>").appendTo(this.$container).hide();
		this.render_report_card();
		this.render_sheets_card();
	}

	// ---- picker: pick an existing report, browse recent ones, or create one --

	render_picker() {
		const $card = $('<div class="rw-card">').appendTo(this.$container);
		const $row = $('<div class="rw-picker-row">').appendTo($card);

		const $field_wrap = $('<div class="rw-field">').appendTo($row);
		this.report_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "report",
				label: __("Report"),
				options: "Inspection Report",
				onchange: () => {
					const value = this.report_control.get_value();
					if (value) this.load_report(value);
				},
			},
			parent: $field_wrap[0],
			render_input: true,
		});
		this.report_control.refresh();

		this.$new_btn = $(`<button class="rw-btn rw-btn-primary">${__("+ New Report")}</button>`).appendTo($row);
		this.$new_btn.on("click", () => this.open_new_report_dialog());

		const $recent_toolbar = $('<div class="rw-recent-toolbar">').appendTo($card);
		$(`<div class="rw-recent-title">${__("Recent Reports")}</div>`).appendTo($recent_toolbar);

		const $filters = $('<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">').appendTo($recent_toolbar);
		this.$recent_search = $(
			`<input type="text" class="rw-search" placeholder="${__("Search customer, area, period...")}">`
		).appendTo($filters);
		this.$recent_search.on("input", () => {
			this.recent_search = (this.$recent_search.val() || "").toLowerCase().trim();
			this.render_recent_table();
		});

		this.$recent_chips = $('<div class="rw-chips">').appendTo($filters);
		[
			["all", __("All")],
			["Draft", __("Draft")],
			["Issued", __("Issued")],
		].forEach(([key, label]) => {
			const $chip = $(`<button class="rw-chip" data-key="${key}">${label}</button>`).appendTo(this.$recent_chips);
			if (key === "all") $chip.addClass("active");
			$chip.on("click", () => {
				this.recent_status_filter = key;
				this.$recent_chips.find(".rw-chip").removeClass("active");
				$chip.addClass("active");
				this.render_recent_table();
			});
		});

		this.$recent_table_wrap = $('<div class="rw-table-wrap">').appendTo($card);
	}

	load_recent_reports() {
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Inspection Report",
					fields: ["name", "customer", "area", "area.area_name as area_name", "period_label", "report_date", "status"],
					// "creation" alone is ambiguous once the area.area_name fetch joins
					// in tabArea (it has its own creation column too) - qualify it.
					order_by: "report_date desc, `tabInspection Report`.creation desc",
					limit_page_length: 100,
				},
			})
			.then((r) => {
				this.recent_rows = r.message || [];
				this.render_recent_table();
			});
	}

	render_recent_table() {
		const rows = this.recent_rows.filter((row) => {
			if (this.recent_status_filter !== "all" && row.status !== this.recent_status_filter) return false;
			if (!this.recent_search) return true;
			const haystack = [row.customer, row.area_name, row.period_label].filter(Boolean).join(" ").toLowerCase();
			return haystack.includes(this.recent_search);
		});

		this.$recent_table_wrap.empty();
		if (!rows.length) {
			this.$recent_table_wrap.html(`<div class="rw-empty">${__("No reports found.")}</div>`);
			return;
		}

		const $table = $('<table class="rw-table">').appendTo(this.$recent_table_wrap);
		$table.append(
			`<thead><tr><th>${__("Customer")}</th><th>${__("Area")}</th><th>${__("Period")}</th><th>${__("Status")}</th></tr></thead>`
		);
		const $tbody = $("<tbody>").appendTo($table);
		rows.forEach((row) => {
			const $tr = $("<tr>").appendTo($tbody);
			$("<td>").text(row.customer || "").appendTo($tr);
			$("<td>").text(row.area_name || row.area || "").appendTo($tr);
			$("<td>").text(row.period_label || "").appendTo($tr);
			$("<td>").html(rw_badge(row.status, RW_REPORT_STATUS_HEX[row.status])).appendTo($tr);
			$tr.on("click", () => this.report_control.set_value(row.name));
		});
	}

	open_new_report_dialog() {
		const dialog = new frappe.ui.Dialog({
			title: __("New Inspection Report"),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "customer",
					label: __("Customer"),
					options: "Customer",
					reqd: 1,
					onchange: () => dialog.set_value("area", ""),
				},
				{
					fieldtype: "Link",
					fieldname: "area",
					label: __("Area / Plant"),
					options: "Area",
					reqd: 1,
					get_query: () => ({ filters: { customer: dialog.get_value("customer") } }),
				},
				{ fieldtype: "Column Break" },
				{
					fieldtype: "Date",
					fieldname: "report_date",
					label: __("Report Date"),
					default: frappe.datetime.get_today(),
					reqd: 1,
				},
				{ fieldtype: "Data", fieldname: "service_reference", label: __("Service / Job No.") },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Data", fieldname: "site_address", label: __("Site Address") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "prepared_by", label: __("Prepared by") },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Data", fieldname: "instrument", label: __("Instrument"), default: "Vib-Xpert II" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Small Text", fieldname: "technicians", label: __("Technicians"), description: __("One per line") },
			],
			primary_action_label: __("Create"),
			primary_action: (values) => {
				dialog.get_primary_btn().prop("disabled", true);
				frappe
					.call({
						method: "frappe.client.insert",
						args: { doc: Object.assign({ doctype: "Inspection Report" }, values) },
					})
					.then((r) => {
						dialog.hide();
						frappe.show_alert({ message: __("Report {0} created", [r.message.name]), indicator: "green" });
						this.load_recent_reports();
						this.report_control.set_value(r.message.name);
					})
					.always(() => dialog.get_primary_btn().prop("disabled", false));
			},
		});
		dialog.show();
	}

	// ---- selected report: header, actions, summary, sheets --------------------

	load_report(name) {
		this.report = name;
		frappe.dom.freeze(__("Loading report..."));
		frappe
			.call({ method: "frappe.client.get", args: { doctype: "Inspection Report", name } })
			.then((r) => {
				const doc = r.message;
				return (doc.area ? frappe.db.get_value("Area", doc.area, "area_name") : Promise.resolve({ message: {} })).then(
					(area_r) => {
						doc.area_name = (area_r.message && area_r.message.area_name) || doc.area;
						this.report_doc = doc;
						this.$workbench.show();
						this.render_report_header();
						this.load_summary();
						this.load_sheets();
					}
				);
			})
			.always(() => frappe.dom.unfreeze());
	}

	render_report_card() {
		this.$report_card = $('<div class="rw-card">').appendTo(this.$workbench);
	}

	render_report_header() {
		const doc = this.report_doc;
		this.$report_card.empty();

		const $head = $('<div class="rw-report-head">').appendTo(this.$report_card);
		const $title_wrap = $("<div>").appendTo($head);
		$(
			`<div class="rw-report-title">${frappe.utils.escape_html(doc.customer)} — ${frappe.utils.escape_html(
				doc.period_label || doc.report_date
			)}</div>`
		).appendTo($title_wrap);

		const $meta = $('<div class="rw-report-meta">').appendTo($title_wrap);
		$("<span>").text(doc.area_name).appendTo($meta);
		if (doc.service_reference) $("<span>").text(doc.service_reference).appendTo($meta);
		if (doc.prepared_by) $("<span>").text(doc.prepared_by).appendTo($meta);
		if (doc.instrument) $("<span>").text(doc.instrument).appendTo($meta);

		$("<div>").html(rw_badge(doc.status, RW_REPORT_STATUS_HEX[doc.status])).appendTo($head);

		if (doc.notes) {
			$('<div class="rw-notes">').text(doc.notes).appendTo(this.$report_card);
		}

		this.$summary_wrap = $("<div>").appendTo(this.$report_card);

		const $actions = $('<div class="rw-toolbar" style="margin-top:14px">').appendTo(this.$report_card);

		this.$toggle_status_btn = $(`<button class="rw-btn"></button>`).appendTo($actions);
		this.$toggle_status_btn.text(doc.status === "Draft" ? __("Issue Report") : __("Reopen to Draft"));
		this.$toggle_status_btn.on("click", () => this.toggle_status());

		$(`<button class="rw-btn">${__("Print Report")}</button>`)
			.appendTo($actions)
			.on("click", () => frappe.set_route("print", "Inspection Report", this.report));

		$(`<button class="rw-btn">${__("Open Full Form")}</button>`)
			.appendTo($actions)
			.on("click", () => frappe.set_route("Form", "Inspection Report", this.report));
	}

	toggle_status() {
		const next_status = this.report_doc.status === "Draft" ? "Issued" : "Draft";
		this.$toggle_status_btn.prop("disabled", true);
		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Inspection Report", name: this.report, fieldname: { status: next_status } },
			})
			.then((r) => {
				this.report_doc.status = r.message.status;
				frappe.show_alert({
					message: r.message.status === "Issued" ? __("Report issued") : __("Report reopened to Draft"),
					indicator: "green",
				});
				this.render_report_header();
				this.load_recent_reports();
				this.render_sheets_lock_note(); // sheets didn't change, but whether they're locked did
			})
			.always(() => this.$toggle_status_btn.prop("disabled", false));
	}

	load_summary() {
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { report: this.report },
					fields: ["severity", "count(name) as total"],
					group_by: "severity",
				},
			})
			.then((r) => this.render_summary(r.message || []));
	}

	render_summary(rows) {
		this.$summary_wrap.empty();
		const total = rows.reduce((sum, row) => sum + row.total, 0);
		if (!total) return;

		const $bar = $('<div class="rw-summary-bar">').appendTo(this.$summary_wrap);
		const $legend = $('<div class="rw-summary-legend">').appendTo(this.$summary_wrap);

		RW_SEVERITY_OPTIONS.forEach((sev) => {
			const row = rows.find((r) => r.severity === sev);
			if (!row || !row.total) return;
			const pct = (row.total / total) * 100;
			$(`<div class="rw-summary-seg" style="width:${pct}%;background:${RW_SEVERITY_HEX[sev]}">`).appendTo($bar);
			const $item = $('<div class="rw-summary-legend-item">').appendTo($legend);
			$('<span class="rw-summary-dot">').css("background", RW_SEVERITY_HEX[sev]).appendTo($item);
			$("<span>").text(`${sev}: ${row.total}`).appendTo($item);
		});
	}

	// ---- sheets: every equipment covered by this report ------------------------

	render_sheets_card() {
		this.$sheets_card = $('<div class="rw-card">').appendTo(this.$workbench);
		const $toolbar = $('<div class="rw-toolbar" style="justify-content:space-between;margin-bottom:14px">').appendTo(
			this.$sheets_card
		);
		$(`<div class="rw-recent-title">${__("Equipment Sheets")}</div>`).appendTo($toolbar);

		const $buttons = $('<div class="rw-toolbar">').appendTo($toolbar);
		this.$bulk_btn = $(`<button class="rw-btn">${__("Create Equipment Sheets")}</button>`).appendTo($buttons);
		this.$bulk_btn.on("click", () => this.create_all_sheets());

		this.$new_sheet_btn = $(`<button class="rw-btn rw-btn-primary">${__("New Sheet")}</button>`).appendTo($buttons);
		this.$new_sheet_btn.on("click", () => this.open_equipment_picker());

		// The report picker above has no Draft-only filter (Report Workbench
		// is meant to also browse Issued reports), so this is the one place
		// a técnico could land on an Issued report and try to edit a sheet -
		// server-side (equipment_inspection.py) refuses it either way, this
		// just says so before they click instead of only after.
		this.$sheets_lock_note = $('<div class="rw-notes" style="margin-bottom:10px"></div>').appendTo(this.$sheets_card);

		// Search + severity chips (client-side, over whatever's already
		// loaded) and a Table/Cards toggle - ported from Quick Finding
		// Entry when that page was retired, rather than left behind.
		const $filter_row = $('<div class="rw-picker-row" style="margin-bottom:14px">').appendTo(this.$sheets_card);
		this.$sheets_search = $(
			`<input type="text" class="rw-search" placeholder="${__("Search by equipment, description...")}">`
		).appendTo($filter_row);
		this.$sheets_search.on("input", () => {
			this.sheets_search = (this.$sheets_search.val() || "").toLowerCase().trim();
			this.render_sheets_view();
		});

		this.$sheets_chips = $('<div class="rw-chips">').appendTo($filter_row);
		[["all", __("All")]].concat(RW_SEVERITY_OPTIONS.map((s) => [s, s])).forEach(([key, label]) => {
			const $chip = $(`<button class="rw-chip" data-key="${key}">${label}</button>`).appendTo(this.$sheets_chips);
			if (key === "all") $chip.addClass("active");
			$chip.on("click", () => {
				this.sheets_severity_filter = key;
				this.$sheets_chips.find(".rw-chip").removeClass("active");
				$chip.addClass("active");
				this.render_sheets_view();
			});
		});

		const $view_toggle = $('<div class="rw-view-toggle">').appendTo($filter_row);
		this.$sheets_table_btn = $(`<button class="rw-view-btn">${__("Table")}</button>`).appendTo($view_toggle);
		this.$sheets_cards_btn = $(`<button class="rw-view-btn">${__("Cards")}</button>`).appendTo($view_toggle);
		this.$sheets_table_btn.on("click", () => this.switch_sheets_view("table"));
		this.$sheets_cards_btn.on("click", () => this.switch_sheets_view("cards"));

		this.$sheets_table_wrap = $('<div class="rw-table-wrap">').appendTo(this.$sheets_card);
		this.$sheets_cards_wrap = $('<div class="rw-sheet-cards">').appendTo(this.$sheets_card).hide();
	}

	render_sheets_lock_note() {
		const locked = this.report_doc.status === "Issued";
		this.$sheets_lock_note
			.toggle(locked)
			.text(locked ? __("This report is Issued - sheets are locked. Reopen to Draft to edit them.") : "");
	}

	switch_sheets_view(mode) {
		this.sheets_view_mode = mode;
		const is_cards = mode === "cards";
		this.$sheets_cards_btn.toggleClass("active", is_cards);
		this.$sheets_table_btn.toggleClass("active", !is_cards);
		this.$sheets_cards_wrap.toggle(is_cards);
		this.$sheets_table_wrap.toggle(!is_cards);
	}

	load_sheets() {
		this.render_sheets_lock_note();
		this.$sheets_table_wrap.html(`<div class="rw-empty">${__("Loading...")}</div>`);
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { report: this.report },
					fields: [
						"name",
						"equipment",
						"equipment_description",
						"severity",
						"suggested_severity",
						"action_status",
						"defects",
						"creation",
					],
					order_by: "equipment_description",
					limit_page_length: 0,
				},
			})
			.then((r) => {
				this.sheet_rows = r.message || [];
				this.render_sheets_view();
			});
	}

	get_filtered_sheet_rows() {
		return this.sheet_rows.filter((row) => {
			if (this.sheets_severity_filter !== "all" && row.severity !== this.sheets_severity_filter) return false;
			if (!this.sheets_search) return true;
			const haystack = [row.equipment_description || row.equipment, row.defects, row.severity]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(this.sheets_search);
		});
	}

	render_sheets_view() {
		if (this.sheets_view_mode === "cards") {
			this.render_sheets_cards();
		} else {
			this.render_sheets_table();
		}
	}

	render_sheets_table() {
		const all_rows = this.sheet_rows;
		const rows = this.get_filtered_sheet_rows();
		this.$sheets_table_wrap.empty();
		if (!all_rows.length) {
			this.$sheets_table_wrap.html(
				`<div class="rw-empty">${__('No sheets yet. Use "Create Equipment Sheets" or "New Sheet" to start.')}</div>`
			);
			return;
		}
		if (!rows.length) {
			this.$sheets_table_wrap.html(`<div class="rw-empty">${__("No sheet matches the filter.")}</div>`);
			return;
		}

		const $table = $('<table class="rw-table">').appendTo(this.$sheets_table_wrap);
		$table.append(
			`<thead><tr><th>${__("Equipment")}</th><th>${__("Severity")}</th><th>${__("Suggested")}</th><th>${__(
				"Status"
			)}</th><th>${__("Defects")}</th></tr></thead>`
		);
		const $tbody = $("<tbody>").appendTo($table);
		rows.forEach((row) => {
			const $tr = $("<tr>").appendTo($tbody);
			$("<td>").text(row.equipment_description || row.equipment).appendTo($tr);
			$("<td>").html(row.severity ? rw_badge(row.severity, RW_SEVERITY_HEX[row.severity]) : "").appendTo($tr);
			$("<td>")
				.html(
					row.suggested_severity && row.suggested_severity !== row.severity
						? rw_badge(row.suggested_severity, RW_SEVERITY_HEX[row.suggested_severity])
						: ""
				)
				.appendTo($tr);
			$("<td>").html(row.action_status ? rw_badge(row.action_status, RW_STATUS_HEX[row.action_status]) : "").appendTo($tr);
			$("<td class='rw-ellipsis'>").attr("title", row.defects || "").text(row.defects || "").appendTo($tr);
			$tr.on("click", () => this.open_sheet_dialog(row.name));
		});
	}

	render_sheets_cards() {
		const all_rows = this.sheet_rows;
		const rows = this.get_filtered_sheet_rows();
		this.$sheets_cards_wrap.empty();
		if (!all_rows.length) {
			this.$sheets_cards_wrap.html(
				`<div class="rw-empty">${__('No sheets yet. Use "Create Equipment Sheets" or "New Sheet" to start.')}</div>`
			);
			return;
		}
		if (!rows.length) {
			this.$sheets_cards_wrap.html(`<div class="rw-empty">${__("No sheet matches the filter.")}</div>`);
			return;
		}

		rows.forEach((row) => {
			const $card = $('<div class="rw-sheet-card">').appendTo(this.$sheets_cards_wrap);
			const $row = $('<div class="rw-sheet-card-row">').appendTo($card);

			$row.append(row.severity ? rw_badge(row.severity, RW_SEVERITY_HEX[row.severity]) : rw_badge(__("No readings")));

			const $main = $('<div class="rw-sheet-card-main">').appendTo($row);
			$('<div class="rw-sheet-card-title">').text(row.equipment_description || row.equipment || "").appendTo($main);
			$('<div class="rw-sheet-card-sub">').text(row.defects || "").appendTo($main);

			const $meta = $('<div class="rw-sheet-card-meta">').appendTo($row);
			if (row.action_status) $meta.append(rw_badge(row.action_status, RW_STATUS_HEX[row.action_status]));
			if (row.suggested_severity && row.suggested_severity !== row.severity) {
				$("<span>").text(__("suggestion: {0}", [row.suggested_severity])).appendTo($meta);
			}
			if (row.creation) $("<span>").html(comment_when(row.creation)).appendTo($meta);

			$row.on("click", () => this.open_sheet_dialog(row.name));
		});
	}

	create_all_sheets() {
		this.$bulk_btn.prop("disabled", true).text(__("Creating..."));
		frappe
			.call({ method: "manutencao_preditiva.inspection_api.create_equipment_sheets", args: { report: this.report } })
			.then((r) => {
				const created = r.message || 0;
				frappe.show_alert({
					message: created
						? __("{0} sheets created", [created])
						: __("Every active equipment in this area already has a sheet"),
					indicator: created ? "green" : "blue",
				});
				this.load_sheets();
				this.load_summary();
			})
			.always(() => this.$bulk_btn.prop("disabled", false).text(__("Create Equipment Sheets")));
	}

	// Excludes equipment that already has a sheet in this report - the
	// server would reject it anyway (Equipment Inspection.
	// validate_unique_in_report()), this just avoids the round-trip.
	open_equipment_picker() {
		const doc = this.report_doc;
		const used = new Set(this.sheet_rows.map((row) => row.equipment));

		const dialog = new frappe.ui.Dialog({
			title: __("New Equipment Sheet"),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "equipment",
					label: __("Equipment"),
					options: "Equipment",
					reqd: 1,
					get_query: () => ({
						filters: [
							["customer", "=", doc.customer],
							["area", "=", doc.area],
							["disabled", "=", 0],
							...(used.size ? [["name", "not in", Array.from(used)]] : []),
						],
					}),
				},
			],
			primary_action_label: __("Create Sheet"),
			primary_action: (values) => {
				dialog.get_primary_btn().prop("disabled", true);
				frappe
					.call({
						method: "frappe.client.insert",
						args: { doc: { doctype: "Equipment Inspection", report: this.report, equipment: values.equipment } },
					})
					.then((r) => {
						dialog.hide();
						this.load_sheets();
						this.load_summary();
						this.open_sheet_dialog(r.message.name, r.message);
					})
					.always(() => dialog.get_primary_btn().prop("disabled", false));
			},
		});
		dialog.show();
	}

	// ---- sheet editor: adapted from Quick Finding Entry, see file header ------

	// Points don't change here (they come from the equipment, fixed once the
	// sheet exists) - only the three numbers per point are editable. Reading
	// them back is a matter of walking the rows, so a hand-built grid is a
	// lot less risky than a Table-fieldtype control inside a raw Dialog.
	render_sheet_readings_editor($wrap, readings) {
		$wrap.empty();
		if (!readings || !readings.length) {
			$wrap.html(
				`<p class="text-muted">${__("This equipment has no measurement points configured - add them in Equipment before recording readings.")}</p>`
			);
			return;
		}

		const $table = $('<table class="rw-readings">').appendTo($wrap);
		$table.append(
			`<thead><tr><th>${__("Point")}</th><th>mm/s</th><th>g's</th><th>${__("Temp.")} (°C)</th></tr></thead>`
		);
		const $tbody = $("<tbody>").appendTo($table);

		readings.forEach((row) => {
			const $tr = $("<tr>").attr("data-point", row.point || "").appendTo($tbody);
			$(`<td class="rw-readings-point">`).text(row.point || "").appendTo($tr);
			[
				["velocity_mm_s", "rw-read-velocity"],
				["acceleration_g", "rw-read-acceleration"],
				["temperature_c", "rw-read-temp"],
			].forEach(([fieldname, cls]) => {
				const $input = $(`<input type="number" step="any" class="${cls}">`).val(
					row[fieldname] != null ? row[fieldname] : ""
				);
				$("<td>").append($input).appendTo($tr);
			});
		});
	}

	collect_sheet_readings($wrap) {
		const readings = [];
		$wrap.find("tr[data-point]").each((_, tr) => {
			const $tr = $(tr);
			readings.push({
				point: $tr.attr("data-point"),
				velocity_mm_s: $tr.find(".rw-read-velocity").val() || null,
				acceleration_g: $tr.find(".rw-read-acceleration").val() || null,
				temperature_c: $tr.find(".rw-read-temp").val() || null,
			});
		});
		return readings;
	}

	// Gallery editor: thumbnails with an editable caption under each, a
	// remove button, and an "Add Image" control that appends rather than
	// replacing - so a sheet can carry as many photos as it needs, each
	// with its own description, not just one. `images` is the live array
	// (captions/removals mutate it directly) - the caller keeps its own
	// reference and sends it as-is on save, no separate collection step.
	render_image_gallery($wrap, images) {
		$wrap.empty();
		const $grid = $('<div class="rw-gallery">').appendTo($wrap);

		const redraw = () => {
			$grid.empty();
			images.forEach((img, index) => {
				const $card = $('<div class="rw-gallery-card">').appendTo($grid);
				$(`<img src="${frappe.utils.escape_html(img.image)}">`)
					.on("click", () => window.open(img.image, "_blank"))
					.appendTo($card);
				const $caption = $(
					`<input type="text" class="rw-gallery-caption" placeholder="${__("Caption")}">`
				)
					.val(img.caption || "")
					.appendTo($card);
				$caption.on("input", () => {
					img.caption = $caption.val();
				});
				$(`<button type="button" class="rw-gallery-remove" title="${__("Remove")}">&times;</button>`)
					.appendTo($card)
					.on("click", () => {
						images.splice(index, 1);
						redraw();
					});
			});
		};
		redraw();

		const $add_wrap = $('<div class="rw-gallery-add">').appendTo($wrap);
		const control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Attach Image",
				fieldname: "gallery_add",
				label: __("Add Image"),
				onchange: () => {
					const url = control.get_value();
					if (!url) return;
					images.push({ image: url, caption: "" });
					control.set_value("");
					redraw();
				},
			},
			parent: $add_wrap[0],
			render_input: true,
		});
		control.refresh();
	}

	get_sheet_dialog_fields(data) {
		const suggested = data.suggested_severity;
		const overridden = !!(data.severity && data.severity !== suggested);

		return [
			{ fieldtype: "HTML", fieldname: "equipment_display", options: "" },
			{ fieldtype: "Section Break", label: __("Readings") },
			{ fieldtype: "HTML", fieldname: "readings_html", options: "" },
			{
				fieldtype: "HTML",
				fieldname: "suggested_note",
				options: `<div class="rw-suggested-note">${__("Severity suggested by the readings")}: <b>${
					suggested || "—"
				}</b> (${__("recalculated on save")})</div>`,
			},
			{ fieldtype: "Percent", fieldname: "tolerance_percent", label: __("Tolerance (%)") },
			{ fieldtype: "Section Break", label: __("Diagnosis") },
			{ fieldtype: "Small Text", fieldname: "defects", label: __("Defects Found") },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Small Text", fieldname: "recommendations", label: __("Recommendations") },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Small Text", fieldname: "follow_up", label: __("Actions Taken / Follow-up") },
			{ fieldtype: "Section Break" },
			{
				fieldtype: "Check",
				fieldname: "override_severity",
				label: __("Override suggested severity"),
				default: overridden ? 1 : 0,
				description: __(
					"Leave unchecked for severity to follow the readings automatically. Use this when the diagnosis (e.g. a bearing defect seen in the spectrum) is worse than the readings alone indicate."
				),
			},
			{
				fieldtype: "Select",
				fieldname: "severity",
				label: __("Severity"),
				options: RW_SEVERITY_OPTIONS.join("\n"),
				depends_on: "eval:doc.override_severity",
				mandatory_depends_on: "eval:doc.override_severity",
			},
			{ fieldtype: "Section Break", label: __("Images") },
			{ fieldtype: "HTML", fieldname: "images_html", options: "" },
		];
	}

	// name + optional preloaded_data (the doc just came back from an insert,
	// so there's no reason to fetch it again) - opens the sheet editor.
	open_sheet_dialog(name, preloaded_data) {
		const show_dialog = (data) => {
			// Own copy, stripped to the two business fields - see save_sheet()
			// for why a fetched child row's own name/idx/parent metadata isn't
			// carried forward as-is. Mutated in place by the gallery editor.
			const images = (data.images || []).map((img) => ({ image: img.image, caption: img.caption || "" }));

			const dialog = new frappe.ui.Dialog({
				title: __("Equipment Sheet {0}", [data.name]),
				size: "large",
				fields: this.get_sheet_dialog_fields(data),
				primary_action_label: __("Save"),
				primary_action: (values) => this.save_sheet(dialog, data, values, images),
			});

			dialog.fields_dict.equipment_display.$wrapper.html(
				`<div class="rw-report-meta"><span>${__("Equipment")}: <b>${frappe.utils.escape_html(
					data.equipment_description || data.equipment
				)}</b></span><span><a href="#" class="rw-open-full-form">${__("Open Full Form")}</a></span></div>`
			);
			dialog.$wrapper.find(".rw-open-full-form").on("click", (e) => {
				e.preventDefault();
				dialog.hide();
				frappe.set_route("Form", "Equipment Inspection", data.name);
			});

			this.render_sheet_readings_editor(dialog.fields_dict.readings_html.$wrapper, data.readings || []);
			this.render_image_gallery(dialog.fields_dict.images_html.$wrapper, images);

			dialog.set_values({
				tolerance_percent: data.tolerance_percent || 0,
				defects: data.defects,
				recommendations: data.recommendations,
				follow_up: data.follow_up,
				severity: data.severity || "",
			});

			dialog.show();
		};

		if (preloaded_data) {
			show_dialog(preloaded_data);
			return;
		}

		frappe.dom.freeze(__("Opening sheet..."));
		frappe
			.call({ method: "frappe.client.get", args: { doctype: "Equipment Inspection", name } })
			.then((r) => show_dialog(r.message))
			.always(() => frappe.dom.unfreeze());
	}

	save_sheet(dialog, data, values, images) {
		dialog.get_primary_btn().prop("disabled", true);

		const readings = this.collect_sheet_readings(dialog.fields_dict.readings_html.$wrapper);
		const update = {
			readings,
			images,
			tolerance_percent: values.tolerance_percent || 0,
			defects: values.defects,
			recommendations: values.recommendations,
			follow_up: values.follow_up,
		};
		if (values.override_severity && values.severity) update.severity = values.severity;

		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Equipment Inspection", name: data.name, fieldname: update },
			})
			.then(() => {
				frappe.show_alert({ message: __("Sheet {0} saved", [data.name]), indicator: "green" });
				dialog.hide();
				this.load_sheets();
				this.load_summary();
			})
			.always(() => dialog.get_primary_btn().prop("disabled", false));
	}
};
