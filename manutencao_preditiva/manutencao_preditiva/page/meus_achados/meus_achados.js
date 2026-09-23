// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt
//
// Reads Equipment Inspection sheets (Inspection Report system) instead of
// the old Achado De Inspecao. All UI text is English, matching the stored
// severity/action-status values directly (Critical/Alarm/Acceptable/
// Normal/Not Collected, Open/In Progress/Done/Not Applicable) - no
// display-label translation layer needed.
//
// The page route ("/app/meus-achados") and this file's own module name
// (manutencao_preditiva.MeusAchados) are left as they are: renaming those
// would touch cliente_portal_redirect.js, the workspace link and anyone's
// existing bookmark, for no visible benefit (nobody reads a route).
//
// A client only ever sees a sheet once its Inspection Report is Issued -
// enforced server-side in manutencao_preditiva/permissions.py, not here.

frappe.provide("manutencao_preditiva");

frappe.pages["meus-achados"].on_page_load = function (wrapper) {
	wrapper.ma = new manutencao_preditiva.MeusAchados(wrapper);
};

frappe.pages["meus-achados"].on_page_show = function (wrapper) {
	if (!wrapper.ma) return;
	wrapper.ma.load_entries();
	wrapper.ma.load_dashboard();
	if (wrapper.ma.table_rows) wrapper.ma.load_table_data();
};

const MA_PAGE_SIZE = 50;

// Worst-first, matching the order clients want to triage in.
const MA_SEVERITY_OPTIONS = ["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"];
const MA_STATUS_OPTIONS = ["Open", "In Progress", "Done", "Not Applicable"];

const MA_SEVERITY_BADGE = {
	Critical: "ma-badge-critico",
	Alarm: "ma-badge-alarme",
	Acceptable: "ma-badge-aceitavel",
	Normal: "ma-badge-boa-condicao",
	"Not Collected": "ma-badge-nao-recolhido",
};

const MA_STATUS_BADGE = {
	Open: "ma-badge-pendente",
	"In Progress": "ma-badge-em-curso",
	Done: "ma-badge-concluido",
	"Not Applicable": "ma-badge-na",
};

// Same hex values as the CSS custom properties above - frappe.Chart needs
// literal colors, it can't read CSS variables. Kept identical to the badge
// colors on purpose: severity/status already have an established meaning
// in this app (the card badges), so the charts reuse it rather than a
// fresh categorical palette.
const MA_SEVERITY_HEX = {
	Critical: "#c4453a",
	Alarm: "#d99226",
	Acceptable: "#b8a021",
	Normal: "#3a9d5b",
	"Not Collected": "#6b7680",
};

const MA_STATUS_HEX = {
	Open: "#d99226",
	"In Progress": "#2b6cb0",
	Done: "#3a9d5b",
	"Not Applicable": "#6b7680",
};

function hex_to_rgba(hex, alpha) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

