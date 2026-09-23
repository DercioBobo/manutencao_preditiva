// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt
//
// Creates/edits Equipment Inspection sheets (Inspection Report system)
// instead of the old Achado De Inspecao. All UI text is English, matching
// the stored severity/action-status values directly.
//
// The old page let a técnico log several separate free-form "findings" for
// the same equipment within one campanha. The new model has exactly one
// sheet per equipment per report (its readings table holds everything for
// that equipment), so "New Finding" here means "start this equipment's
// sheet", and editing means filling in its readings/diagnosis - not adding
// another entry. A report also covers exactly one area (fixed on the
// report, not chosen per sheet, unlike the old area_planta), so a técnico
// covering more than one area in a visit now needs one Inspection Report
// per area rather than one Campanha for the whole round.
//
// Severity is suggested from the readings (server-side, vibration.py) - it
// is NOT a field this quick tool asks for directly. An "override" checkbox
// exposes it for the bearing-defect-type judgement calls the old page had
// no equivalent for; leaving it unchecked defers to the suggestion, same as
// opening the full Equipment Inspection form and touching nothing.
//
// The page route ("/app/registo-rapido-de-achados") and this file's own
// module name (manutencao_preditiva.RegistoRapidoDeAchados) are left as
// they are - see meus_achados.js's header comment for why.

frappe.provide("manutencao_preditiva");

frappe.pages["registo-rapido-de-achados"].on_page_load = function (wrapper) {
	wrapper.rra = new manutencao_preditiva.RegistoRapidoDeAchados(wrapper);
};

frappe.pages["registo-rapido-de-achados"].on_page_show = function (wrapper) {
	wrapper.rra && wrapper.rra.load_saved();
};

const RRA_PAGE_SIZE = 50;

// Worst-first, matching Meus Achados.
const RRA_SEVERITY_OPTIONS = ["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"];
const RRA_STATUS_OPTIONS = ["Open", "In Progress", "Done", "Not Applicable"];

// Same CSS classes/colors the page already had.
const RRA_BADGE_CLASS = {
	Critical: "rra-badge-critico",
	Alarm: "rra-badge-alarme",
	Acceptable: "rra-badge-aceitavel",
	Normal: "rra-badge-boa-condicao",
	"Not Collected": "rra-badge-nao-recolhido",
};

const RRA_STATUS_BADGE_CLASS = {
	Open: "rra-badge-pendente",
	"In Progress": "rra-badge-em-curso",
	Done: "rra-badge-concluido",
	"Not Applicable": "rra-badge-na",
};

