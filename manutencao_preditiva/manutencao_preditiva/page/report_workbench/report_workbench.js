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
// Structure (2026-09-29): master-detail. A navigator on the left lists
// every report grouped by customer and area (newest period first, drafts
// counted per area, readings-only months muted), with search, a customer
// filter and Draft/Issued chips; the selected report fills the right - its
// header, summary and sheets as ONE panel (render_sheets_card() appends
// into render_report_card()'s container), so it reads as "this report and
// everything in it". The selection is the URL (/app/report-workbench/<name>,
// see select_report()/sync_route()), so back/forward, reload and shared
// links work. Replaced the earlier picker + collapsible Recent Reports
// table, which got messy once imports brought in dozens of reports.
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
	wrapper.rw.load_nav_reports();
	// Coming back to the page: refresh the open report (it may have been
	// edited in the full form meanwhile), or open the one in the URL.
	if (wrapper.rw.report && frappe.get_route()[1] === wrapper.rw.report) wrapper.rw.load_report(wrapper.rw.report);
	else wrapper.rw.sync_route();
};

const RW_SEVERITY_OPTIONS = ["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"];

const RW_SEVERITY_HEX = {
	Critical: "#c43b3b",
	Alarm: "#d97b29",
	Acceptable: "#b8960c",
	Normal: "#2e8b57",
	"Not Collected": "#8a94a0",
};

const RW_STATUS_HEX = {
	Open: "#b8960c",
	"In Progress": "#2b6ca8",
	Done: "#2e8b57",
	"Not Applicable": "#8a94a0",
};

const RW_REPORT_STATUS_HEX = { Draft: "#8a94a0", Issued: "#2e8b57" };

// Fallback alarm limits when Vibration Alarm Settings is empty - the same
// defaults as vibration.py (from the report's "Tabelas de Alarme").
const RW_DEFAULT_BANDS = [
	[15, 2.6, 3.8, 6.3],
	[74, 4.4, 6.3, 10.2],
	[295, 7.2, 10.2, 15],
	[735, 10.5, 15, 18],
];
const RW_DEFAULT_ACCELERATION = [0.9, 1.5, 2.5];

