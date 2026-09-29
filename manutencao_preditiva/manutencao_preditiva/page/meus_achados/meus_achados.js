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
	wrapper.ma.load_history();
	if (wrapper.ma.table_rows) wrapper.ma.load_table_data();
};

const MA_PAGE_SIZE = 50;

// Worst-first, matching the order clients want to triage in.
const MA_SEVERITY_OPTIONS = ["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"];
const MA_STATUS_OPTIONS = ["Open", "In Progress", "Done", "Not Applicable"];

// Same values as Report Workbench's - one severity/status colour language
// across the whole app, not a per-page palette.
const MA_SEVERITY_HEX = {
	Critical: "#c43b3b",
	Alarm: "#d97b29",
	Acceptable: "#b8960c",
	Normal: "#2e8b57",
	"Not Collected": "#8a94a0",
};

const MA_STATUS_HEX = {
	Open: "#b8960c",
	"In Progress": "#2b6ca8",
	Done: "#2e8b57",
	"Not Applicable": "#8a94a0",
};

function hex_to_rgba(hex, alpha) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// An indicator light + label, not a filled pill - see meus_achados.css for
// why (the app models real alarm/status signal, not decoration).
function ma_badge(text, color) {
	if (!text) return "";
	return (
		`<span class="ma-badge"><span class="ma-badge-dot" style="background:${color || "#8a94a0"}"></span>` +
		`${frappe.utils.escape_html(text)}</span>`
	);
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

		// Overview + Equipment tabs: drawn from one condition_history call.
		this.history = null;
		this.action_counts = { open: 0, overdue: 0 };
		this.matrix_filter = "all";
		this.matrix_area = "";
		this.matrix_search = "";

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
			"The condition of your equipment across every inspection: the overall picture, how each equipment is evolving month by month, and the findings that need your response."
		)}</div>`).appendTo(this.$container);

		this.render_tabs();

		this.$tab_overview_content = $('<div class="ma-tab-content">').appendTo(this.$container);
		this.$tab_equipment_content = $('<div class="ma-tab-content">').appendTo(this.$container).hide();
		this.$tab_findings_content = $('<div class="ma-tab-content">').appendTo(this.$container).hide();

		this.render_overview_shell(this.$tab_overview_content);
		this.render_matrix_shell(this.$tab_equipment_content);

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
		this.switch_tab("overview");
		this.load_history();
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
		this.$tabs = {};
		[
			["overview", __("Overview")],
			["equipment", __("Equipment")],
			["findings", __("Findings")],
		].forEach(([key, label]) => {
			this.$tabs[key] = $(`<button class="ma-tab">${label}</button>`)
				.appendTo($tabs)
				.on("click", () => this.switch_tab(key));
		});
	}

	switch_tab(tab) {
		this.tab = tab;
		Object.entries(this.$tabs).forEach(([key, $tab]) => $tab.toggleClass("active", key === tab));
		this.$tab_overview_content.toggle(tab === "overview");
		this.$tab_equipment_content.toggle(tab === "equipment");
		this.$tab_findings_content.toggle(tab === "findings");
		// frappe.Chart sizes itself from its container and draws at 0 width
		// while hidden - so the overview is (re)drawn whenever it is shown.
		if (tab === "overview") this.render_overview();
		if (tab === "equipment") this.render_matrix();
	}

	// ---- condition history (Overview + Equipment tabs) --------------------------
	//
	// One call (manutencao_preditiva.trend.condition_history) returns every
	// equipment's severity per month; both tabs are drawn from it. Readings-
	// only months (e.g. the previous month of an imported Word report) show
	// as hollow cells: measured, not diagnosed.

	load_history() {
		return Promise.all([
			frappe.call({ method: "manutencao_preditiva.trend.condition_history" }),
			frappe.call({
				method: "frappe.client.get_count",
				args: {
					doctype: "Equipment Inspection",
					filters: [
						["readings_only", "=", 0],
						["action_status", "in", ["Open", "In Progress"]],
						["severity", "not in", ["Normal", "Not Collected"]],
					],
				},
			}),
			frappe.call({
				method: "frappe.client.get_count",
				args: {
					doctype: "Equipment Inspection",
					filters: [
						["readings_only", "=", 0],
						["due_date", "<", frappe.datetime.get_today()],
						["action_status", "not in", ["Done", "Not Applicable"]],
					],
				},
			}),
		]).then(([history, open_actions, overdue]) => {
			this.history = history.message || { periods: [], areas: {}, equipment: [] };
			this.action_counts = { open: open_actions.message || 0, overdue: overdue.message || 0 };
			this.render_area_filter_options();
			if (this.tab === "overview") this.render_overview();
			this.render_matrix();
		});
	}

	area_name(code) {
		return (this.history && this.history.areas[code]) || code || "";
	}

	// ---- Overview ---------------------------------------------------------------

	render_overview_shell($parent) {
		this.$tiles = $('<div class="ma-tiles">').appendTo($parent);
		this.$chart_condition = this.make_chart_card($parent, __("Condition over time"));
		this.$chart_condition
			.closest(".ma-chart-card")
			.find(".ma-chart-title")
			.append(`<span class="ma-chart-sub">${__("equipment per severity, each inspection month")}</span>`);
		this.$area_table = this.make_chart_card($parent, __("Areas - latest condition"));
	}

	render_overview() {
		if (!this.history) return;
		const rows = this.history.equipment;
		const count = (fn) => rows.filter(fn).length;

		this.$tiles.empty();
		[
			[__("Equipment monitored"), rows.length, "", null],
			[__("Critical now"), count((r) => r.latest === "Critical"), "ma-tile-critical", "attention"],
			[__("Alarm now"), count((r) => r.latest === "Alarm"), "ma-tile-warning", "attention"],
			[__("Worsened"), count((r) => r.change === "worse"), "ma-tile-critical", "worse"],
			[__("Improved"), count((r) => r.change === "better"), "ma-tile-good", "better"],
			[__("Open actions"), this.action_counts.open, "ma-tile-warning", "findings"],
		].forEach(([label, value, cls, target]) => {
			const $tile = $(
				`<div class="ma-tile ${cls}"><div class="ma-tile-value">${value}</div><div class="ma-tile-label">${label}</div></div>`
			).appendTo(this.$tiles);
			if (!target) return;
			$tile.addClass("ma-tile-link").on("click", () => {
				if (target === "findings") return this.switch_tab("findings");
				this.set_matrix_filter(target);
				this.switch_tab("equipment");
			});
		});
		if (this.action_counts.overdue) {
			$(`<div class="ma-tile-note">${__("{0} overdue", [this.action_counts.overdue])}</div>`).appendTo(
				this.$tiles.find(".ma-tile").last()
			);
		}

		this.render_condition_chart();
		this.render_area_table();
	}

	render_condition_chart() {
		this.$chart_condition.empty();
		const severities = ["Normal", "Acceptable", "Alarm", "Critical"];
		const periods = this.history.periods.filter((p) =>
			this.history.equipment.some((r) => r.cells[p.key] && r.cells[p.key].severity)
		);
		if (!periods.length) return this.render_empty_chart(this.$chart_condition);

		const datasets = severities.map((sev) => ({
			name: __(sev),
			chartType: "bar",
			values: periods.map(
				(p) => this.history.equipment.filter((r) => r.cells[p.key] && r.cells[p.key].severity === sev).length
			),
		}));
		new frappe.Chart(this.$chart_condition[0], {
			type: "bar",
			height: 240,
			data: { labels: periods.map((p) => p.label), datasets },
			colors: severities.map((s) => MA_SEVERITY_HEX[s]),
			barOptions: { stacked: 1, spaceRatio: 0.5 },
			axisOptions: { xIsSeries: 1 },
		});
		if (periods.length === 1) {
			$(`<div class="ma-chart-hint">${__(
				"One diagnosed month so far - each new inspection adds a bar, so the plant's evolution builds up here."
			)}</div>`).appendTo(this.$chart_condition);
		}
	}

	render_area_table() {
		this.$area_table.empty();
		const by_area = new Map();
		this.history.equipment.forEach((r) => {
			if (!by_area.has(r.area)) by_area.set(r.area, []);
			by_area.get(r.area).push(r);
		});
		if (!by_area.size) return this.render_empty_chart(this.$area_table);

		const $table = $(`<table class="ma-area-table"><thead><tr>
			<th>${__("Area")}</th><th class="ma-num">${__("Equipment")}</th><th>${__("Latest condition")}</th>
			<th class="ma-num">${__("Alarm / Critical")}</th><th class="ma-num">${__("Worsened")}</th>
		</tr></thead><tbody></tbody></table>`).appendTo(this.$area_table);
		const $tbody = $table.find("tbody");

		[...by_area.entries()]
			.sort((a, b) => this.area_name(a[0]).localeCompare(this.area_name(b[0])))
			.forEach(([area, rows]) => {
				const attention = rows.filter((r) => ["Alarm", "Critical"].includes(r.latest)).length;
				const worse = rows.filter((r) => r.change === "worse").length;
				const $tr = $("<tr>").appendTo($tbody);
				$("<td>").text(this.area_name(area)).appendTo($tr);
				$('<td class="ma-num">').text(rows.length).appendTo($tr);
				const $bar = $('<div class="ma-mini-bar">').appendTo($("<td>").appendTo($tr));
				["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"].forEach((sev) => {
					const n = rows.filter((r) => r.latest === sev).length;
					if (!n) return;
					$('<div class="ma-mini-seg">')
						.css({ width: `${(n / rows.length) * 100}%`, background: MA_SEVERITY_HEX[sev] })
						.attr("title", `${__(sev)}: ${n}`)
						.appendTo($bar);
				});
				$('<td class="ma-num">').html(attention ? `<b style="color:${MA_SEVERITY_HEX.Alarm}">${attention}</b>` : "0").appendTo($tr);
				$('<td class="ma-num">').html(worse ? `<b style="color:${MA_SEVERITY_HEX.Critical}">▲ ${worse}</b>` : "0").appendTo($tr);
				$tr.on("click", () => {
					this.matrix_area = area;
					this.$matrix_area.val(area);
					this.switch_tab("equipment");
				});
			});
	}

	// ---- Equipment: the evolution matrix ------------------------------------------

	render_matrix_shell($parent) {
		$(`<div class="ma-tab-intro">${__(
			"Each row is one equipment, each column an inspection month - see at a glance what is getting worse, what improved after an intervention, and what has been stable. Click an equipment for its full history and readings trend."
		)}</div>`).appendTo($parent);

		const $bar = $('<div class="ma-shared-filters">').appendTo($parent);
		this.$matrix_search = $(`<input type="search" class="ma-search" placeholder="${__("Search equipment…")}">`)
			.appendTo($bar)
			.on("input", () => {
				this.matrix_search = (this.$matrix_search.val() || "").toLowerCase().trim();
				this.render_matrix();
			});
		this.$matrix_area = $('<select class="ma-select">').appendTo($bar);
		this.$matrix_area.on("change", () => {
			this.matrix_area = this.$matrix_area.val();
			this.render_matrix();
		});
		this.$matrix_chips = $('<div class="ma-chips">').appendTo($bar);
		[
			["all", __("All")],
			["attention", __("Alarm / Critical now")],
			["worse", __("Worsened")],
			["better", __("Improved")],
		].forEach(([key, label]) => {
			$(`<button class="ma-chip" data-key="${key}">${label}</button>`)
				.appendTo(this.$matrix_chips)
				.on("click", () => {
					this.set_matrix_filter(key);
					this.render_matrix();
				});
		});
		this.set_matrix_filter("all");

		const $legend = $('<div class="ma-mx-legend">').appendTo($parent);
		["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"].forEach((sev) => {
			$(`<span><span class="ma-mx-cell" style="background:${MA_SEVERITY_HEX[sev]}"></span>${__(sev)}</span>`).appendTo($legend);
		});
		$(`<span><span class="ma-mx-cell ma-mx-readings"></span>${__("Readings only")}</span>`).appendTo($legend);

		this.$matrix_wrap = $('<div class="ma-mx-wrap">').appendTo($parent);
	}

	set_matrix_filter(key) {
		this.matrix_filter = key;
		this.$matrix_chips.find(".ma-chip").each((_i, el) => $(el).toggleClass("active", $(el).data("key") === key));
	}

	render_area_filter_options() {
		const current = this.matrix_area || "";
		this.$matrix_area.empty();
		$(`<option value="">${__("All areas")}</option>`).appendTo(this.$matrix_area);
		Object.entries(this.history.areas)
			.sort((a, b) => a[1].localeCompare(b[1]))
			.forEach(([code, name]) => $("<option>").val(code).text(name).appendTo(this.$matrix_area));
		this.$matrix_area.val(current);
	}

	get_matrix_rows() {
		return this.history.equipment.filter((r) => {
			if (this.matrix_area && r.area !== this.matrix_area) return false;
			if (this.matrix_filter === "attention" && !["Alarm", "Critical"].includes(r.latest)) return false;
			if (this.matrix_filter === "worse" && r.change !== "worse") return false;
			if (this.matrix_filter === "better" && r.change !== "better") return false;
			if (this.matrix_search && !`${r.description} ${r.equipment}`.toLowerCase().includes(this.matrix_search)) return false;
			return true;
		});
	}

	render_matrix() {
		if (!this.history || !this.$matrix_wrap) return;
		this.$matrix_wrap.empty();
		const periods = this.history.periods;
		const rows = this.get_matrix_rows();
		if (!rows.length) {
			$(`<div class="ma-empty">${
				this.history.equipment.length ? __("No equipment matches.") : __("No inspections yet.")
			}</div>`).appendTo(this.$matrix_wrap);
			return;
		}

		const esc = frappe.utils.escape_html;
		const trend = {
			worse: `<span class="ma-mx-trend worse" title="${__("Worse than the previous inspection")}">▲ ${__("Worse")}</span>`,
			better: `<span class="ma-mx-trend better" title="${__("Better than the previous inspection")}">▼ ${__("Better")}</span>`,
			same: `<span class="ma-mx-trend same">● ${__("Stable")}</span>`,
		};

		let html = `<table class="ma-mx"><thead><tr><th class="ma-mx-eq">${__("Equipment")}</th>`;
		periods.forEach((p) => (html += `<th class="ma-mx-period">${esc(p.label)}</th>`));
		html += `<th class="ma-mx-trend-col">${__("Trend")}</th></tr></thead><tbody>`;

		let current_area = null;
		rows.forEach((r, index) => {
			if (r.area !== current_area) {
				current_area = r.area;
				const n = rows.filter((x) => x.area === r.area).length;
				html += `<tr class="ma-mx-group"><td colspan="${periods.length + 2}">${esc(this.area_name(r.area))}
					<span class="ma-mx-group-count">${n}</span></td></tr>`;
			}
			html += `<tr data-index="${index}"><td class="ma-mx-eq"><a href="#" class="ma-mx-eq-link">${esc(
				r.description || r.equipment
			)}</a></td>`;
			periods.forEach((p) => {
				const c = r.cells[p.key];
				if (!c) {
					html += `<td class="ma-mx-td"><span class="ma-mx-none">·</span></td>`;
				} else if (!c.severity) {
					html += `<td class="ma-mx-td"><span class="ma-mx-cell ma-mx-readings" data-sheet="${esc(c.sheet)}"
						data-readings="1" title="${esc(p.label)} · ${__("readings only")}"></span></td>`;
				} else {
					html += `<td class="ma-mx-td"><span class="ma-mx-cell" data-sheet="${esc(c.sheet)}"
						style="background:${MA_SEVERITY_HEX[c.severity] || "#8a94a0"}"
						title="${esc(p.label)} · ${esc(__(c.severity))}"></span></td>`;
				}
			});
			html += `<td class="ma-mx-trend-col">${trend[r.change] || ""}</td></tr>`;
		});
		html += "</tbody></table>";

		const $table = $(html).appendTo(this.$matrix_wrap);
		$table.on("click", ".ma-mx-eq-link", (e) => {
			e.preventDefault();
			this.open_equipment_dialog(rows[$(e.currentTarget).closest("tr").data("index")]);
		});
		$table.on("click", ".ma-mx-cell", (e) => {
			const $cell = $(e.currentTarget);
			const row = rows[$cell.closest("tr").data("index")];
			if ($cell.data("readings")) return this.open_equipment_dialog(row);
			this.open_finding_dialog({ data: { name: $cell.data("sheet") } });
		});
	}

	// ---- one equipment: timeline + readings trend + history ---------------------

	open_equipment_dialog(row) {
		const dialog = new frappe.ui.Dialog({
			title: row.description || row.equipment,
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "timeline" },
				{ fieldtype: "Section Break", label: __("Readings trend") },
				{ fieldtype: "HTML", fieldname: "trend" },
				{ fieldtype: "Section Break", label: __("History") },
				{ fieldtype: "HTML", fieldname: "history" },
			],
		});

		const esc = frappe.utils.escape_html;
		let timeline = `<div class="ma-eq-meta">${esc(this.area_name(row.area))}</div><div class="ma-eq-timeline">`;
		this.history.periods.forEach((p) => {
			const c = row.cells[p.key];
			const sev = c && c.severity;
			timeline += `<div class="ma-eq-step">
				<span class="ma-mx-cell ${c && !sev ? "ma-mx-readings" : ""}" style="${sev ? `background:${MA_SEVERITY_HEX[sev]}` : ""}"></span>
				<div class="ma-eq-step-label">${esc(p.label)}</div>
				<div class="ma-eq-step-sev">${c ? esc(sev ? __(sev) : __("readings")) : "—"}</div>
			</div>`;
		});
		timeline += "</div>";
		dialog.fields_dict.timeline.$wrapper.html(timeline);
		dialog.fields_dict.history.$wrapper.html(`<div class="ma-empty">${__("Loading…")}</div>`);
		dialog.show();

		manutencao_preditiva.render_equipment_trend(dialog.fields_dict.trend.$wrapper, row.equipment);

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment Inspection",
					filters: { equipment: row.equipment, readings_only: 0 },
					fields: ["name", "report_date", "severity", "defects", "recommendations", "action_status"],
					order_by: "report_date desc",
					limit_page_length: 24,
				},
			})
			.then((r) => {
				const sheets = r.message || [];
				const $wrap = dialog.fields_dict.history.$wrapper.empty();
				if (!sheets.length) {
					$(`<div class="ma-empty">${__("No diagnosed inspections yet.")}</div>`).appendTo($wrap);
					return;
				}
				sheets.forEach((s) => {
					const $item = $(`<div class="ma-eq-history-item">
						<div class="ma-eq-history-head">
							<span class="ma-eq-history-date">${frappe.datetime.str_to_user(s.report_date)}</span>
							${ma_badge(s.severity, MA_SEVERITY_HEX[s.severity])}
							${s.action_status ? ma_badge(s.action_status, MA_STATUS_HEX[s.action_status]) : ""}
						</div>
						${s.defects ? `<div><b>${__("Defects")}:</b> ${esc(s.defects)}</div>` : ""}
						${s.recommendations ? `<div><b>${__("Recommendations")}:</b> ${esc(s.recommendations)}</div>` : ""}
					</div>`).appendTo($wrap);
					$item.on("click", () => {
						dialog.hide();
						this.open_finding_dialog({ data: { name: s.name } });
					});
				});
			});
	}

	// ---- shared bits ------------------------------------------------------------

	make_chart_card(container, title) {
		const $card = $('<div class="ma-chart-card">').appendTo(container);
		$('<div class="ma-chart-title">').text(title).appendTo($card);
		return $('<div class="ma-chart-body">').appendTo($card);
	}

	render_empty_chart($body) {
		$body.html(`<div class="ma-empty">${__("No data")}</div>`);
	}

	// Drives the card list + table fetch (Findings tab). Readings-only sheets
	// (history kept for the trend) are never findings - no action to follow.
	get_findings_filters() {
		const filters = { readings_only: 0 };
		if (this.severity_filter) filters.severity = this.severity_filter;
		if (this.active_status !== "all") filters.action_status = this.active_status;
		return filters;
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
				parts.push(ma_badge(`${counts[status]} ${status}`, MA_STATUS_HEX[status]));
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

		const $card = $('<div class="ma-card">');
		const $row = $('<div class="ma-row">').appendTo($card);

		const $badges = $('<div class="ma-badges">').appendTo($row);
		$badges.append(ma_badge(row.severity, MA_SEVERITY_HEX[row.severity]));
		$badges.append(ma_badge(row.action_status || __("Open"), MA_STATUS_HEX[row.action_status]));

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
		// Cards/Table toggle (so they also drive the card list).
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
					$td.html(ma_badge(row.severity, MA_SEVERITY_HEX[row.severity]));
				} else if (col.field === "action_status") {
					$td.html(ma_badge(row.action_status || __("Open"), MA_STATUS_HEX[row.action_status]));
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
		const rows = [[__("Severity"), ma_badge(data.severity, MA_SEVERITY_HEX[data.severity])]];

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
			// Previous value (from the equipment's previous sheet) next to each
			// reading, so the change since last time reads at a glance.
			const prev = (value) =>
				value ? `<span style="color:#8a94a0;font-weight:400;margin-right:6px">${value} →</span>` : "";
			html += '<div class="ma-crosstab-scroll" style="margin-top:10px"><table class="ma-crosstab"><thead><tr>';
			html += `<th>${__("Point")}</th><th>mm/s</th><th>g's</th><th>${__("Temp.")} (°C)</th></tr></thead><tbody>`;
			readings.forEach((r) => {
				const cell = (value, severity, previous) => {
					if (!value) return "<td></td>";
					const color = MA_SEVERITY_HEX[severity];
					const style = color ? ` style="background:${hex_to_rgba(color, 0.14)};color:${color};font-weight:700"` : "";
					return `<td${style}>${prev(previous)}${value}</td>`;
				};
				html += `<tr><td class="ma-crosstab-label">${frappe.utils.escape_html(r.point || "")}</td>`;
				html += cell(r.velocity_mm_s, r.velocity_severity, r.previous_velocity_mm_s);
				html += cell(r.acceleration_g, r.acceleration_severity, r.previous_acceleration_g);
				html += `<td>${prev(r.previous_temperature_c)}${r.temperature_c || ""}</td></tr>`;
			});
			html += "</tbody></table></div>";
		}

		if ((data.images || []).length) {
			html += '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px">';
			data.images.forEach((img) => {
				html += `<figure style="margin:0;width:160px">`;
				html += `<img class="ma-summary-image" style="width:160px;height:110px;object-fit:cover;cursor:pointer" src="${frappe.utils.escape_html(
					img.image
				)}" onclick="window.open('${frappe.utils.escape_html(img.image)}', '_blank')">`;
				if (img.caption) {
					// Plain hex, not var(--ma-muted) - this HTML renders inside a
					// frappe.ui.Dialog, which sits outside the .ma container the
					// custom property is scoped to.
					html += `<figcaption style="font-size:11px;color:#6b7680;margin-top:2px">${frappe.utils.escape_html(
						img.caption
					)}</figcaption>`;
				}
				html += `</figure>`;
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
				{ fieldtype: "Section Break", label: __("Trend") },
				{ fieldtype: "HTML", fieldname: "trend" },
				{ fieldtype: "Section Break", label: __("Your Response") },
				{ fieldtype: "Small Text", fieldname: "client_response", label: __("Action Taken / Response") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "responsible", label: __("Responsible Person") },
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
		// After show() - frappe.Chart sizes itself from its container, which
		// has no width while the dialog is still hidden.
		manutencao_preditiva.render_equipment_trend(dialog.fields_dict.trend.$wrapper, data.equipment);
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
				this.load_history();
				if (this.table_rows) this.load_table_data();
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