manutencao_preditiva.RegistoRapidoDeAchados = class RegistoRapidoDeAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.report_info = null;
		this.saved_entries = [];
		this.saved_offset = 0;
		this.saved_has_more = false;
		this.active_severity = "all";
		this.search_term = "";

		this.table_rows = null;
		this.table_sort = { field: "creation", dir: "desc" };
		this.table_filters = { equipment: "", severity: "", status: "" };

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Quick Finding Entry"),
			single_column: true,
		});

		this.render_shell();
	}

	render_shell() {
		this.$container = $('<div class="rra">').appendTo(this.page.body);
		this.render_toolbar();

		this.render_view_toggle();

		this.$card_view = $("<div>").appendTo(this.$container);
		this.$summary = $('<div class="rra-summary">').appendTo(this.$card_view);
		this.render_filters();
		this.$list = $('<div class="rra-list">').appendTo(this.$card_view);
		this.$load_more_wrap = $('<div class="rra-load-more">').appendTo(this.$card_view).hide();
		this.$load_more_btn = $(`<button class="rra-btn rra-btn-ghost">${__("Load more")}</button>`).appendTo(
			this.$load_more_wrap
		);
		this.$load_more_btn.on("click", () => this.load_saved(true));
		this.refresh_list();

		this.render_table_shell();

		// Table first, cards second - switch_view() is the single source of
		// truth for initial visibility/active-state too, so there's no
		// separate "default state" to keep in sync with the toggle logic.
		this.switch_view("table");
	}

	// ---- view toggle: cards / table -----------------------------------------

	render_view_toggle() {
		const $toggle = $('<div class="rra-view-toggle">').appendTo(this.$container);
		this.$view_table_btn = $(`<button class="rra-view-btn">${__("Table")}</button>`).appendTo($toggle);
		this.$view_cards_btn = $(`<button class="rra-view-btn">${__("Cards")}</button>`).appendTo($toggle);
		this.$view_cards_btn.on("click", () => this.switch_view("cards"));
		this.$view_table_btn.on("click", () => this.switch_view("table"));
	}

	switch_view(mode) {
		this.view_mode = mode;
		const is_cards = mode === "cards";
		this.$view_cards_btn.toggleClass("active", is_cards);
		this.$view_table_btn.toggleClass("active", !is_cards);
		this.$card_view.toggle(is_cards);
		this.$table_view.toggle(!is_cards);
		if (!is_cards && !this.table_rows) this.load_table_data();
	}

	// ---- toolbar: report + "new finding" / bulk create -----------------------

	render_toolbar() {
		const $toolbar = $('<div class="rra-toolbar">').appendTo(this.$container);
		const $fields = $('<div class="rra-toolbar-fields">').appendTo($toolbar);

		const $report_wrap = $('<div class="rra-field">').appendTo($fields);
		this.report_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "report",
				label: __("Report"),
				options: "Inspection Report",
				reqd: 1,
				get_query: () => ({ filters: { status: "Draft" } }),
				onchange: () => this.on_report_change(),
			},
			parent: $report_wrap[0],
			render_input: true,
		});
		this.report_control.refresh();

		this.$report_info = $('<div class="rra-campanha-info">').appendTo($fields);

		const $actions = $('<div class="rra-toolbar-actions">').appendTo($toolbar);
		this.$bulk_btn = $(`<button class="rra-btn rra-btn-ghost" disabled>${__("Create Equipment Sheets")}</button>`).appendTo(
			$actions
		);
		this.$bulk_btn.on("click", () => this.create_all_sheets());

		this.$add_btn = $(`
			<button class="rra-btn rra-btn-primary" disabled>
				<span class="rra-icon-plus"></span><span>${__("New Finding")}</span>
			</button>
		`).appendTo($actions);
		this.$add_btn.on("click", () => this.open_finding_dialog({ mode: "new" }));
	}

	on_report_change() {
		const report = this.report_control.get_value();
		this.table_rows = null; // scoped per-report - stale once the selection changes

		if (!report) {
			this.report_info = null;
			this.$report_info.empty();
			this.$add_btn.prop("disabled", true);
			this.$bulk_btn.prop("disabled", true);
			this.saved_entries = [];
			this.refresh_list();
			if (this.view_mode === "table") this.load_table_data();
			return;
		}

		Promise.all([
			frappe.db.get_value("Inspection Report", report, ["customer", "area", "technique"]),
			frappe.db.get_value("Inspection Report", report, "area").then((r) => {
				const area = r.message && r.message.area;
				return area ? frappe.db.get_value("Inspection Area", area, "area_name") : Promise.resolve({ message: {} });
			}),
		]).then(([report_r, area_r]) => {
			this.report_info = report_r.message;
			this.report_info.area_name = (area_r.message && area_r.message.area_name) || this.report_info.area;

			this.$report_info.html(
				`${__("Customer")}: <b>${frappe.utils.escape_html(this.report_info.customer || "")}</b>` +
					`&nbsp;&middot;&nbsp;${__("Area")}: <b>${frappe.utils.escape_html(this.report_info.area_name || "")}</b>` +
					`&nbsp;&middot;&nbsp;${__("Technique")}: <b>${frappe.utils.escape_html(this.report_info.technique || "")}</b>`
			);
			this.$add_btn.prop("disabled", false);
			this.$bulk_btn.prop("disabled", false);
			if (this.view_mode === "table") this.load_table_data();
			this.load_saved();
		});
	}

	create_all_sheets() {
		const report = this.report_control.get_value();
		if (!report) return;

		this.$bulk_btn.prop("disabled", true).text(__("Creating..."));
		frappe
			.call({ method: "manutencao_preditiva.inspection_api.create_equipment_sheets", args: { report } })
			.then((r) => {
				const created = r.message || 0;
				frappe.show_alert({
					message: created
						? __("{0} sheets created", [created])
						: __("Every active equipment in this area already has a sheet"),
					indicator: created ? "green" : "blue",
				});
				this.load_saved();
				if (this.table_rows) this.load_table_data();
			})
			.always(() => {
				this.$bulk_btn.prop("disabled", false).text(__("Create Equipment Sheets"));
			});
	}

	// ---- filters: search + severity chips -----------------------------------

	render_filters() {
		this.$filters = $('<div class="rra-filters">').appendTo(this.$card_view);

		this.$search = $(
			`<input type="text" class="rra-search" placeholder="${__("Search by equipment, description...")}">`
		).appendTo(this.$filters);
		this.$search.on("input", () => {
			this.search_term = (this.$search.val() || "").toLowerCase().trim();
			this.apply_filters();
		});

		this.$chips = $('<div class="rra-chips">').appendTo(this.$filters);
		const chip_defs = [["all", __("All")]].concat(RRA_SEVERITY_OPTIONS.map((s) => [s, s]));
		chip_defs.forEach(([key, label]) => {
			const $chip = $(`<button class="rra-chip" data-key="${frappe.utils.escape_html(key)}">${label}</button>`).appendTo(
				this.$chips
			);
			if (key === "all") $chip.addClass("active");
			$chip.on("click", () => {
				this.active_severity = key;
				this.$chips.find(".rra-chip").removeClass("active");
				$chip.addClass("active");
				this.apply_filters();
			});
		});
	}

	apply_filters() {
		let visible = 0;
		this.saved_entries.forEach((entry) => {
			const row = entry.data;
			const matches_severity = this.active_severity === "all" || row.severity === this.active_severity;
			const haystack = [row.equipment_description || row.equipment, row.defects, row.severity]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			const matches_search = !this.search_term || haystack.includes(this.search_term);
			const show = matches_severity && matches_search;
			entry.$card.toggle(show);
			if (show) visible++;
		});
		this.$empty_filtered && this.$empty_filtered.remove();
		if (this.saved_entries.length && visible === 0) {
			this.$empty_filtered = $(`<div class="rra-empty">${__("No finding matches the filter.")}</div>`).appendTo(
				this.$list
			);
		}
	}

	// ---- summary bar ----------------------------------------------------------

	render_summary_bar() {
		if (!this.saved_entries.length) {
			this.$summary.empty();
			return;
		}
		const counts = {};
		this.saved_entries.forEach((entry) => {
			const sev = entry.data.severity;
			if (sev) counts[sev] = (counts[sev] || 0) + 1;
		});

		const parts = [`<span class="rra-summary-total">${this.saved_entries.length} ${__("findings")}</span>`];
		RRA_SEVERITY_OPTIONS.forEach((sev) => {
			if (counts[sev]) {
				parts.push(`<span class="rra-badge ${RRA_BADGE_CLASS[sev]}">${counts[sev]} ${sev}</span>`);
			}
		});
		this.$summary.html(parts.join(""));
	}

	// ---- list of saved entries ---------------------------------------------

	refresh_list() {
		this.$list.empty();
		this.render_summary_bar();

		if (!this.saved_entries.length) {
			const msg = this.report_info
				? __('No sheets yet. Click "New Finding" or "Create Equipment Sheets" to start.')
				: __("Select a report to start logging findings.");
			this.$list.html(`<div class="rra-empty">${msg}</div>`);
			this.$filters.toggle(false);
			this.$load_more_wrap.hide();
			return;
		}

		this.$filters.toggle(true);
		this.saved_entries.forEach((entry) => this.$list.append(entry.$card));
		this.apply_filters();
		this.$load_more_wrap.toggle(this.saved_has_more);
	}

	load_saved(append) {
		const report = this.report_control.get_value();
		if (!report) {
			this.saved_entries = [];
			this.saved_offset = 0;
			this.saved_has_more = false;
			this.refresh_list();
			return;
		}
		if (!append) this.saved_offset = 0;

		this.$load_more_btn.prop("disabled", true).text(__("Loading..."));

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { report },
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
					order_by: "creation desc",
					limit_start: this.saved_offset,
					limit_page_length: RRA_PAGE_SIZE,
				},
			})
			.then((r) => {
				const rows = r.message || [];
				const new_entries = rows.map((row) => ({ data: row }));
				new_entries.forEach((entry) => {
					entry.$card = this.build_view_card(entry);
				});

				this.saved_entries = append ? this.saved_entries.concat(new_entries) : new_entries;
				this.saved_offset += rows.length;
				this.saved_has_more = rows.length === RRA_PAGE_SIZE;
				this.refresh_list();
			})
			.always(() => {
				this.$load_more_btn.prop("disabled", false).text(__("Load more"));
			});
	}

	// ---- saved (summary) card ------------------------------------------------

	build_view_card(entry) {
		const row = entry.data;
		const badge_class = RRA_BADGE_CLASS[row.severity] || "rra-badge-nao-recolhido";
		const $card = $('<div class="rra-card">');
		const $row = $('<div class="rra-saved-row">').appendTo($card);

		$(`<span class="rra-badge ${badge_class}">`).text(row.severity || __("No readings")).appendTo($row);

		const $main = $('<div class="rra-saved-main">').appendTo($row);
		$('<div class="rra-saved-title">').text(row.equipment_description || row.equipment || "").appendTo($main);
		$('<div class="rra-saved-sub">').text(row.defects || "").appendTo($main);

		const $meta = $('<div class="rra-saved-meta">').appendTo($row);
		if (row.action_status) {
			$(`<span class="rra-badge ${RRA_STATUS_BADGE_CLASS[row.action_status]}">`).text(row.action_status).appendTo($meta);
		}
		if (row.suggested_severity && row.suggested_severity !== row.severity) {
			$("<span>").text(__("suggestion: {0}", [row.suggested_severity])).appendTo($meta);
		}
		$("<span>").html(comment_when(row.creation)).appendTo($meta);

		$row.on("click", () => this.open_finding_dialog({ mode: "edit", name: row.name }));

		return $card;
	}

	// ---- table view: sortable columns + per-column filters --------------------
	// Scoped to the currently selected report, same as the card list. No Area
	// column - every sheet in a report shares the same area (see the file
	// header note), so it would just repeat the toolbar's info line.

	get_table_columns() {
		return [
			{
				field: "severity",
				label: __("Severity"),
				sortable: true,
				filter: "select",
				filterKey: "severity",
				options: RRA_SEVERITY_OPTIONS,
			},
			{ field: "equipment_description", label: __("Equipment"), sortable: true, filter: "text", filterKey: "equipment" },
			{
				field: "action_status",
				label: __("Status"),
				sortable: true,
				filter: "select",
				filterKey: "status",
				options: RRA_STATUS_OPTIONS,
			},
			{ field: "defects", label: __("Defects Found") },
			{ field: "creation", label: __("When"), sortable: true },
		];
	}

	render_table_shell() {
		this.$table_view = $('<div class="rra-table-wrap">').appendTo(this.$container).hide();
		this.$table_view.html(`<div class="rra-empty">${__("Select a report to see the table.")}</div>`);
	}

	load_table_data() {
		const report = this.report_control.get_value();
		if (!report) {
			this.table_rows = null;
			this.$table_view.html(`<div class="rra-empty">${__("Select a report to see the table.")}</div>`);
			return;
		}

		this.$table_view.html(`<div class="rra-empty">${__("Loading...")}</div>`);

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { report },
					fields: ["name", "equipment", "equipment_description", "severity", "action_status", "defects", "creation"],
					order_by: "creation desc",
					limit_page_length: 0,
				},
			})
			.then((r) => {
				this.table_rows = r.message || [];
				this.build_table();
			});
	}

	build_table() {
		const columns = this.get_table_columns();
		this.$table_view.empty();

		const $table = $('<table class="rra-table">').appendTo(this.$table_view);
		const $thead = $("<thead>").appendTo($table);

		const $header_row = $("<tr>").appendTo($thead);
		columns.forEach((col) => {
			const $th = $("<th>").attr("data-field", col.field).appendTo($header_row);
			$("<span>").text(col.label).appendTo($th);
			if (col.sortable) {
				$th.addClass("rra-th-sortable");
				$('<span class="rra-sort-arrow">').appendTo($th);
				$th.on("click", () => this.toggle_table_sort(col.field));
			}
		});

		const $filter_row = $('<tr class="rra-table-filter-row">').appendTo($thead);
		columns.forEach((col) => {
			const $td = $("<th>").appendTo($filter_row);
			if (col.filter === "text") {
				const $input = $(`<input type="text" class="rra-table-filter-input" placeholder="${__("Filter...")}">`).appendTo(
					$td
				);
				$input.val(this.table_filters[col.filterKey] || "");
				$input.on("input", () => {
					this.table_filters[col.filterKey] = $input.val();
					this.render_table_rows();
				});
			} else if (col.filter === "select") {
				const $select = $('<select class="rra-table-filter-input">').appendTo($td);
				$(`<option value="">${__("All")}</option>`).appendTo($select);
				col.options.forEach((o) => $(`<option value="${o}">${o}</option>`).appendTo($select));
				$select.val(this.table_filters[col.filterKey] || "");
				$select.on("change", () => {
					this.table_filters[col.filterKey] = $select.val();
					this.render_table_rows();
				});
			}
		});

		this.$table_tbody = $("<tbody>").appendTo($table);
		this.render_table_rows();
		this.update_sort_indicators();
	}

	get_table_sort_value(row, field) {
		if (field === "severity") return RRA_SEVERITY_OPTIONS.indexOf(row.severity);
		if (field === "action_status") return RRA_STATUS_OPTIONS.indexOf(row.action_status || "Open");
		return (row[field] || "").toString().toLowerCase();
	}

	toggle_table_sort(field) {
		if (this.table_sort.field === field) {
			this.table_sort.dir = this.table_sort.dir === "asc" ? "desc" : "asc";
		} else {
			this.table_sort = { field, dir: "asc" };
		}
		this.render_table_rows();
		this.update_sort_indicators();
	}

	update_sort_indicators() {
		this.$table_view.find(".rra-th-sortable").each((_, el) => {
			const $th = $(el);
			const is_active = $th.attr("data-field") === this.table_sort.field;
			$th.find(".rra-sort-arrow").text(is_active ? (this.table_sort.dir === "asc" ? " ▲" : " ▼") : "");
		});
	}

	render_table_rows() {
		const columns = this.get_table_columns();
		let rows = (this.table_rows || []).filter((row) => {
			if (this.table_filters.equipment) {
				const v = (row.equipment_description || row.equipment || "").toLowerCase();
				if (!v.includes(this.table_filters.equipment.toLowerCase())) return false;
			}
			if (this.table_filters.severity && row.severity !== this.table_filters.severity) return false;
			if (this.table_filters.status && (row.action_status || "Open") !== this.table_filters.status) return false;
			return true;
		});

		const { field, dir } = this.table_sort;
		rows = rows.slice().sort((a, b) => {
			const va = this.get_table_sort_value(a, field);
			const vb = this.get_table_sort_value(b, field);
			if (va < vb) return dir === "asc" ? -1 : 1;
			if (va > vb) return dir === "asc" ? 1 : -1;
			return 0;
		});

		this.$table_tbody.empty();

		if (!rows.length) {
			const $empty_row = $("<tr>").appendTo(this.$table_tbody);
			$(`<td colspan="${columns.length}">`)
				.html(`<div class="rra-empty">${__("No finding matches the filter.")}</div>`)
				.appendTo($empty_row);
			return;
		}

		rows.forEach((row) => {
			const $tr = $("<tr>").appendTo(this.$table_tbody);
			columns.forEach((col) => {
				const $td = $("<td>").appendTo($tr);
				if (col.field === "severity") {
					const cls = RRA_BADGE_CLASS[row.severity] || "rra-badge-nao-recolhido";
					$(`<span class="rra-badge ${cls}">`).text(row.severity || "").appendTo($td);
				} else if (col.field === "action_status") {
					const status = row.action_status || __("Open");
					const cls = RRA_STATUS_BADGE_CLASS[row.action_status] || "rra-badge-pendente";
					$(`<span class="rra-badge ${cls}">`).text(status).appendTo($td);
				} else if (col.field === "creation") {
					$td.html(comment_when(row.creation));
				} else {
					$td.text(row[col.field] || "").attr("title", row[col.field] || "");
				}
			});
			$tr.on("click", () => this.open_finding_dialog({ mode: "edit", name: row.name }));
		});
	}

	// ---- readings editor: plain inputs, not a Table field ----------------------
	// Points don't change here (they come from the equipment, fixed once the
	// sheet exists) - only the three numbers per point are editable. Reading
	// them back is a matter of walking the rows, so a hand-built grid is a
	// lot less risky than a Table-fieldtype control inside a raw Dialog.

	render_readings_editor($wrap, readings) {
		$wrap.empty();
		if (!readings || !readings.length) {
			$wrap.html(
				`<p class="text-muted">${__("This equipment has no measurement points configured - add them in Inspection Equipment before recording readings.")}</p>`
			);
			return;
		}

		const $table = $('<table class="rra-readings">').appendTo($wrap);
		$table.append(
			`<thead><tr><th>${__("Point")}</th><th>mm/s</th><th>g's</th><th>${__("Temp.")} (°C)</th></tr></thead>`
		);
		const $tbody = $("<tbody>").appendTo($table);

		readings.forEach((row) => {
			const $tr = $("<tr>").attr("data-point", row.point || "").appendTo($tbody);
			$(`<td class="rra-readings-point">`).text(row.point || "").appendTo($tr);
			[
				["velocity_mm_s", "rra-read-velocity"],
				["acceleration_g", "rra-read-acceleration"],
				["temperature_c", "rra-read-temp"],
			].forEach(([fieldname, cls]) => {
				const $input = $(`<input type="number" step="any" class="${cls}">`).val(row[fieldname] != null ? row[fieldname] : "");
				$("<td>").append($input).appendTo($tr);
			});
		});
	}

	collect_readings($wrap) {
		const readings = [];
		$wrap.find("tr[data-point]").each((_, tr) => {
			const $tr = $(tr);
			readings.push({
				point: $tr.attr("data-point"),
				velocity_mm_s: $tr.find(".rra-read-velocity").val() || null,
				acceleration_g: $tr.find(".rra-read-acceleration").val() || null,
				temperature_c: $tr.find(".rra-read-temp").val() || null,
			});
		});
		return readings;
	}

	// ---- create / edit dialog ------------------------------------------------

	get_dialog_fields(data) {
		const suggested = data && data.suggested_severity;
		const overridden = !!(data && data.severity && data.severity !== suggested);

		return [
			{ fieldtype: "HTML", fieldname: "equipment_display", options: "" },
			{ fieldtype: "Section Break", label: __("Readings") },
			{ fieldtype: "HTML", fieldname: "readings_html", options: "" },
			{
				fieldtype: "HTML",
				fieldname: "suggested_note",
				options: `<div class="rra-suggested-note">${__("Severity suggested by the readings")}: <b>${
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
				options: RRA_SEVERITY_OPTIONS.join("\n"),
				depends_on: "eval:doc.override_severity",
				mandatory_depends_on: "eval:doc.override_severity",
			},
			{ fieldtype: "Section Break", label: __("Image") },
			{ fieldtype: "Attach Image", fieldname: "new_image", label: __("Add Image") },
		];
	}

	open_finding_dialog({ mode, name }) {
		const is_new = mode === "new";

		const show_dialog = (data) => {
			const dialog = new frappe.ui.Dialog({
				title: is_new ? __("New Finding") : __("Edit Finding {0}", [name]),
				size: "large",
				fields: this.get_dialog_fields(data),
				primary_action_label: __("Save"),
				primary_action: (values) => this.save_finding(dialog, data, values),
			});

			dialog.fields_dict.equipment_display.$wrapper.html(
				`<div class="rra-campanha-info">${__("Equipment")}: <b>${frappe.utils.escape_html(
					data.equipment_description || data.equipment
				)}</b></div>`
			);
			this.render_readings_editor(dialog.fields_dict.readings_html.$wrapper, data.readings || []);

			dialog.set_values({
				tolerance_percent: data.tolerance_percent || 0,
				defects: data.defects,
				recommendations: data.recommendations,
				follow_up: data.follow_up,
				severity: data.severity || "",
			});

			dialog.show();
		};

		if (is_new) {
			this.open_equipment_picker(show_dialog);
		} else {
			// Fetching the full doc takes a couple hundred ms - freeze so the
			// click gets instant feedback and a second click (no visible
			// reaction otherwise) can't fire a duplicate fetch/dialog.
			frappe.dom.freeze(__("Opening finding..."));
			frappe
				.call({ method: "frappe.client.get", args: { doctype: "Equipment Inspection", name } })
				.then((r) => show_dialog(r.message))
				.always(() => {
					frappe.dom.unfreeze();
				});
		}
	}

	// Picking the equipment creates the sheet immediately (the server fills
	// its readings rows from the equipment's measurement points) and then
	// opens it straight into editing - an empty sheet with no readings isn't
	// useful on its own, so there is no separate "just create it" step.
	open_equipment_picker(on_created) {
		const used = new Set(this.saved_entries.map((e) => e.data.equipment));

		const dialog = new frappe.ui.Dialog({
			title: __("New Finding"),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "equipment",
					label: __("Equipment"),
					options: "Inspection Equipment",
					reqd: 1,
					get_query: () => ({
						filters: [
							["customer", "=", this.report_info ? this.report_info.customer : ""],
							["area", "=", this.report_info ? this.report_info.area : ""],
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
						args: {
							doc: { doctype: "Equipment Inspection", report: this.report_control.get_value(), equipment: values.equipment },
						},
					})
					.then((r) => {
						dialog.hide();
						const entry = { data: r.message };
						entry.$card = this.build_view_card(entry);
						this.saved_entries.unshift(entry);
						this.refresh_list();
						if (this.table_rows) this.load_table_data();
						on_created(r.message);
					})
					.always(() => {
						dialog.get_primary_btn().prop("disabled", false);
					});
			},
		});
		dialog.show();
	}

	save_finding(dialog, data, values) {
		dialog.get_primary_btn().prop("disabled", true);

		const readings = this.collect_readings(dialog.fields_dict.readings_html.$wrapper);
		const update = {
			readings,
			tolerance_percent: values.tolerance_percent || 0,
			defects: values.defects,
			recommendations: values.recommendations,
			follow_up: values.follow_up,
		};
		if (values.override_severity && values.severity) update.severity = values.severity;
		if (values.new_image) {
			// Only the business fields - re-sending a fetched child row's own
			// "name"/idx/parent metadata as-is risks Frappe treating it as an
			// update to that specific row instead of a fresh one; stripped
			// down to plain data, every row here is unambiguously a new one.
			const existing_images = (data.images || []).map((img) => ({ image: img.image, caption: img.caption || "" }));
			update.images = existing_images.concat([{ image: values.new_image }]);
		}

		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Equipment Inspection", name: data.name, fieldname: update },
			})
			.then((r) => {
				frappe.show_alert({ message: __("Finding {0} saved", [data.name]), indicator: "green" });
				dialog.hide();

				const entry = this.saved_entries.find((e) => e.data.name === data.name);
				if (entry) {
					entry.data = Object.assign({}, entry.data, {
						severity: r.message.severity,
						suggested_severity: r.message.suggested_severity,
						defects: r.message.defects,
					});
					const $old_card = entry.$card;
					entry.$card = this.build_view_card(entry);
					$old_card.replaceWith(entry.$card);
					this.apply_filters();
					this.render_summary_bar();
				} else {
					this.load_saved();
				}
				if (this.table_rows) this.load_table_data();
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