function rw_rgba(hex, alpha) {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// An indicator light + label, not a filled pill - see report_workbench.css
// for why (the app models real alarm/status signal, not decoration).
function rw_badge(text, color) {
	if (!text) return "";
	return (
		`<span class="rw-badge"><span class="rw-badge-dot" style="background:${color || "#8a94a0"}"></span>` +
		`${frappe.utils.escape_html(text)}</span>`
	);
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
		this.nav_rows = [];
		this.nav_status = "all";
		this.nav_search = "";
		this.nav_customer = "";
		this.nav_open = new Set(); // area groups the user unfolded

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Report Workbench"),
			single_column: true,
		});
		this.page.main.addClass("rw-page-main");

		this.render_shell();
		this.load_nav_reports();
		// Back/forward between /app/report-workbench/<report> URLs stays on
		// this page, so follow the route here as well as in on_page_show.
		frappe.router.on("change", () => this.sync_route());
	}

	// Master-detail: a navigator on the left (every report, grouped by area,
	// newest period first) and the selected report on the right. The
	// selection lives in the URL - /app/report-workbench/<report> - so back
	// and forward, reloads and shared links all land on the right report.
	render_shell() {
		this.$container = $('<div class="rw rw-shell">').appendTo(this.page.body);
		const $layout = $('<div class="rw-layout">').appendTo(this.$container);
		this.$nav = $('<aside class="rw-nav">').appendTo($layout);
		this.$main = $('<main class="rw-main">').appendTo($layout);

		this.render_nav();

		this.$empty_state = $('<div class="rw-empty-state">').appendTo(this.$main);
		this.$workbench = $("<div>").appendTo(this.$main).hide();
		this.render_report_card();
		this.render_sheets_card();
		this.render_empty_state();
	}

	// ---- navigator -----------------------------------------------------------

	render_nav() {
		const $head = $('<div class="rw-nav-head">').appendTo(this.$nav);
		$(`<div class="rw-nav-title">${__("Reports")}</div>`).appendTo($head);
		const $head_actions = $('<div class="rw-nav-actions">').appendTo($head);
		$(`<button class="rw-btn rw-btn-sm" title="${__("Import Word reports")}">${__("Import")}</button>`)
			.appendTo($head_actions)
			.on("click", () => this.open_import_dialog());
		$(`<button class="rw-btn rw-btn-sm rw-btn-primary">${__("+ New")}</button>`)
			.appendTo($head_actions)
			.on("click", () => this.open_new_report_dialog());

		const $filters = $('<div class="rw-nav-filters">').appendTo(this.$nav);
		this.$nav_search = $(`<input type="search" class="rw-search" placeholder="${__("Search area, period, job no…")}">`)
			.appendTo($filters)
			.on("input", () => {
				this.nav_search = (this.$nav_search.val() || "").toLowerCase().trim();
				this.render_nav_list();
			});

		const $customer_wrap = $('<div class="rw-field rw-nav-customer">').appendTo($filters);
		this.nav_customer_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "nav_customer",
				placeholder: __("All customers"),
				options: "Customer",
				onchange: () => {
					this.nav_customer = this.nav_customer_control.get_value();
					this.render_nav_list();
				},
			},
			parent: $customer_wrap[0],
			render_input: true,
		});
		this.nav_customer_control.refresh();

		this.$nav_chips = $('<div class="rw-chips">').appendTo($filters);
		[
			["all", __("All")],
			["Draft", __("Draft")],
			["Issued", __("Issued")],
		].forEach(([key, label]) => {
			$(`<button class="rw-chip" data-key="${key}">${label}</button>`)
				.toggleClass("active", key === this.nav_status)
				.appendTo(this.$nav_chips)
				.on("click", (e) => {
					this.nav_status = key;
					this.$nav_chips.find(".rw-chip").removeClass("active");
					$(e.currentTarget).addClass("active");
					this.render_nav_list();
				});
		});

		this.$nav_list = $('<div class="rw-nav-list">').appendTo(this.$nav);
	}

	load_nav_reports() {
		return frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Inspection Report",
					fields: [
						"name",
						"customer",
						"area",
						"area.area_name as area_name",
						"period_label",
						"report_date",
						"status",
						"readings_only",
						"service_reference",
					],
					// "creation" alone is ambiguous once the area.area_name fetch joins
					// in tabArea (it has its own creation column too) - qualify it.
					order_by: "report_date desc, `tabInspection Report`.creation desc",
					limit_page_length: 1000,
				},
			})
			.then((r) => {
				this.nav_rows = r.message || [];
				this.render_nav_list();
				this.render_empty_state();
			});
	}

	get_nav_groups() {
		const rows = this.nav_rows.filter((row) => {
			if (this.nav_status !== "all" && row.status !== this.nav_status) return false;
			if (this.nav_customer && row.customer !== this.nav_customer) return false;
			if (!this.nav_search) return true;
			return [row.area_name, row.period_label, row.service_reference, row.customer, row.name]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(this.nav_search);
		});

		// One group per customer + area, alphabetical; reports inside stay in
		// the query's newest-first order.
		const groups = new Map();
		rows.forEach((row) => {
			const key = `${row.customer}\u0000${row.area}`;
			if (!groups.has(key)) {
				groups.set(key, { key, customer: row.customer, area_name: row.area_name || row.area, rows: [] });
			}
			groups.get(key).rows.push(row);
		});
		return [...groups.values()].sort(
			(a, b) => (a.customer || "").localeCompare(b.customer || "") || (a.area_name || "").localeCompare(b.area_name || "")
		);
	}

	render_nav_list() {
		this.$nav_list.empty();
		const groups = this.get_nav_groups();
		if (!groups.length) {
			$(`<div class="rw-nav-empty">${
				this.nav_rows.length ? __("No reports match.") : __("No reports yet - create one or import Word reports.")
			}</div>`).appendTo(this.$nav_list);
			return;
		}

		const several_customers = new Set(groups.map((g) => g.customer)).size > 1;
		const searching = Boolean(this.nav_search);
		let customer_shown = null;

		groups.forEach((group) => {
			if (several_customers && group.customer !== customer_shown) {
				customer_shown = group.customer;
				$('<div class="rw-nav-customer-head">').text(group.customer).appendTo(this.$nav_list);
			}

			// Open when searching, when it holds the selected report, or when
			// the user opened it; otherwise folded, so 20+ areas stay scannable.
			const has_active = group.rows.some((r) => r.name === this.report);
			const open = searching || has_active || this.nav_open.has(group.key);

			const $group = $('<div class="rw-nav-group">').toggleClass("open", open).appendTo(this.$nav_list);
			const drafts = group.rows.filter((r) => r.status === "Draft").length;
			$(`<button class="rw-nav-group-head">
				<span class="rw-nav-caret"></span>
				<span class="rw-nav-area"></span>
				${drafts ? `<span class="rw-nav-draft-count" title="${__("Drafts")}">${drafts}</span>` : ""}
				<span class="rw-nav-count">${group.rows.length}</span>
			</button>`)
				.find(".rw-nav-area")
				.text(group.area_name)
				.attr("title", group.area_name)
				.end()
				.appendTo($group)
				.on("click", () => {
					const now_open = !$group.hasClass("open");
					$group.toggleClass("open", now_open);
					if (now_open) this.nav_open.add(group.key);
					else this.nav_open.delete(group.key);
				});

			const $items = $('<div class="rw-nav-items">').appendTo($group);
			group.rows.forEach((row) => {
				const $item = $(`<a class="rw-nav-item" href="/app/report-workbench/${encodeURIComponent(row.name)}">
					<span class="rw-nav-dot" style="background:${RW_REPORT_STATUS_HEX[row.status] || "#8a94a0"}"
						title="${frappe.utils.escape_html(row.status || "")}"></span>
					<span class="rw-nav-period"></span>
					<span class="rw-nav-sub"></span>
				</a>`)
					.toggleClass("active", row.name === this.report)
					.toggleClass("readings-only", Boolean(row.readings_only))
					.appendTo($items);
				$item.find(".rw-nav-period").text(row.period_label || row.report_date || row.name);
				$item.find(".rw-nav-sub").text(row.readings_only ? __("readings only") : row.service_reference || row.name);
				$item.on("click", (e) => {
					if (e.ctrlKey || e.metaKey || e.shiftKey) return; // let the browser open a new tab
					e.preventDefault();
					this.select_report(row.name);
				});
			});
		});

		const $active = this.$nav_list.find(".rw-nav-item.active");
		if ($active.length) $active[0].scrollIntoView({ block: "nearest" });
	}

	// ---- selection <-> URL -----------------------------------------------------

	select_report(name) {
		frappe.set_route("report-workbench", name);
	}

	sync_route() {
		const route = frappe.get_route();
		if (route[0] !== "report-workbench") return;
		const name = route[1] ? decodeURIComponent(route[1]) : null;
		if (name && name !== this.report) {
			this.load_report(name);
		} else if (!name && this.report) {
			this.report = null;
			this.report_doc = null;
			this.$workbench.hide();
			this.render_empty_state();
			this.render_nav_list();
		}
	}

	render_empty_state() {
		this.$empty_state.toggle(!this.report).empty();
		if (this.report) return;
		const rows = this.nav_rows || [];
		const drafts = rows.filter((r) => r.status === "Draft").length;
		const areas = new Set(rows.map((r) => `${r.customer}\u0000${r.area}`)).size;
		$(`<div class="rw-empty-title">${__("Pick a report on the left")}</div>`).appendTo(this.$empty_state);
		$(`<div class="rw-empty-sub">${__("{0} reports across {1} areas · {2} in draft", [
			rows.length,
			areas,
			drafts,
		])}</div>`).appendTo(this.$empty_state);
	}

	// ---- import FR.TEC.09 Word reports ---------------------------------------
	//
	// Upload .docx files -> preview what each one would create (nothing is
	// written) -> import in a background job, with progress over realtime.
	// Parsing/writing is manutencao_preditiva.word_import; each file becomes
	// its month's report plus a readings-only report for the previous month.

	open_import_dialog() {
		this.import_files = [];

		const dialog = new frappe.ui.Dialog({
			title: __("Import Word Reports"),
			size: "extra-large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "intro",
					options: `<p class="text-muted" style="margin-bottom:0">${__(
						"FR.TEC.09 vibration reports (.docx). Each file creates its area and equipment if missing, the month's report with every sheet and photo, and a readings-only report for the previous month so the trend starts right away. Both are Issued. Files already imported are skipped."
					)}</p>`,
				},
				{
					fieldtype: "Link",
					fieldname: "customer",
					label: __("Customer"),
					options: "Customer",
					description: __("Filled in from the reports when the name matches a Customer."),
					onchange: () => this.import_files.length && this.preview_import(dialog),
				},
				{ fieldtype: "HTML", fieldname: "files" },
			],
			primary_action_label: __("Import"),
			primary_action: () => this.start_import(dialog),
		});

		this.render_import_files(dialog);
		dialog.get_primary_btn().prop("disabled", true);
		dialog.onhide = () => frappe.realtime.off("mp_word_import");
		dialog.show();
	}

	render_import_files(dialog, preview) {
		// .rw so the Workbench styles (scoped CSS variables) apply inside the dialog too.
		const $wrap = $('<div class="rw rw-dialog">').appendTo(dialog.fields_dict.files.$wrapper.empty());

		$(`<button class="btn btn-default btn-sm">${__("Add .docx files")}</button>`)
			.appendTo($wrap)
			.on("click", () => {
				new frappe.ui.FileUploader({
					allow_multiple: true,
					restrictions: { allowed_file_types: [".docx"] },
					on_success: (file) => {
						if (!this.import_files.includes(file.file_url)) this.import_files.push(file.file_url);
						clearTimeout(this._preview_timer);
						// on_success fires once per file - preview once they're all in.
						this._preview_timer = setTimeout(() => this.preview_import(dialog), 400);
					},
				});
			});

		if (!preview) return;

		const esc = frappe.utils.escape_html;
		let html = `<div class="rw-table-wrap" style="margin-top:12px"><table class="rw-table"><thead><tr>
			<th>${__("File")}</th><th>${__("Area")}</th><th>${__("Date")}</th><th>${__("Sheets")}</th>
			<th>${__("New equipment")}</th><th>${__("Previous month")}</th><th>${__("Photos")}</th><th>${__("Severity")}</th>
		</tr></thead><tbody>`;
		let total_sheets = 0;
		preview.forEach((f) => {
			if (f.error) {
				html += `<tr><td>${esc(f.file)}</td><td colspan="7" style="color:${RW_SEVERITY_HEX.Critical}">${esc(f.error)}</td></tr>`;
				return;
			}
			total_sheets += f.sheets;
			const severities = RW_SEVERITY_OPTIONS.filter((s) => f.severities[s])
				.map((s) => rw_badge(`${f.severities[s]}`, RW_SEVERITY_HEX[s]))
				.join(" ");
			const unknown = f.severities["?"] ? ` <span class="text-muted">? ${f.severities["?"]}</span>` : "";
			html += `<tr>
				<td style="white-space:normal;max-width:260px">${esc(f.file)}${
					f.existing_report ? `<div class="text-muted">${__("Already imported as {0}", [esc(f.existing_report)])}</div>` : ""
				}</td>
				<td>${esc(f.area)}${f.area_exists ? "" : ` <span class="rw-tag">${__("new")}</span>`}</td>
				<td class="rw-mono">${f.report_date ? frappe.datetime.str_to_user(f.report_date) : "—"}</td>
				<td class="rw-mono">${f.sheets}</td>
				<td class="rw-mono">${f.new_equipment}</td>
				<td class="rw-mono">${f.with_previous ? `${esc(f.previous_label)} · ${f.with_previous}` : "—"}</td>
				<td class="rw-mono">${f.photos}</td>
				<td>${severities}${unknown}</td>
			</tr>`;
			if (f.warnings.length) {
				html += `<tr><td colspan="8" style="white-space:normal;padding-top:0">
					<details><summary class="text-muted">${__("{0} note(s)", [f.warnings.length])}</summary>
					<ul style="margin:4px 0 0 16px">${f.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>
				</td></tr>`;
			}
		});
		html += `</tbody></table></div>`;
		html += `<p class="text-muted" style="margin-top:8px">${__("{0} file(s), {1} equipment sheets.", [
			preview.length,
			total_sheets,
		])}</p>`;
		$(html).appendTo($wrap);
	}

	preview_import(dialog) {
		frappe.call({
			method: "manutencao_preditiva.word_import.preview",
			args: { file_urls: this.import_files, customer: dialog.get_value("customer") || null },
			freeze: true,
			freeze_message: __("Reading the reports…"),
			callback: (r) => {
				const preview = r.message || [];
				this.import_preview = preview;
				const guess = preview.find((f) => f.customer_match);
				if (!dialog.get_value("customer") && guess) {
					dialog.fields_dict.customer.set_input(guess.customer_match);
				}
				if (!dialog.get_value("customer") && preview.length) {
					const names = [...new Set(preview.map((f) => f.customer).filter(Boolean))].join(", ");
					frappe.show_alert({
						message: __("No Customer called {0} - pick the customer to import into.", [names]),
						indicator: "orange",
					});
				}
				this.render_import_files(dialog, preview);
				dialog.get_primary_btn().prop("disabled", !preview.some((f) => !f.error));
			},
		});
	}

	start_import(dialog) {
		const customer = dialog.get_value("customer");
		if (!customer) {
			frappe.msgprint(__("Pick the customer to import into."));
			return;
		}
		const files = (this.import_preview || []).filter((f) => !f.error).map((f) => f.file_url);
		dialog.get_primary_btn().prop("disabled", true);

		// .rw so the Workbench styles (scoped CSS variables) apply inside the dialog too.
		const $wrap = $('<div class="rw rw-dialog">').appendTo(dialog.fields_dict.files.$wrapper.empty());
		const $bar = $(`<div class="progress" style="height:6px;margin:12px 0 8px">
			<div class="progress-bar" style="width:0%"></div></div>`).appendTo($wrap);
		const $status = $(`<div class="text-muted">${__("Queued…")}</div>`).appendTo($wrap);
		const $log = $('<ul style="margin:10px 0 0 16px">').appendTo($wrap);

		frappe.realtime.off("mp_word_import");
		frappe.realtime.on("mp_word_import", (data) => {
			if (data.finished) {
				$bar.find(".progress-bar").css("width", "100%");
				const failed = data.results.filter((r) => r.error).length;
				$status.text(
					failed
						? __("Finished - {0} file(s) failed, see below.", [failed])
						: __("Finished - {0} file(s) imported.", [data.results.length])
				);
				$log.empty();
				data.results.forEach((r) => {
					const text = r.error
						? `${r.file}: ${r.error}`
						: `${r.file}: ${__("{0} sheets created, {1} skipped", [r.created, r.skipped])}${
								r.report ? ` → ${r.report}` : ""
						  }`;
					$("<li>").text(text).css("color", r.error ? RW_SEVERITY_HEX.Critical : "").appendTo($log);
				});
				dialog.set_primary_action(__("Close"), () => dialog.hide());
				dialog.get_primary_btn().prop("disabled", false);
				this.load_nav_reports();
				return;
			}
			$bar.find(".progress-bar").css("width", `${Math.round(((data.index - 1) / data.total) * 100)}%`);
			$status.text(`${data.index}/${data.total} · ${data.file} · ${data.message}`);
		});

		frappe.call({
			method: "manutencao_preditiva.word_import.start_import",
			args: { file_urls: files, customer },
			callback: () => $status.text(__("Importing - you can keep working, this runs in the background.")),
			error: () => dialog.get_primary_btn().prop("disabled", false),
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
						this.load_nav_reports();
						this.select_report(r.message.name);
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
						this.render_empty_state();
						this.render_nav_list();
						this.render_report_header();
						this.load_summary();
						this.load_sheets();
					}
				);
			})
			.always(() => frappe.dom.unfreeze());
	}

	render_report_card() {
		// The one panel per screen that gets real elevation - see the CSS
		// file header for why the rest of the page stays hairline-flat. Its
		// own sub-container (not $report_card directly) is what
		// render_report_header() clears and rebuilds on every report
		// load/status toggle - render_sheets_card() appends its own
		// sub-container as a sibling of this one, so re-rendering the header
		// never wipes out the sheets section nested in the same panel.
		this.$report_card = $('<div class="rw-card rw-card-featured">').appendTo(this.$workbench);
		this.$report_header_area = $("<div>").appendTo(this.$report_card);
	}

	render_report_header() {
		const doc = this.report_doc;
		this.$report_header_area.empty();

		const $head = $('<div class="rw-report-head">').appendTo(this.$report_header_area);
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

		$('<div class="rw-badge-lg">').html(rw_badge(doc.status, RW_REPORT_STATUS_HEX[doc.status])).appendTo($head);

		if (doc.notes) {
			$('<div class="rw-notes">').text(doc.notes).appendTo(this.$report_header_area);
		}

		this.$summary_wrap = $("<div>").appendTo(this.$report_header_area);

		const $actions = $('<div class="rw-toolbar" style="margin-top:14px">').appendTo(this.$report_header_area);

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
				this.load_nav_reports();
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
		$('<div class="rw-summary-ticks">').appendTo(this.$summary_wrap);
		const $legend = $('<div class="rw-summary-legend">').appendTo(this.$summary_wrap);

		RW_SEVERITY_OPTIONS.forEach((sev) => {
			const row = rows.find((r) => r.severity === sev);
			if (!row || !row.total) return;
			const pct = (row.total / total) * 100;
			$(`<div class="rw-summary-seg" style="width:${pct}%;background:${RW_SEVERITY_HEX[sev]}">`).appendTo($bar);
			const $item = $('<div class="rw-summary-legend-item">').appendTo($legend);
			$('<span class="rw-summary-dot">').css("background", RW_SEVERITY_HEX[sev]).appendTo($item);
			$("<span>").text(`${sev} `).appendTo($item);
			$('<span class="rw-summary-value">').text(row.total).appendTo($item);
		});
	}

	// ---- sheets: every equipment covered by this report ------------------------

	render_sheets_card() {
		// Appended INSIDE the featured report panel, not a sibling card - see
		// the file header comment: one continuous panel for "this report and
		// everything in it", not a separate box with no visual relationship
		// to the report above it.
		this.$sheets_card = $('<div class="rw-panel-divider">').appendTo(this.$report_card);
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
		// Bug fixed 2026-09-23: this used to only toggle visibility - Cards
		// was never actually rendered unless it happened to be the view
		// active at the last load_sheets(), so switching to it showed an
		// empty container. render_sheets_view() re-renders from the
		// already-loaded this.sheet_rows, no network call needed.
		this.render_sheets_view();
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

	// Which equipment get a sheet is decided here, deliberately, not just
	// "every active equipment in the area" happening silently - that used
	// to be the whole rule (a live query, nothing ever recorded as "this
	// equipment belongs to this report"), with no way to leave one out for
	// a single round short of disabling it outright. This still starts
	// from the same live query, but now as a checklist someone confirms
	// (or trims) before anything is created.
	create_all_sheets() {
		this.$bulk_btn.prop("disabled", true).text(__("Loading..."));
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Equipment",
					filters: { customer: this.report_doc.customer, area: this.report_doc.area, disabled: 0 },
					fields: ["name", "machine", "description"],
					order_by: "machine, description",
					limit_page_length: 0,
				},
			})
			.then((r) => this.open_create_sheets_checklist(r.message || []))
			.always(() => this.$bulk_btn.prop("disabled", false).text(__("Create Equipment Sheets")));
	}

	open_create_sheets_checklist(equipment_rows) {
		const covered = new Set(this.sheet_rows.map((row) => row.equipment));
		const pending = equipment_rows.filter((eq) => !covered.has(eq.name));

		if (!pending.length) {
			frappe.show_alert({
				message: __("Every active equipment in this area already has a sheet"),
				indicator: "blue",
			});
			return;
		}

		const dialog = new frappe.ui.Dialog({
			title: __("Create Equipment Sheets"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "checklist_intro",
					options: `<div class="rw-checklist-intro"><span>${__(
						"Every active equipment in this area without a sheet yet - uncheck any not being inspected this round."
					)}</span><span><a href="#" class="rw-checklist-all">${__("All")}</a> / <a href="#" class="rw-checklist-none">${__(
						"None"
					)}</a></span></div>`,
				},
				{ fieldtype: "HTML", fieldname: "checklist_list", options: "" },
			],
			primary_action_label: __("Create Sheets"),
			primary_action: () => this.confirm_create_sheets(dialog),
		});

		const $list = dialog.fields_dict.checklist_list.$wrapper;
		pending.forEach((eq) => {
			const label = [eq.machine, eq.description].filter(Boolean).join(" ") || eq.name;
			$(`
				<label class="rw-checklist-row">
					<input type="checkbox" checked data-equipment="${frappe.utils.escape_html(eq.name)}">
					<span>${frappe.utils.escape_html(label)}</span>
				</label>
			`).appendTo($list);
		});

		dialog.$wrapper.find(".rw-checklist-all").on("click", (e) => {
			e.preventDefault();
			$list.find("input[type=checkbox]").prop("checked", true);
		});
		dialog.$wrapper.find(".rw-checklist-none").on("click", (e) => {
			e.preventDefault();
			$list.find("input[type=checkbox]").prop("checked", false);
		});

		dialog.show();
	}

	confirm_create_sheets(dialog) {
		const selected = [];
		dialog.fields_dict.checklist_list.$wrapper.find("input[type=checkbox]:checked").each((_, el) => {
			selected.push($(el).attr("data-equipment"));
		});
		if (!selected.length) {
			frappe.show_alert({ message: __("Select at least one equipment"), indicator: "orange" });
			return;
		}

		dialog.get_primary_btn().prop("disabled", true).text(__("Creating..."));

		let created = 0;
		// Sequential, not Promise.all - a failure (e.g. a genuine server-side
		// rejection) should stop the batch and show Frappe's own error
		// dialog, the same way any other single create in this app already
		// behaves, rather than silently racing ahead on the rest.
		selected
			.reduce(
				(chain, equipment) =>
					chain.then(() =>
						frappe
							.call({
								method: "frappe.client.insert",
								args: { doc: { doctype: "Equipment Inspection", report: this.report, equipment } },
							})
							.then(() => {
								created++;
							})
					),
				Promise.resolve()
			)
			.then(() => {
				dialog.hide();
				frappe.show_alert({ message: __("{0} sheets created", [created]), indicator: "green" });
				this.load_sheets();
				this.load_summary();
			})
			.finally(() => {
				dialog.get_primary_btn().prop("disabled", false).text(__("Create Sheets"));
			});
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

	// ---- sheet editor dialog ------------------------------------------------------
	//
	// Readings on the left (previous -> now, the change, coloured live against
	// the alarm tables as you type) with the equipment's trend underneath;
	// the diagnosis on the right. ‹ › and "Save & Next" walk through the
	// sheets in the order the list shows them, so a whole report can be
	// entered without closing the dialog.

	// The alarm limits in force (Vibration Alarm Settings), cached for the
	// page - the same values vibration.py judges with on save.
	get_alarm_limits() {
		if (!this._limits_promise) {
			this._limits_promise = frappe
				.call({ method: "frappe.client.get", args: { doctype: "Vibration Alarm Settings", name: "Vibration Alarm Settings" } })
				.then((r) => {
					const s = r.message || {};
					const bands = (s.bands || [])
						.map((b) => [b.max_power_kw, b.acceptable_mm_s, b.alarm_mm_s, b.critical_mm_s])
						.sort((a, b) => a[0] - b[0]);
					return {
						bands: bands.length ? bands : RW_DEFAULT_BANDS,
						acceleration:
							s.acceleration_acceptable && s.acceleration_alarm && s.acceleration_critical
								? [s.acceleration_acceptable, s.acceleration_alarm, s.acceleration_critical]
								: RW_DEFAULT_ACCELERATION,
					};
				})
				.catch(() => ({ bands: RW_DEFAULT_BANDS, acceleration: RW_DEFAULT_ACCELERATION }));
		}
		return this._limits_promise;
	}

	// Same rule as vibration.classify(): blank/0 is "not measured".
	classify_reading(value, limits, tolerance) {
		value = flt(value);
		if (!value || !limits) return null;
		const factor = 1 + (flt(tolerance) || 0) / 100;
		const [acceptable, alarm, critical] = limits.map((l) => l * factor);
		if (value >= critical) return "Critical";
		if (value >= alarm) return "Alarm";
		if (value >= acceptable) return "Acceptable";
		return "Normal";
	}

	velocity_limits(limits, power_kw) {
		if (!flt(power_kw)) return null;
		const band = limits.bands.find((b) => power_kw <= b[0]) || limits.bands[limits.bands.length - 1];
		return band.slice(1);
	}

	open_sheet_dialog(name, preloaded_data) {
		frappe.dom.freeze(__("Opening sheet..."));
		const doc_promise = preloaded_data
			? Promise.resolve(preloaded_data)
			: frappe.call({ method: "frappe.client.get", args: { doctype: "Equipment Inspection", name } }).then((r) => r.message);

		Promise.all([doc_promise, this.get_alarm_limits()])
			.then(([data, limits]) => {
				if (this.sheet_dialog) this.sheet_dialog.hide();
				this.show_sheet_dialog(data, limits);
			})
			.finally(() => frappe.dom.unfreeze());
	}

	show_sheet_dialog(data, limits) {
		const esc = frappe.utils.escape_html;
		const locked = this.report_doc && this.report_doc.status === "Issued";
		const order = this.get_filtered_sheet_rows().map((r) => r.name);
		const position = order.indexOf(data.name);
		const next_name = position >= 0 ? order[position + 1] : null;
		const prev_name = position > 0 ? order[position - 1] : null;

		// Own copy, stripped to the two business fields - a fetched child row's
		// name/idx/parent metadata isn't sent back. Mutated by the gallery.
		const images = (data.images || []).map((img) => ({ image: img.image, caption: img.caption || "" }));
		const state = {
			severity_mode: data.severity && data.severity !== data.suggested_severity ? "manual" : "auto",
			severity: data.severity || "",
			dirty: false,
		};

		const dialog = new frappe.ui.Dialog({
			title: __("Sheet {0}", [data.name]),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "body" }],
			primary_action_label: __("Save"),
			primary_action: () => this.save_sheet(dialog, data, state, images),
			secondary_action_label: next_name ? __("Save & Next") : null,
			secondary_action: next_name ? () => this.save_sheet(dialog, data, state, images, next_name) : null,
		});
		this.sheet_dialog = dialog;
		dialog.$wrapper.addClass("rw-sheet-dialog");

		const $body = $('<div class="rw rw-dialog rw-sheet">').appendTo(dialog.fields_dict.body.$wrapper.empty());

		// -- header: what this is, where it sits, and the walk through the list
		const $head = $('<div class="rw-sheet-head">').appendTo($body);
		const $who = $('<div class="rw-sheet-who">').appendTo($head);
		$('<div class="rw-sheet-title">').text(data.equipment_description || data.equipment).appendTo($who);
		const $meta = $('<div class="rw-report-meta">').appendTo($who);
		$(`<a href="/app/equipment/${encodeURIComponent(data.equipment)}" target="_blank">`).text(data.equipment).appendTo($("<span>").appendTo($meta));
		if (this.report_doc) {
			$("<span>").text(this.report_doc.area_name || data.area).appendTo($meta);
			$("<span>").text(this.report_doc.period_label || "").appendTo($meta);
		}
		$("<span>")
			.html(
				flt(data.power_kw)
					? `${flt(data.power_kw)} kW`
					: `<span class="rw-warn" title="${__("Set the rated power on the equipment to judge velocity against the alarm bands.")}">${__("kW not set")}</span>`
			)
			.appendTo($meta);

		const $nav = $('<div class="rw-sheet-nav">').appendTo($head);
		const nav_btn = (label, target, title) =>
			$(`<button class="rw-btn rw-btn-sm" title="${title}">${label}</button>`)
				.prop("disabled", !target)
				.on("click", () => this.leave_sheet(dialog, state, () => this.open_sheet_dialog(target)));
		nav_btn("‹", prev_name, __("Previous sheet")).appendTo($nav);
		if (position >= 0) $(`<span class="rw-sheet-pos">${position + 1} / ${order.length}</span>`).appendTo($nav);
		nav_btn("›", next_name, __("Next sheet")).appendTo($nav);
		$(`<a href="#" class="rw-sheet-full">${__("Full form")}</a>`)
			.appendTo($nav)
			.on("click", (e) => {
				e.preventDefault();
				this.leave_sheet(dialog, state, () => frappe.set_route("Form", "Equipment Inspection", data.name));
			});

		if (locked) {
			$(`<div class="rw-notes rw-sheet-lock">${__(
				"This report is Issued - the sheet is read-only. Reopen the report to Draft to change it."
			)}</div>`).appendTo($body);
		}
		if (data.readings_only) {
			$(`<div class="rw-notes">${__(
				"Readings only - history kept for the trend, with no diagnosis."
			)}</div>`).appendTo($body);
		}

		const $grid = $('<div class="rw-sheet-grid">').appendTo($body);
		const $left = $('<div class="rw-sheet-col">').appendTo($grid);
		const $right = $('<div class="rw-sheet-col">').appendTo($grid);

		// -- readings
		$(`<div class="rw-sheet-section">${__("Readings")}</div>`).appendTo($left);
		const $readings = $('<div class="rw-sheet-readings">').appendTo($left);
		const $suggested = $('<div class="rw-suggested-note">').appendTo($left);

		const readings = data.readings || [];
		if (!readings.length) {
			$readings.html(
				`<p class="text-muted">${__("This equipment has no measurement points - add them on the Equipment first.")}</p>`
			);
		} else {
			const show = (v) => (flt(v) ? `${flt(v)}` : "");
			let html = `<table class="rw-readings rw-readings-v2"><thead>
				<tr><th rowspan="2">${__("Point")}</th><th colspan="3">${__("Velocity")} (mm/s)</th>
					<th colspan="3">${__("Acceleration")} (g's)</th><th rowspan="2">${__("Temp.")} (°C)</th></tr>
				<tr><th class="rw-sub">${__("Prev.")}</th><th class="rw-sub">${__("Now")}</th><th class="rw-sub">Δ</th>
					<th class="rw-sub">${__("Prev.")}</th><th class="rw-sub">${__("Now")}</th><th class="rw-sub">Δ</th></tr>
			</thead><tbody>`;
			readings.forEach((r) => {
				html += `<tr data-point="${esc(r.point || "")}">
					<td class="rw-readings-point">${esc(r.point || "")}</td>
					<td class="rw-prev">${show(r.previous_velocity_mm_s)}</td>
					<td><input type="number" step="any" min="0" class="rw-read-velocity" value="${show(r.velocity_mm_s)}"
						data-prev="${flt(r.previous_velocity_mm_s) || ""}"></td>
					<td class="rw-delta" data-for="velocity"></td>
					<td class="rw-prev">${show(r.previous_acceleration_g)}</td>
					<td><input type="number" step="any" min="0" class="rw-read-acceleration" value="${show(r.acceleration_g)}"
						data-prev="${flt(r.previous_acceleration_g) || ""}"></td>
					<td class="rw-delta" data-for="acceleration"></td>
					<td><input type="number" step="any" class="rw-read-temp" value="${show(r.temperature_c)}"
						placeholder="${show(r.previous_temperature_c)}"></td>
				</tr>`;
			});
			html += "</tbody></table>";
			$readings.html(html);
		}

		$(`<div class="rw-sheet-section">${__("Trend")}</div>`).appendTo($left);
		const $trend = $('<div class="rw-sheet-trend">').appendTo($left);

		// -- diagnosis
		const $sev_block = $('<div class="rw-sheet-block">').appendTo($right);
		$(`<div class="rw-sheet-section">${__("Severity")}</div>`).appendTo($sev_block);
		const $sev = $('<div class="rw-sev-picker">').appendTo($sev_block);
		const $sev_hint = $('<div class="rw-sev-hint">').appendTo($sev_block);

		const $tol_row = $('<label class="rw-sheet-field rw-sheet-inline">').appendTo($sev_block);
		$(`<span>${__("Tolerance")} (%)</span>`).appendTo($tol_row);
		const $tolerance = $('<input type="number" step="any" min="0" max="10" class="rw-input rw-input-sm">')
			.val(flt(data.tolerance_percent) || "")
			.attr("placeholder", "0")
			.appendTo($tol_row);

		const textarea = (label, value, rows) => {
			const $field = $('<label class="rw-sheet-field">').appendTo($right);
			$(`<span>${label}</span>`).appendTo($field);
			return $(`<textarea class="rw-input" rows="${rows}">`).val(value || "").appendTo($field);
		};
		const $defects = textarea(__("Defects Found"), data.defects, 3);
		const $recommendations = textarea(__("Recommendations"), data.recommendations, 3);
		const $follow_up = textarea(__("Actions Taken / Follow-up"), data.follow_up, 2);

		$(`<div class="rw-sheet-section">${__("Photos")}</div>`).appendTo($right);
		const $images = $("<div>").appendTo($right);
		this.render_image_gallery($images, images);

		if (data.readings_only) $right.find(".rw-sheet-block, .rw-sheet-field").hide();

		// -- live evaluation: colours, deltas, suggested severity
		const vel_limits = this.velocity_limits(limits, flt(data.power_kw));
		const evaluate = () => {
			const tolerance = flt($tolerance.val());
			const found = [];
			$readings.find("tr[data-point]").each((_i, tr) => {
				const $tr = $(tr);
				[
					["velocity", vel_limits],
					["acceleration", limits.acceleration],
				].forEach(([kind, lim]) => {
					const $input = $tr.find(`.rw-read-${kind}`);
					const value = flt($input.val());
					const severity = this.classify_reading(value, lim, tolerance);
					if (severity) found.push(severity);
					const color = RW_SEVERITY_HEX[severity];
					$input.css({
						background: color ? rw_rgba(color, 0.14) : "",
						borderColor: color || "",
						color: color || "",
					});
					const prev = flt($input.data("prev"));
					const $delta = $tr.find(`.rw-delta[data-for="${kind}"]`);
					if (value && prev) {
						const diff = Math.round((value - prev) * 100) / 100;
						$delta
							.text(diff === 0 ? "=" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}`)
							.attr("class", `rw-delta ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`);
					} else {
						$delta.text("").attr("class", "rw-delta");
					}
				});
			});
			const ranked = ["Normal", "Acceptable", "Alarm", "Critical"];
			state.suggested = found.length ? found.reduce((a, b) => (ranked.indexOf(b) > ranked.indexOf(a) ? b : a)) : "";
			$suggested.html(
				`${__("Suggested by the readings")}: ${
					state.suggested ? rw_badge(__(state.suggested), RW_SEVERITY_HEX[state.suggested]) : "<b>—</b>"
				}${vel_limits ? "" : ` <span class="rw-warn">· ${__("velocity not judged (no kW)")}</span>`}`
			);
			render_severity();
		};

		const render_severity = () => {
			$sev.empty();
			const effective = state.severity_mode === "auto" ? state.suggested : state.severity;
			$(`<button class="rw-sev-btn ${state.severity_mode === "auto" ? "active" : ""}">${__("Auto")}</button>`)
				.appendTo($sev)
				.on("click", () => {
					state.severity_mode = "auto";
					state.dirty = true;
					render_severity();
				});
			RW_SEVERITY_OPTIONS.slice()
				.reverse()
				.forEach((sev) => {
					const active = state.severity_mode === "manual" && state.severity === sev;
					$(`<button class="rw-sev-btn ${active ? "active" : ""}">`)
						.append(`<span class="rw-badge-dot" style="background:${RW_SEVERITY_HEX[sev]}"></span>`)
						.append(document.createTextNode(__(sev)))
						.css(active ? { borderColor: RW_SEVERITY_HEX[sev], background: rw_rgba(RW_SEVERITY_HEX[sev], 0.12) } : {})
						.appendTo($sev)
						.on("click", () => {
							state.severity_mode = "manual";
							state.severity = sev;
							state.dirty = true;
							render_severity();
						});
				});
			$sev_hint.html(
				state.severity_mode === "auto"
					? `${__("Follows the readings")}: ${effective ? rw_badge(__(effective), RW_SEVERITY_HEX[effective]) : "—"}`
					: `${__("Set by the analyst - readings changes won't overwrite it.")}`
			);
		};

		$body.on("input", "input, textarea", () => (state.dirty = true));
		$readings.on("input", "input", evaluate);
		$tolerance.on("input", evaluate);
		evaluate();

		if (locked) {
			$body.find("input, textarea").prop("disabled", true);
			$sev.find("button").prop("disabled", true);
			dialog.get_primary_btn().hide();
			dialog.get_secondary_btn && dialog.get_secondary_btn().hide();
		}

		state.collect = () => ({
			readings: $readings
				.find("tr[data-point]")
				.map((_i, tr) => {
					const $tr = $(tr);
					return {
						point: $tr.attr("data-point"),
						velocity_mm_s: $tr.find(".rw-read-velocity").val() || null,
						acceleration_g: $tr.find(".rw-read-acceleration").val() || null,
						temperature_c: $tr.find(".rw-read-temp").val() || null,
					};
				})
				.get(),
			tolerance_percent: flt($tolerance.val()) || 0,
			defects: $defects.val(),
			recommendations: $recommendations.val(),
			follow_up: $follow_up.val(),
		});

		dialog.show();
		manutencao_preditiva.render_equipment_trend($trend, data.equipment);
		setTimeout(() => $readings.find("input").first().trigger("focus"), 200);
	}

	// Moving away with unsaved typing asks first.
	leave_sheet(dialog, state, go) {
		if (!state.dirty) {
			dialog.hide();
			return go();
		}
		frappe.confirm(__("Discard the changes to this sheet?"), () => {
			dialog.hide();
			go();
		});
	}

	save_sheet(dialog, data, state, images, next_name) {
		const update = Object.assign(state.collect(), { images });
		// Auto: an empty severity makes the server take the suggestion again
		// (equipment_inspection.set_severity), so switching back works too.
		update.severity = state.severity_mode === "manual" ? state.severity : "";

		dialog.disable_primary_action && dialog.disable_primary_action();
		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Equipment Inspection", name: data.name, fieldname: update },
			})
			.then(() => {
				frappe.show_alert({ message: __("Sheet {0} saved", [data.name]), indicator: "green" });
				state.dirty = false;
				this.load_sheets();
				this.load_summary();
				if (next_name) this.open_sheet_dialog(next_name);
				else dialog.hide();
			})
			.always(() => dialog.enable_primary_action && dialog.enable_primary_action());
	}
};