manutencao_preditiva.MeusAchados = class MeusAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.entries = [];
		this.offset = 0;
		this.has_more = false;
		// Findings tab (cards + table): finding/editing a specific record.
		this.active_status = "all";
		this.severity_filter = "";
		this.search_term = "";

		// Dashboard tab: monitoring KPIs - deliberately a SEPARATE filter
		// state, not tied to whatever the Findings tab happens to be
		// filtered to.
		this.dashboard_active_status = "all";
		this.dashboard_severity_filter = "";
		this.dashboard_area_filter = "";
		this.dashboard_equipment_filter = "";
		this.dashboard_date_from = "";
		this.dashboard_date_to = "";

		this.table_rows = null;
		this.table_sort = { field: "creation", dir: "desc" };
		this.table_filters = { equipment: "", area: "" };

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("My Findings"),
			single_column: true,
		});

		this.render_shell();
	}

	render_shell() {
		this.$container = $('<div class="ma">').appendTo(this.page.body);
		$(`<div class="ma-intro">${__(
			"Findings logged during inspections carried out at your site. Click a finding to see the details and record your response."
		)}</div>`).appendTo(this.$container);

		this.render_tabs();

		this.$tab_dashboard_content = $('<div class="ma-tab-content">').appendTo(this.$container);
		this.$tab_findings_content = $('<div class="ma-tab-content">').appendTo(this.$container).hide();

		this.render_dashboard_shell(this.$tab_dashboard_content);

		this.render_findings_filters(this.$tab_findings_content);
		this.render_view_toggle(this.$tab_findings_content);

		this.$card_view = $('<div>').appendTo(this.$tab_findings_content);
		this.$summary = $('<div class="ma-summary">').appendTo(this.$card_view);
		this.render_filters(this.$card_view);
		this.$list = $('<div class="ma-list">').appendTo(this.$card_view);
		this.$load_more_wrap = $('<div class="ma-load-more">').appendTo(this.$card_view).hide();
		this.$load_more_btn = $(`<button class="ma-btn">${__("Load more")}</button>`).appendTo(this.$load_more_wrap);
		this.$load_more_btn.on("click", () => this.load_entries(true));

		this.render_table_shell(this.$tab_findings_content);

		// Table first, cards second - switch_view() is the single source of
		// truth for initial visibility/active-state too, so there's no
		// separate "default state" to keep in sync with the toggle logic.
		this.switch_view("table");
	}

	// ---- view toggle: cards / table -----------------------------------------

	render_view_toggle($parent) {
		const $toggle = $('<div class="ma-view-toggle">').appendTo($parent);
		this.$view_table_btn = $(`<button class="ma-view-btn">${__("Table")}</button>`).appendTo($toggle);
		this.$view_cards_btn = $(`<button class="ma-view-btn">${__("Cards")}</button>`).appendTo($toggle);
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

	// ---- tabs -------------------------------------------------------------------

	render_tabs() {
		const $tabs = $('<div class="ma-tabs">').appendTo(this.$container);
		this.$tab_dashboard = $(`<button class="ma-tab active">${__("Dashboard")}</button>`).appendTo($tabs);
		this.$tab_findings = $(`<button class="ma-tab">${__("Findings")}</button>`).appendTo($tabs);
		this.$tab_dashboard.on("click", () => this.switch_tab("dashboard"));
		this.$tab_findings.on("click", () => this.switch_tab("findings"));
	}

	switch_tab(tab) {
		const is_dashboard = tab === "dashboard";
		this.$tab_dashboard.toggleClass("active", is_dashboard);
		this.$tab_findings.toggleClass("active", !is_dashboard);
		this.$tab_dashboard_content.toggle(is_dashboard);
		this.$tab_findings_content.toggle(!is_dashboard);
		// frappe.Chart (used for the trend chart) can size itself to 0 if built
		// while its container is display:none - rebuild on every return to this
		// tab so it's always constructed while visible. The composition bars /
		// rankings are plain CSS and don't have this problem, so this is cheap
		// insurance, not a full page reload.
		if (is_dashboard) this.load_dashboard();
	}

	// ---- dashboard: stat tiles + charts -----------------------------------------

	render_dashboard_shell($parent) {
		this.$dashboard = $('<div class="ma-dashboard">').appendTo($parent);
		this.render_dashboard_filters(this.$dashboard);
		this.$dashboard_filter_note = $('<div class="ma-dashboard-filter-note">').appendTo(this.$dashboard);
		this.$tiles = $('<div class="ma-tiles">').appendTo(this.$dashboard);

		const $charts_row = $('<div class="ma-charts-row">').appendTo(this.$dashboard);
		this.$chart_severity = this.make_chart_card($charts_row, __("By Severity"));
		this.$chart_status = this.make_chart_card($charts_row, __("By Action Status"));

		const $rankings_row = $('<div class="ma-charts-row">').appendTo(this.$dashboard);
		this.$rank_areas = this.make_chart_card($rankings_row, __("Areas with the Most Findings"));
		this.$rank_equipment = this.make_chart_card($rankings_row, __("Equipment with the Most Findings"));

		// Full-width and stacked, not side-by-side: 7 columns (label + 5
		// severities + total) don't fit comfortably in a half-width card.
		this.$crosstab_areas = this.make_chart_card(this.$dashboard, __("Area × Severity"));
		this.$crosstab_equipment = this.make_chart_card(this.$dashboard, __("Equipment × Severity"));

		this.$chart_trend = this.make_chart_card(this.$dashboard, __("Findings by Report (Inspection)"));
	}

	make_chart_card(container, title) {
		const $card = $('<div class="ma-chart-card">').appendTo(container);
		$('<div class="ma-chart-title">').text(title).appendTo($card);
		return $('<div class="ma-chart-body">').appendTo($card);
	}

	// Drives the dashboard charts/rankings/crosstabs/trend (NOT the 4 stat
	// tiles, which stay global - see load_dashboard). Deliberately its OWN
	// filter state, separate from the Findings tab's - the Dashboard is for
	// monitoring KPIs, Findings is for finding/editing a record, and they
	// don't need to stay in lockstep. Dates filter by report_date (when the
	// reading was taken), not creation (when the sheet was typed up).
	get_dashboard_base_filters() {
		const filters = {};
		if (this.dashboard_severity_filter) filters.severity = this.dashboard_severity_filter;
		if (this.dashboard_active_status !== "all") filters.action_status = this.dashboard_active_status;
		if (this.dashboard_area_filter) filters.area = this.dashboard_area_filter;
		if (this.dashboard_equipment_filter) filters.equipment = this.dashboard_equipment_filter;
		if (this.dashboard_date_from && this.dashboard_date_to) {
			filters.report_date = ["between", [this.dashboard_date_from, this.dashboard_date_to]];
		} else if (this.dashboard_date_from) {
			filters.report_date = [">=", this.dashboard_date_from];
		} else if (this.dashboard_date_to) {
			filters.report_date = ["<=", this.dashboard_date_to];
		}
		return filters;
	}

	// List form of the same filters, for the 4 stat tiles specifically: each
	// tile also has its OWN hardcoded condition (e.g. "Critical" always
	// requires severity=Critical), and a plain filters *object* can only
	// hold one value per fieldname - merging two conditions on the same
	// field would silently overwrite one of them. A filters *list* allows
	// multiple conditions on the same field, so they correctly AND together
	// instead (e.g. "Open" while dashboard_active_status="Done" correctly
	// shows 0 - the two conditions are genuinely contradictory, which is
	// the right answer once you've explicitly picked that filter).
	get_dashboard_base_filters_list() {
		const filters = [];
		if (this.dashboard_severity_filter) filters.push(["severity", "=", this.dashboard_severity_filter]);
		if (this.dashboard_active_status !== "all") filters.push(["action_status", "=", this.dashboard_active_status]);
		if (this.dashboard_area_filter) filters.push(["area", "=", this.dashboard_area_filter]);
		if (this.dashboard_equipment_filter) filters.push(["equipment", "=", this.dashboard_equipment_filter]);
		if (this.dashboard_date_from) filters.push(["report_date", ">=", this.dashboard_date_from]);
		if (this.dashboard_date_to) filters.push(["report_date", "<=", this.dashboard_date_to]);
		return filters;
	}

	// Drives the card list + table fetch (Findings tab).
	get_findings_filters() {
		const filters = {};
		if (this.severity_filter) filters.severity = this.severity_filter;
		if (this.active_status !== "all") filters.action_status = this.active_status;
		return filters;
	}

	render_dashboard_filter_note() {
		const base = this.get_dashboard_base_filters();
		const parts = [];
		if (base.severity) parts.push(`${__("Severity")}: <b>${frappe.utils.escape_html(base.severity)}</b>`);
		if (base.action_status) parts.push(`${__("Status")}: <b>${frappe.utils.escape_html(base.action_status)}</b>`);
		if (this.dashboard_date_from || this.dashboard_date_to) {
			const from = this.dashboard_date_from ? frappe.datetime.str_to_user(this.dashboard_date_from) : "…";
			const to = this.dashboard_date_to ? frappe.datetime.str_to_user(this.dashboard_date_to) : "…";
			parts.push(`${__("Period")}: <b>${from} – ${to}</b>`);
		}

		if (!parts.length && !this.dashboard_area_filter && !this.dashboard_equipment_filter) {
			this.$dashboard_filter_note.html(`<span>${__("Showing: all findings")}</span>`);
			return;
		}

		this.$dashboard_filter_note.html(
			`${__("Filtered by")}: <span class="ma-filter-note-parts">${parts.join(" · ")}</span>`
		);
		const $parts = this.$dashboard_filter_note.find(".ma-filter-note-parts");

		const add_async_part = (label, code, resolver) => {
			if ($parts.text().trim()) $parts.append(" · ");
			$parts.append(`${label}: `);
			resolver.call(this, code, $("<b>").appendTo($parts));
		};

		if (this.dashboard_area_filter) add_async_part(__("Area"), this.dashboard_area_filter, this.resolve_area_label);
		if (this.dashboard_equipment_filter) {
			add_async_part(__("Equipment"), this.dashboard_equipment_filter, this.resolve_equipment_label);
		}
	}

	// Both resolvers fetch the link's display title and drop it into $el once
	// it arrives - the filter note renders synchronously first (showing the
	// raw code) so the UI never blocks on these two extra round-trips.
	resolve_area_label(code, $el) {
		$el.text(code);
		this._area_label_cache = this._area_label_cache || {};
		if (this._area_label_cache[code]) {
			$el.text(this._area_label_cache[code]);
			return;
		}
		frappe.db.get_value("Area", code, "area_name").then((r) => {
			const label = (r.message && r.message.area_name) || code;
			this._area_label_cache[code] = label;
			$el.text(label);
		});
	}

	resolve_equipment_label(code, $el) {
		$el.text(code);
		this._equipment_label_cache = this._equipment_label_cache || {};
		if (this._equipment_label_cache[code]) {
			$el.text(this._equipment_label_cache[code]);
			return;
		}
		frappe.db.get_value("Equipment", code, "description").then((r) => {
			const label = (r.message && r.message.description) || code;
			this._equipment_label_cache[code] = label;
			$el.text(label);
		});
	}

	load_dashboard() {
		this.render_dashboard_filter_note();
		const base = this.get_dashboard_base_filters();
		const base_list = this.get_dashboard_base_filters_list();

		Promise.all([
			// The 4 stat tiles respect the Dashboard filters too (combined via a
			// filters LIST, not a plain object - see get_dashboard_base_filters_list
			// for why that matters once a tile's own hardcoded condition and a
			// user-picked filter could land on the same field).
			frappe.call({ method: "frappe.client.get_count", args: { doctype: "Equipment Inspection", filters: base_list } }),
			frappe.call({
				method: "frappe.client.get_count",
				args: {
					doctype: "Equipment Inspection",
					filters: [...base_list, ["action_status", "in", ["Open", "In Progress"]]],
				},
			}),
			frappe.call({
				method: "frappe.client.get_count",
				args: { doctype: "Equipment Inspection", filters: [...base_list, ["severity", "=", "Critical"]] },
			}),
			frappe.call({
				method: "frappe.client.get_count",
				args: {
					doctype: "Equipment Inspection",
					filters: [
						...base_list,
						["due_date", "<", frappe.datetime.get_today()],
						["action_status", "not in", ["Done", "Not Applicable"]],
					],
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: ["severity", "count(name) as total"],
					group_by: "severity",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: ["action_status", "count(name) as total"],
					group_by: "action_status",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: ["report", "count(name) as total"],
					group_by: "report",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Inspection Report",
					fields: ["name", "report_date", "period_label"],
					order_by: "report_date asc",
					limit_page_length: 0,
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: [
						"area",
						"area.area_name as area_name",
						"count(`tabEquipment Inspection`.name) as total",
					],
					group_by: "area",
					order_by: "total desc",
					limit_page_length: 5,
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: ["equipment", "equipment_description", "count(name) as total"],
					group_by: "equipment",
					order_by: "total desc",
					limit_page_length: 5,
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: [
						"area",
						"area.area_name as area_name",
						"severity",
						"count(`tabEquipment Inspection`.name) as total",
					],
					group_by: "area, severity",
					// Without this, Frappe's implicit default order (the doctype's own
					// sort_field) is just as ambiguous once area.area_name joins in
					// tabArea - see load_entries()/load_table_data() above for the
					// same problem with an explicit order_by. The rows are re-pivoted
					// client-side anyway, so row order from the query doesn't matter.
					order_by: "",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: base,
					fields: ["equipment", "equipment_description", "severity", "count(name) as total"],
					group_by: "equipment, severity",
				},
			}),
		]).then((results) => {
			const [
				total,
				open_count,
				critical,
				overdue,
				by_severity,
				by_status,
				by_report,
				reports,
				top_areas,
				top_equipment,
				crosstab_areas,
				crosstab_equipment,
			] = results.map((r) => r.message);
			this.render_stat_tiles({
				total: total || 0,
				open: open_count || 0,
				critical: critical || 0,
				overdue: overdue || 0,
			});
			this.render_severity_chart(by_severity || []);
			this.render_status_chart(by_status || []);
			this.render_ranking(this.$rank_areas, top_areas || [], "area_name", "area");
			this.render_ranking(this.$rank_equipment, top_equipment || [], "equipment_description", "equipment");
			this.render_crosstab(this.$crosstab_areas, crosstab_areas || [], "area_name", "area");
			this.render_crosstab(this.$crosstab_equipment, crosstab_equipment || [], "equipment_description", "equipment");
			this.render_trend_chart(by_report || [], reports || []);
		});
	}

	render_stat_tiles(stats) {
		this.$tiles.empty();
		const tiles = [
			[__("Total Findings"), stats.total, ""],
			[__("Open"), stats.open, "ma-tile-warning"],
			[__("Critical"), stats.critical, "ma-tile-critical"],
			[__("Overdue"), stats.overdue, "ma-tile-critical"],
		];
		tiles.forEach(([label, value, cls]) => {
			$(`<div class="ma-tile ${cls}"><div class="ma-tile-value">${value}</div><div class="ma-tile-label">${label}</div></div>`).appendTo(
				this.$tiles
			);
		});
	}

	render_empty_chart($body) {
		$body.html(`<div class="ma-empty">${__("No data")}</div>`);
	}

	// Hand-built composition bar instead of frappe.Chart's "percentage" type -
	// gives full control over spacing/typography and shows the percentage
	// alongside the count, matching the rest of the page's design language
	// rather than the chart library's default look.
	render_severity_chart(rows) {
		const items = [];
		MA_SEVERITY_OPTIONS.forEach((sev) => {
			const row = rows.find((r) => r.severity === sev);
			if (row && row.total) items.push({ label: sev, value: row.total, color: MA_SEVERITY_HEX[sev] });
		});
		this.render_comp_bar(this.$chart_severity, items);
	}

	render_status_chart(rows) {
		const items = [];
		MA_STATUS_OPTIONS.forEach((status) => {
			const row = rows.find((r) => r.action_status === status);
			if (row && row.total) items.push({ label: status, value: row.total, color: MA_STATUS_HEX[status] });
		});
		this.render_comp_bar(this.$chart_status, items);
	}

	render_comp_bar($body, items) {
		$body.empty();
		if (!items.length) return this.render_empty_chart($body);

		const total = items.reduce((sum, i) => sum + i.value, 0);
		const $bar = $('<div class="ma-comp-bar">').appendTo($body);
		items.forEach((item) => {
			const pct = (item.value / total) * 100;
			$(`<div class="ma-comp-seg" style="width:${pct}%;background:${item.color}">`)
				.attr("title", `${item.label}: ${item.value} (${pct.toFixed(0)}%)`)
				.appendTo($bar);
		});

		const $legend = $('<div class="ma-comp-legend">').appendTo($body);
		items.forEach((item) => {
			const pct = ((item.value / total) * 100).toFixed(0);
			const $row = $('<div class="ma-comp-legend-item">').appendTo($legend);
			$('<span class="ma-comp-dot">').css("background", item.color).appendTo($row);
			$('<span class="ma-comp-legend-label">').text(item.label).appendTo($row);
			$('<span class="ma-comp-legend-value">').text(`${item.value} · ${pct}%`).appendTo($row);
		});
	}

	render_ranking($body, rows, name_field, code_field) {
		$body.empty();
		if (!rows.length) return this.render_empty_chart($body);

		const max = Math.max(...rows.map((r) => r.total));
		rows.forEach((row) => {
			const label = row[name_field] || row[code_field] || "";
			const pct = max ? (row.total / max) * 100 : 0;
			const $row = $('<div class="ma-rank-row">').appendTo($body);
			$('<div class="ma-rank-label">').attr("title", label).text(label).appendTo($row);
			const $wrap = $('<div class="ma-rank-bar-wrap">').appendTo($row);
			$('<div class="ma-rank-bar">').css("width", pct + "%").appendTo($wrap);
			$('<div class="ma-rank-value">').text(row.total).appendTo($row);
		});
	}

	// rows: one row per (dimension, severity) combination with its count,
	// e.g. [{area, area_name, severity, total}, ...]. Pivots into a
	// dimension × severity grid, limited to the top 8 dimension values by
	// total count so the table stays readable.
	render_crosstab($body, rows, name_field, code_field) {
		$body.empty();
		if (!rows.length) return this.render_empty_chart($body);

		const totals_by_dim = {};
		const label_by_dim = {};
		const matrix = {};
		rows.forEach((row) => {
			const key = row[code_field];
			totals_by_dim[key] = (totals_by_dim[key] || 0) + row.total;
			label_by_dim[key] = row[name_field] || key;
			matrix[key] = matrix[key] || {};
			matrix[key][row.severity] = row.total;
		});

		const top_dims = Object.keys(totals_by_dim)
			.sort((a, b) => totals_by_dim[b] - totals_by_dim[a])
			.slice(0, 8);

		const $scroll = $('<div class="ma-crosstab-scroll">').appendTo($body);
		const $table = $('<table class="ma-crosstab">').appendTo($scroll);
		const $thead_row = $("<tr>").appendTo($("<thead>").appendTo($table));
		$("<th>").appendTo($thead_row);
		MA_SEVERITY_OPTIONS.forEach((sev) => $("<th>").text(sev).appendTo($thead_row));
		$("<th>").text(__("Total")).appendTo($thead_row);

		const $tbody = $("<tbody>").appendTo($table);
		top_dims.forEach((dim) => {
			const $row = $("<tr>").appendTo($tbody);
			$("<td>").addClass("ma-crosstab-label").attr("title", label_by_dim[dim]).text(label_by_dim[dim]).appendTo($row);
			MA_SEVERITY_OPTIONS.forEach((sev) => {
				const count = (matrix[dim] && matrix[dim][sev]) || 0;
				const $cell = $("<td>").addClass("ma-crosstab-cell").text(count || "–").appendTo($row);
				if (count) {
					$cell.css({
						background: hex_to_rgba(MA_SEVERITY_HEX[sev], 0.14),
						color: MA_SEVERITY_HEX[sev],
						"font-weight": 700,
					});
				}
			});
			$("<td>").addClass("ma-crosstab-total").text(totals_by_dim[dim]).appendTo($row);
		});

		if (Object.keys(totals_by_dim).length > 8) {
			$(`<div class="ma-crosstab-note">${__("Showing the top 8 of {0}.", [Object.keys(totals_by_dim).length])}</div>`).appendTo(
				$body
			);
		}
	}

	render_trend_chart(report_counts, reports) {
		this.$chart_trend.empty();
		const counts_by_name = {};
		report_counts.forEach((r) => {
			counts_by_name[r.report] = r.total;
		});

		const labels = [];
		const values = [];
		reports.forEach((r) => {
			if (!counts_by_name[r.name]) return;
			labels.push(r.period_label || (r.report_date ? frappe.datetime.str_to_user(r.report_date) : r.name));
			values.push(counts_by_name[r.name]);
		});

		if (!labels.length) return this.render_empty_chart(this.$chart_trend);
		new frappe.Chart(this.$chart_trend[0], {
			data: { labels, datasets: [{ name: __("Findings"), values }] },
			type: "bar",
			height: 200,
			colors: ["#14877e"],
			valuesOverPoints: 1,
		});
	}

	// ---- filters --------------------------------------------------------------

	// Findings tab: Severity + Status, always visible regardless of Cards/
	// Table, real server-side filters for finding/editing records. Kept
	// deliberately independent from the Dashboard tab's own filters (below)
	// - see the constructor comment for why.
	render_findings_filters($parent) {
		const $bar = $('<div class="ma-shared-filters">').appendTo($parent);

		this.$severity_select = $('<select class="ma-select">').appendTo($bar);
		$(`<option value="">${__("All severities")}</option>`).appendTo(this.$severity_select);
		MA_SEVERITY_OPTIONS.forEach((s) => $(`<option value="${s}">${s}</option>`).appendTo(this.$severity_select));
		this.$severity_select.on("change", () => {
			this.severity_filter = this.$severity_select.val();
			this.on_findings_filters_change();
		});

		this.$chips = $('<div class="ma-chips">').appendTo($bar);
		const chip_defs = [["all", __("All")]].concat(MA_STATUS_OPTIONS.map((s) => [s, s]));
		chip_defs.forEach(([key, label]) => {
			const $chip = $(`<button class="ma-chip" data-key="${frappe.utils.escape_html(key)}">${label}</button>`).appendTo(
				this.$chips
			);
			if (key === "all") $chip.addClass("active");
			$chip.on("click", () => {
				this.active_status = key;
				this.$chips.find(".ma-chip").removeClass("active");
				$chip.addClass("active");
				this.on_findings_filters_change();
			});
		});
	}

	on_findings_filters_change() {
		this.load_entries();
		if (this.table_rows) this.load_table_data();
	}

	// Dashboard tab: its own Severity + Status, driving only the dashboard.
	render_dashboard_filters($parent) {
		const $outer = $('<div class="ma-shared-filters ma-shared-filters-stacked">').appendTo($parent);
		const $row1 = $('<div class="ma-shared-filters-row">').appendTo($outer);
		const $row2 = $('<div class="ma-shared-filters-row">').appendTo($outer);

		this.$dashboard_severity_select = $('<select class="ma-select">').appendTo($row1);
		$(`<option value="">${__("All severities")}</option>`).appendTo(this.$dashboard_severity_select);
		MA_SEVERITY_OPTIONS.forEach((s) => $(`<option value="${s}">${s}</option>`).appendTo(this.$dashboard_severity_select));
		this.$dashboard_severity_select.on("change", () => {
			this.dashboard_severity_filter = this.$dashboard_severity_select.val();
			this.load_dashboard();
		});

		this.$dashboard_chips = $('<div class="ma-chips">').appendTo($row1);
		const chip_defs = [["all", __("All")]].concat(MA_STATUS_OPTIONS.map((s) => [s, s]));
		chip_defs.forEach(([key, label]) => {
			const $chip = $(`<button class="ma-chip" data-key="${frappe.utils.escape_html(key)}">${label}</button>`).appendTo(
				this.$dashboard_chips
			);
			if (key === "all") $chip.addClass("active");
			$chip.on("click", () => {
				this.dashboard_active_status = key;
				this.$dashboard_chips.find(".ma-chip").removeClass("active");
				$chip.addClass("active");
				this.load_dashboard();
			});
		});

		const $clear_btn = $(`<button class="ma-btn">${__("Clear Filters")}</button>`).appendTo($row1);
		$clear_btn.on("click", () => this.clear_dashboard_filters());

		const $area_wrap = $('<div class="ma-painel-filter-field">').appendTo($row2);
		this.dashboard_area_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "dashboard_area",
				label: __("Area"),
				options: "Area",
				onchange: () => {
					this.dashboard_area_filter = this.dashboard_area_control.get_value();
					this.load_dashboard();
				},
			},
			parent: $area_wrap[0],
			render_input: true,
		});
		this.dashboard_area_control.refresh();

		const $equip_wrap = $('<div class="ma-painel-filter-field">').appendTo($row2);
		this.dashboard_equipment_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "dashboard_equipment",
				label: __("Equipment"),
				options: "Equipment",
				onchange: () => {
					this.dashboard_equipment_filter = this.dashboard_equipment_control.get_value();
					this.load_dashboard();
				},
			},
			parent: $equip_wrap[0],
			render_input: true,
		});
		this.dashboard_equipment_control.refresh();

		const $date_from_wrap = $('<div class="ma-painel-filter-field">').appendTo($row2);
		$('<label class="ma-painel-filter-label">').text(__("From")).appendTo($date_from_wrap);
		this.$dashboard_date_from = $('<input type="date" class="ma-select">').appendTo($date_from_wrap);
		this.$dashboard_date_from.on("change", () => {
			this.dashboard_date_from = this.$dashboard_date_from.val();
			this.load_dashboard();
		});

		const $date_to_wrap = $('<div class="ma-painel-filter-field">').appendTo($row2);
		$('<label class="ma-painel-filter-label">').text(__("To")).appendTo($date_to_wrap);
		this.$dashboard_date_to = $('<input type="date" class="ma-select">').appendTo($date_to_wrap);
		this.$dashboard_date_to.on("change", () => {
			this.dashboard_date_to = this.$dashboard_date_to.val();
			this.load_dashboard();
		});
	}

	clear_dashboard_filters() {
		this.dashboard_severity_filter = "";
		this.dashboard_active_status = "all";
		this.dashboard_area_filter = "";
		this.dashboard_equipment_filter = "";
		this.dashboard_date_from = "";
		this.dashboard_date_to = "";

		this.$dashboard_severity_select.val("");
		this.$dashboard_chips.find(".ma-chip").removeClass("active");
		this.$dashboard_chips.find('[data-key="all"]').addClass("active");
		this.dashboard_area_control.set_value("");
		this.dashboard_equipment_control.set_value("");
		this.$dashboard_date_from.val("");
		this.$dashboard_date_to.val("");

		this.load_dashboard();
	}

	// Card-view-only: free-text, client-side narrowing of whatever's already
	// loaded. Not a server filter, so (like before) it doesn't affect the
	// table or the dashboard - there's no single field to aggregate a
	// substring match by.
	render_filters($parent) {
		const $bar = $('<div class="ma-filters">').appendTo($parent);

		this.$search = $(
			`<input type="text" class="ma-search" placeholder="${__("Search by equipment, area, description...")}">`
		).appendTo($bar);
		this.$search.on("input", () => {
			this.search_term = (this.$search.val() || "").toLowerCase().trim();
			this.apply_search();
		});
	}

	apply_search() {
		let visible = 0;
		this.entries.forEach((entry) => {
			const row = entry.data;
			const haystack = [
				row.equipment_description || row.equipment,
				row.area_name || row.area,
				row.defects,
				row.severity,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			const show = !this.search_term || haystack.includes(this.search_term);
			entry.$card.toggle(show);
			if (show) visible++;
		});
		this.$empty_filtered && this.$empty_filtered.remove();
		if (this.entries.length && visible === 0) {
			this.$empty_filtered = $(`<div class="ma-empty">${__("No finding matches the search.")}</div>`).appendTo(
				this.$list
			);
		}
	}

	// ---- summary bar ------------------------------------------------------------

	render_summary_bar() {
		if (!this.entries.length) {
			this.$summary.empty();
			return;
		}
		const counts = {};
		this.entries.forEach((entry) => {
			const status = entry.data.action_status || "Open";
			counts[status] = (counts[status] || 0) + 1;
		});

		const parts = [`<span class="ma-summary-total">${this.entries.length} ${__("findings")}</span>`];
		MA_STATUS_OPTIONS.forEach((status) => {
			if (counts[status]) {
				parts.push(`<span class="ma-badge ${MA_STATUS_BADGE[status]}">${counts[status]} ${status}</span>`);
			}
		});
		this.$summary.html(parts.join(""));
	}

	// ---- list ------------------------------------------------------------------

	refresh_list() {
		this.$list.empty();
		this.render_summary_bar();

		if (!this.entries.length) {
			this.$list.html(`<div class="ma-empty">${__("No findings recorded for your account yet.")}</div>`);
			this.$load_more_wrap.hide();
			return;
		}

		this.entries.forEach((entry) => this.$list.append(entry.$card));
		this.apply_search();
		this.$load_more_wrap.toggle(this.has_more);
	}

	load_entries(append) {
		if (!append) this.offset = 0;

		const filters = this.get_findings_filters();

		this.$load_more_btn.prop("disabled", true).text(__("Loading..."));

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters,
					fields: [
						"name",
						"area",
						"area.area_name as area_name",
						"equipment",
						"equipment_description",
						"severity",
						"defects",
						"action_status",
						"report",
						"report.period_label as period_label",
						"creation",
					],
					// report_date and creation both exist on Equipment Inspection AND on
					// the joined Inspection Report/Area tables (from the dotted fetches
					// above) - unqualified, MySQL can't tell which one is meant.
					order_by: "`tabEquipment Inspection`.report_date desc, `tabEquipment Inspection`.creation desc",
					limit_start: this.offset,
					limit_page_length: MA_PAGE_SIZE,
				},
			})
			.then((r) => {
				const rows = r.message || [];
				const new_entries = rows.map((row) => ({ data: row }));
				new_entries.forEach((entry) => {
					entry.$card = this.build_card(entry);
				});

				this.entries = append ? this.entries.concat(new_entries) : new_entries;
				this.offset += rows.length;
				this.has_more = rows.length === MA_PAGE_SIZE;
				this.refresh_list();
			})
			.always(() => {
				this.$load_more_btn.prop("disabled", false).text(__("Load more"));
			});
	}

	build_card(entry) {
		const row = entry.data;
		const sev_class = MA_SEVERITY_BADGE[row.severity] || "ma-badge-nao-recolhido";
		const status_class = MA_STATUS_BADGE[row.action_status] || "ma-badge-pendente";

		const $card = $('<div class="ma-card">');
		const $row = $('<div class="ma-row">').appendTo($card);

		const $badges = $('<div class="ma-badges">').appendTo($row);
		$(`<span class="ma-badge ${sev_class}">`).text(row.severity || "").appendTo($badges);
		$(`<span class="ma-badge ${status_class}">`).text(row.action_status || __("Open")).appendTo($badges);

		const $main = $('<div class="ma-main">').appendTo($row);
		const $title = $('<div class="ma-title">').text(row.equipment_description || row.equipment || "").appendTo($main);
		$('<div class="ma-sub">').text(row.defects || "").appendTo($main);

		const $meta = $('<div class="ma-meta">').appendTo($row);
		$("<span>").text(row.area_name || row.area || "").appendTo($meta);
		if (row.period_label) {
			$("<span>&middot;</span>").appendTo($meta);
			$("<span>").text(row.period_label).appendTo($meta);
		}
		$("<span>&middot;</span>").appendTo($meta);
		$("<span>").html(comment_when(row.creation)).appendTo($meta);

		$row.on("click", () => this.open_finding_dialog(entry));

		return $card;
	}

	// ---- table view: sortable columns + per-column filters --------------------

	get_table_columns() {
		// Severity/Status are no longer filterable per-column here - they're
		// server-side filters now, controlled by the shared bar above the
		// Cards/Table toggle (so they also drive the card list + dashboard).
		// Still sortable, since sorting the already-fetched rows is unrelated.
		return [
			{ field: "severity", label: __("Severity"), sortable: true },
			{ field: "equipment_description", label: __("Equipment"), sortable: true, filter: "text", filterKey: "equipment" },
			{ field: "area_name", label: __("Area / Plant"), sortable: true, filter: "text", filterKey: "area" },
			{ field: "action_status", label: __("Status"), sortable: true },
			{ field: "defects", label: __("Defects Found") },
			{ field: "creation", label: __("When"), sortable: true },
		];
	}

	render_table_shell($parent) {
		this.$table_view = $('<div class="ma-table-wrap">').appendTo($parent).hide();
		this.$table_view.html(`<div class="ma-empty">${__("Loading...")}</div>`);
	}

	load_table_data() {
		this.$table_view.html(`<div class="ma-empty">${__("Loading...")}</div>`);

		const filters = this.get_findings_filters();

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters,
					fields: [
						"name",
						"area",
						"area.area_name as area_name",
						"equipment",
						"equipment_description",
						"severity",
						"defects",
						"action_status",
						"report.period_label as period_label",
						"creation",
					],
					order_by: "`tabEquipment Inspection`.report_date desc, `tabEquipment Inspection`.creation desc",
					limit_page_length: 500,
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

		const $table = $('<table class="ma-table">').appendTo(this.$table_view);
		const $thead = $("<thead>").appendTo($table);

		const $header_row = $("<tr>").appendTo($thead);
		columns.forEach((col) => {
			const $th = $("<th>").attr("data-field", col.field).appendTo($header_row);
			$("<span>").text(col.label).appendTo($th);
			if (col.sortable) {
				$th.addClass("ma-th-sortable");
				$('<span class="ma-sort-arrow">').appendTo($th);
				$th.on("click", () => this.toggle_table_sort(col.field));
			}
		});

		const $filter_row = $('<tr class="ma-table-filter-row">').appendTo($thead);
		columns.forEach((col) => {
			const $td = $("<th>").appendTo($filter_row);
			if (col.filter === "text") {
				const $input = $(`<input type="text" class="ma-table-filter-input" placeholder="${__("Filter...")}">`).appendTo(
					$td
				);
				$input.val(this.table_filters[col.filterKey] || "");
				$input.on("input", () => {
					this.table_filters[col.filterKey] = $input.val();
					this.render_table_rows();
				});
			} else if (col.filter === "select") {
				const $select = $('<select class="ma-table-filter-input">').appendTo($td);
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
		if (field === "severity") return MA_SEVERITY_OPTIONS.indexOf(row.severity);
		if (field === "action_status") return MA_STATUS_OPTIONS.indexOf(row.action_status || "Open");
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
		this.$table_view.find(".ma-th-sortable").each((_, el) => {
			const $th = $(el);
			const is_active = $th.attr("data-field") === this.table_sort.field;
			$th.find(".ma-sort-arrow").text(is_active ? (this.table_sort.dir === "asc" ? " ▲" : " ▼") : "");
		});
	}

	render_table_rows() {
		const columns = this.get_table_columns();
		let rows = (this.table_rows || []).filter((row) => {
			if (this.table_filters.equipment) {
				const v = (row.equipment_description || row.equipment || "").toLowerCase();
				if (!v.includes(this.table_filters.equipment.toLowerCase())) return false;
			}
			if (this.table_filters.area) {
				const v = (row.area_name || row.area || "").toLowerCase();
				if (!v.includes(this.table_filters.area.toLowerCase())) return false;
			}
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
				.html(`<div class="ma-empty">${__("No finding matches the filter.")}</div>`)
				.appendTo($empty_row);
			return;
		}

		rows.forEach((row) => {
			const $tr = $("<tr>").appendTo(this.$table_tbody);
			columns.forEach((col) => {
				const $td = $("<td>").appendTo($tr);
				if (col.field === "severity") {
					const cls = MA_SEVERITY_BADGE[row.severity] || "ma-badge-nao-recolhido";
					$(`<span class="ma-badge ${cls}">`).text(row.severity || "").appendTo($td);
				} else if (col.field === "action_status") {
					const status = row.action_status || __("Open");
					const cls = MA_STATUS_BADGE[row.action_status] || "ma-badge-pendente";
					$(`<span class="ma-badge ${cls}">`).text(status).appendTo($td);
				} else if (col.field === "creation") {
					$td.html(comment_when(row.creation));
				} else {
					$td.text(row[col.field] || "").attr("title", row[col.field] || "");
				}
			});
			$tr.on("click", () => this.open_finding_dialog({ data: row }));
		});
	}

	// ---- detail + response dialog -----------------------------------------------

	build_summary_html(data) {
		const rows = [[__("Severity"), `<span class="ma-badge ${MA_SEVERITY_BADGE[data.severity] || "ma-badge-nao-recolhido"}">${frappe.utils.escape_html(data.severity || "")}</span>`]];

		rows.push([__("Equipment"), frappe.utils.escape_html(data.equipment_description || data.equipment || "")]);
		rows.push([__("Area / Plant"), frappe.utils.escape_html(data.area_name || data.area || "")]);
		if (data.report_date) rows.push([__("Report Date"), frappe.datetime.str_to_user(data.report_date)]);
		if (data.defects) rows.push([__("Defects Found"), frappe.utils.escape_html(data.defects)]);
		if (data.recommendations) rows.push([__("Recommendations"), frappe.utils.escape_html(data.recommendations)]);
		if (data.follow_up) rows.push([__("Actions Taken / Follow-up"), frappe.utils.escape_html(data.follow_up)]);

		let html = '<div class="ma-summary-block">';
		rows.forEach(([label, value]) => {
			html += `<div class="ma-summary-row"><div class="ma-summary-label">${label}</div><div class="ma-summary-value">${value}</div></div>`;
		});
		html += "</div>";

		const readings = (data.readings || []).filter((r) => r.velocity_mm_s || r.acceleration_g || r.temperature_c);
		if (readings.length) {
			html += '<div class="ma-crosstab-scroll" style="margin-top:10px"><table class="ma-crosstab"><thead><tr>';
			html += `<th>${__("Point")}</th><th>mm/s</th><th>g's</th><th>${__("Temp.")} (°C)</th></tr></thead><tbody>`;
			readings.forEach((r) => {
				const cell = (value, severity) => {
					if (!value) return "<td></td>";
					const color = MA_SEVERITY_HEX[severity];
					const style = color ? ` style="background:${hex_to_rgba(color, 0.14)};color:${color};font-weight:700"` : "";
					return `<td${style}>${value}</td>`;
				};
				html += `<tr><td class="ma-crosstab-label">${frappe.utils.escape_html(r.point || "")}</td>`;
				html += cell(r.velocity_mm_s, r.velocity_severity);
				html += cell(r.acceleration_g, r.acceleration_severity);
				html += `<td>${r.temperature_c || ""}</td></tr>`;
			});
			html += "</tbody></table></div>";
		}

		if ((data.images || []).length) {
			html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">';
			data.images.forEach((img) => {
				html += `<img class="ma-summary-image" src="${frappe.utils.escape_html(img.image)}">`;
			});
			html += "</div>";
		}

		return html;
	}

	open_finding_dialog(entry) {
		const name = entry.data.name;

		// Fetching the full doc + resolving area/equipment titles takes a
		// couple hundred ms - freeze so the click gets instant feedback and a
		// second click (no visible reaction otherwise) can't fire a duplicate
		// fetch or open two dialogs. frappe.dom's freeze/unfreeze are
		// reference-counted, so this nests safely with any other freeze.
		frappe.dom.freeze(__("Opening finding..."));

		frappe
			.call({ method: "frappe.client.get", args: { doctype: "Equipment Inspection", name } })
			.then((r) => {
				const data = r.message;

				return Promise.all([
					data.area
						? frappe.db.get_value("Area", data.area, "area_name")
						: Promise.resolve({ message: {} }),
				]).then(([area_r]) => {
					data.area_name = area_r.message && area_r.message.area_name;
					this.show_finding_dialog(data);
				});
			})
			.always(() => {
				frappe.dom.unfreeze();
			});
	}

	show_finding_dialog(data) {
		const dialog = new frappe.ui.Dialog({
			title: __("Finding {0}", [data.name]),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "summary", options: this.build_summary_html(data) },
				{ fieldtype: "Section Break", label: __("Your Response") },
				{ fieldtype: "Small Text", fieldname: "client_response", label: __("Action Taken / Response") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "responsible", label: __("Responsible") },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Date", fieldname: "due_date", label: __("Due Date") },
				{ fieldtype: "Column Break" },
				{
					fieldtype: "Select",
					fieldname: "action_status",
					label: __("Action Status"),
					options: MA_STATUS_OPTIONS.join("\n"),
				},
				{ fieldtype: "Section Break" },
				{ fieldtype: "Date", fieldname: "completion_date", label: __("Completion Date") },
			],
			primary_action_label: __("Save Response"),
			primary_action: (values) => this.save_response(dialog, data.name, values),
		});

		dialog.set_values({
			client_response: data.client_response,
			responsible: data.responsible,
			due_date: data.due_date,
			action_status: data.action_status,
			completion_date: data.completion_date,
		});

		dialog.show();
	}

	save_response(dialog, name, values) {
		dialog.get_primary_btn().prop("disabled", true);

		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Equipment Inspection", name, fieldname: values },
			})
			.then((r) => {
				frappe.show_alert({ message: __("Response saved"), indicator: "green" });
				dialog.hide();

				const entry = this.entries.find((e) => e.data.name === name);
				if (entry) {
					entry.data = Object.assign({}, entry.data, {
						action_status: r.message.action_status,
					});
					const $old_card = entry.$card;
					entry.$card = this.build_card(entry);
					$old_card.replaceWith(entry.$card);
					this.render_summary_bar();
				}
				this.load_dashboard();
				if (this.table_rows) this.load_table_data();
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
