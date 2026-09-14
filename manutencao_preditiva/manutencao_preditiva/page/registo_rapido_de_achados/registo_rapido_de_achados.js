// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["registo-rapido-de-achados"].on_page_load = function (wrapper) {
	wrapper.rra = new manutencao_preditiva.RegistoRapidoDeAchados(wrapper);
};

frappe.pages["registo-rapido-de-achados"].on_page_show = function (wrapper) {
	wrapper.rra && wrapper.rra.load_saved();
};

const RRA_PAGE_SIZE = 50;

const RRA_SEVERIDADE_OPTIONS = "Crítico\nAlarme\nAceitável\nBoa Condição\nNão Recolhido";
const RRA_SEVERIDADES = RRA_SEVERIDADE_OPTIONS.split("\n");

const RRA_BADGE_CLASS = {
	Crítico: "rra-badge-critico",
	Alarme: "rra-badge-alarme",
	Aceitável: "rra-badge-aceitavel",
	"Boa Condição": "rra-badge-boa-condicao",
	"Não Recolhido": "rra-badge-nao-recolhido",
};

const RRA_ESTADO_OPTIONS = ["Pendente", "Em Curso", "Concluído", "Não Aplicável"];

const RRA_ESTADO_BADGE_CLASS = {
	Pendente: "rra-badge-pendente",
	"Em Curso": "rra-badge-em-curso",
	Concluído: "rra-badge-concluido",
	"Não Aplicável": "rra-badge-na",
};

manutencao_preditiva.RegistoRapidoDeAchados = class RegistoRapidoDeAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.campanha_info = null;
		this.saved_entries = [];
		this.saved_offset = 0;
		this.saved_has_more = false;
		this.active_severity = "all";
		this.search_term = "";
		this.area_name_cache = {};
		this.equipamento_name_cache = {};

		this.table_rows = null;
		this.table_sort = { field: "creation", dir: "desc" };
		this.table_filters = { equipamento: "", area: "", severidade: "", estado: "" };

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Registo Rápido de Achados"),
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
		this.$load_more_btn = $(`<button class="rra-btn rra-btn-ghost">${__("Carregar mais")}</button>`).appendTo(
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
		this.$view_table_btn = $(`<button class="rra-view-btn">${__("Tabela")}</button>`).appendTo($toggle);
		this.$view_cards_btn = $(`<button class="rra-view-btn">${__("Cartões")}</button>`).appendTo($toggle);
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

	// ---- toolbar: campanha + "novo achado" -------------------------------

	render_toolbar() {
		const $toolbar = $('<div class="rra-toolbar">').appendTo(this.$container);
		const $fields = $('<div class="rra-toolbar-fields">').appendTo($toolbar);

		const $campanha_wrap = $('<div class="rra-field">').appendTo($fields);
		this.campanha_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "campanha",
				label: __("Campanha"),
				options: "Campanha De Inspecao",
				reqd: 1,
				get_query: () => ({ filters: { status: "Em Curso" } }),
				onchange: () => this.on_campanha_change(),
			},
			parent: $campanha_wrap[0],
			render_input: true,
		});
		this.campanha_control.refresh();

		this.$campanha_info = $('<div class="rra-campanha-info">').appendTo($fields);

		const $actions = $('<div class="rra-toolbar-actions">').appendTo($toolbar);
		this.$add_btn = $(`
			<button class="rra-btn rra-btn-primary" disabled>
				<span class="rra-icon-plus"></span><span>${__("Novo Achado")}</span>
			</button>
		`).appendTo($actions);
		this.$add_btn.on("click", () => this.open_achado_dialog({ mode: "new" }));
	}

	on_campanha_change() {
		const campanha = this.campanha_control.get_value();
		this.table_rows = null; // scoped per-campanha - stale once the selection changes

		if (!campanha) {
			this.campanha_info = null;
			this.$campanha_info.empty();
			this.$add_btn.prop("disabled", true);
			this.saved_entries = [];
			this.refresh_list();
			if (this.view_mode === "table") this.load_table_data();
			return;
		}

		frappe.db.get_value("Campanha De Inspecao", campanha, ["cliente", "tecnica"]).then((r) => {
			this.campanha_info = r.message;
			this.$campanha_info.html(
				`${__("Cliente")}: <b>${frappe.utils.escape_html(this.campanha_info.cliente || "")}</b>` +
					`&nbsp;&middot;&nbsp;${__("Técnica")}: <b>${frappe.utils.escape_html(this.campanha_info.tecnica || "")}</b>`
			);
			this.$add_btn.prop("disabled", false);
			this.last_area_value = "";
			if (this.view_mode === "table") this.load_table_data();
			this.load_saved();
		});
	}

	// ---- filters: search + severity chips -----------------------------------

	render_filters() {
		this.$filters = $('<div class="rra-filters">').appendTo(this.$card_view);

		this.$search = $(
			`<input type="text" class="rra-search" placeholder="${__("Pesquisar por equipamento, área, descrição...")}">`
		).appendTo(this.$filters);
		this.$search.on("input", () => {
			this.search_term = (this.$search.val() || "").toLowerCase().trim();
			this.apply_filters();
		});

		this.$chips = $('<div class="rra-chips">').appendTo(this.$filters);
		const chip_defs = [["all", __("Todos")]].concat(RRA_SEVERIDADES.map((s) => [s, s]));
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
			const matches_severity = this.active_severity === "all" || row.severidade === this.active_severity;
			const haystack = [
				row.equipamento_nome || row.equipamento_referencia,
				row.area_nome || row.area_planta,
				row.componente,
				row.descricao_do_defeito,
				row.severidade,
			]
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
			this.$empty_filtered = $(`<div class="rra-empty">${__("Nenhum achado corresponde ao filtro.")}</div>`).appendTo(
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
			const sev = entry.data.severidade;
			counts[sev] = (counts[sev] || 0) + 1;
		});

		const parts = [`<span class="rra-summary-total">${this.saved_entries.length} ${__("achados")}</span>`];
		RRA_SEVERIDADES.forEach((sev) => {
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
			const msg = this.campanha_info
				? __('Ainda sem achados. Clique em "Novo Achado" para começar.')
				: __("Selecione uma campanha para começar a registar achados.");
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
		const campanha = this.campanha_control.get_value();
		if (!campanha) {
			this.saved_entries = [];
			this.saved_offset = 0;
			this.saved_has_more = false;
			this.refresh_list();
			return;
		}
		if (!append) this.saved_offset = 0;

		this.$load_more_btn.prop("disabled", true).text(__("A carregar..."));

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					filters: { campanha },
					fields: [
						"name",
						"area_planta",
						"area_planta.area as area_nome",
						"equipamento_referencia",
						"equipamento_referencia.equipamento as equipamento_nome",
						"componente",
						"severidade",
						"descricao_do_defeito",
						"imagem",
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
				this.$load_more_btn.prop("disabled", false).text(__("Carregar mais"));
			});
	}

	resolve_area_label(code, $el) {
		if (!code) {
			$el.text("");
			return;
		}
		if (this.area_name_cache[code]) {
			$el.text(this.area_name_cache[code]);
			return;
		}
		$el.text(code);
		frappe.db.get_value("Area De Inspecao", code, "area").then((r) => {
			const label = (r.message && r.message.area) || code;
			this.area_name_cache[code] = label;
			$el.text(label);
		});
	}

	resolve_equipamento_label(code, $el) {
		if (!code) {
			$el.text("");
			return;
		}
		if (this.equipamento_name_cache[code]) {
			$el.text(this.equipamento_name_cache[code]);
			return;
		}
		$el.text(code);
		frappe.db.get_value("Equipamento De Inspecao", code, "equipamento").then((r) => {
			const label = (r.message && r.message.equipamento) || code;
			this.equipamento_name_cache[code] = label;
			$el.text(label);
		});
	}

	// ---- saved (summary) card ------------------------------------------------

	build_view_card(entry) {
		const row = entry.data;
		const badge_class = RRA_BADGE_CLASS[row.severidade] || "rra-badge-nao-recolhido";
		const $card = $('<div class="rra-card">');
		const $row = $('<div class="rra-saved-row">').appendTo($card);

		if (row.imagem) {
			$(`<img class="rra-saved-thumb" src="${frappe.utils.escape_html(row.imagem)}">`).appendTo($row);
		}

		$(`<span class="rra-badge ${badge_class}">`).text(row.severidade || "").appendTo($row);

		const $main = $('<div class="rra-saved-main">').appendTo($row);
		const $title = $('<div class="rra-saved-title">').appendTo($main);
		const $equip = $("<span>").appendTo($title);
		if (row.equipamento_nome) {
			$equip.text(row.equipamento_nome);
		} else {
			this.resolve_equipamento_label(row.equipamento_referencia, $equip);
		}
		if (row.componente) $title.append(document.createTextNode(" · " + row.componente));
		$('<div class="rra-saved-sub">').text(row.descricao_do_defeito || "").appendTo($main);

		const $meta = $('<div class="rra-saved-meta">').appendTo($row);
		const $area = $("<span>").appendTo($meta);
		if (row.area_nome) {
			$area.text(row.area_nome);
		} else {
			this.resolve_area_label(row.area_planta, $area);
		}
		$("<span>&middot;</span>").appendTo($meta);
		$("<span>").html(comment_when(row.creation)).appendTo($meta);

		$row.on("click", () => this.open_achado_dialog({ mode: "edit", name: row.name }));

		return $card;
	}

	// ---- table view: sortable columns + per-column filters --------------------
	// Scoped to the currently selected Campanha, same as the card list.

	get_table_columns() {
		return [
			{
				field: "severidade",
				label: __("Severidade"),
				sortable: true,
				filter: "select",
				filterKey: "severidade",
				options: RRA_SEVERIDADES,
			},
			{ field: "equipamento_nome", label: __("Equipamento"), sortable: true, filter: "text", filterKey: "equipamento" },
			{ field: "componente", label: __("Componente") },
			{ field: "area_nome", label: __("Área / Planta"), sortable: true, filter: "text", filterKey: "area" },
			{
				field: "estado_da_accao",
				label: __("Estado"),
				sortable: true,
				filter: "select",
				filterKey: "estado",
				options: RRA_ESTADO_OPTIONS,
			},
			{ field: "descricao_do_defeito", label: __("Descrição do Defeito") },
			{ field: "creation", label: __("Quando"), sortable: true },
		];
	}

	render_table_shell() {
		this.$table_view = $('<div class="rra-table-wrap">').appendTo(this.$container).hide();
		this.$table_view.html(`<div class="rra-empty">${__("Selecione uma campanha para ver a tabela.")}</div>`);
	}

	load_table_data() {
		const campanha = this.campanha_control.get_value();
		if (!campanha) {
			this.table_rows = null;
			this.$table_view.html(`<div class="rra-empty">${__("Selecione uma campanha para ver a tabela.")}</div>`);
			return;
		}

		this.$table_view.html(`<div class="rra-empty">${__("A carregar...")}</div>`);

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					filters: { campanha },
					fields: [
						"name",
						"area_planta",
						"area_planta.area as area_nome",
						"equipamento_referencia",
						"equipamento_referencia.equipamento as equipamento_nome",
						"componente",
						"severidade",
						"descricao_do_defeito",
						"estado_da_accao",
						"creation",
					],
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
				const $input = $(`<input type="text" class="rra-table-filter-input" placeholder="${__("Filtrar...")}">`).appendTo(
					$td
				);
				$input.val(this.table_filters[col.filterKey] || "");
				$input.on("input", () => {
					this.table_filters[col.filterKey] = $input.val();
					this.render_table_rows();
				});
			} else if (col.filter === "select") {
				const $select = $('<select class="rra-table-filter-input">').appendTo($td);
				$(`<option value="">${__("Todas")}</option>`).appendTo($select);
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
		if (field === "severidade") return RRA_SEVERIDADES.indexOf(row.severidade);
		if (field === "estado_da_accao") return RRA_ESTADO_OPTIONS.indexOf(row.estado_da_accao || "Pendente");
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
			if (this.table_filters.equipamento) {
				const v = (row.equipamento_nome || row.equipamento_referencia || "").toLowerCase();
				if (!v.includes(this.table_filters.equipamento.toLowerCase())) return false;
			}
			if (this.table_filters.area) {
				const v = (row.area_nome || row.area_planta || "").toLowerCase();
				if (!v.includes(this.table_filters.area.toLowerCase())) return false;
			}
			if (this.table_filters.severidade && row.severidade !== this.table_filters.severidade) return false;
			if (this.table_filters.estado && (row.estado_da_accao || "Pendente") !== this.table_filters.estado) return false;
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
				.html(`<div class="rra-empty">${__("Nenhum achado corresponde ao filtro.")}</div>`)
				.appendTo($empty_row);
			return;
		}

		rows.forEach((row) => {
			const $tr = $("<tr>").appendTo(this.$table_tbody);
			columns.forEach((col) => {
				const $td = $("<td>").appendTo($tr);
				if (col.field === "severidade") {
					const cls = RRA_BADGE_CLASS[row.severidade] || "rra-badge-nao-recolhido";
					$(`<span class="rra-badge ${cls}">`).text(row.severidade || "").appendTo($td);
				} else if (col.field === "estado_da_accao") {
					const estado = row.estado_da_accao || __("Pendente");
					const cls = RRA_ESTADO_BADGE_CLASS[row.estado_da_accao] || "rra-badge-pendente";
					$(`<span class="rra-badge ${cls}">`).text(estado).appendTo($td);
				} else if (col.field === "creation") {
					$td.html(comment_when(row.creation));
				} else {
					$td.text(row[col.field] || "").attr("title", row[col.field] || "");
				}
			});
			$tr.on("click", () => this.open_achado_dialog({ mode: "edit", name: row.name }));
		});
	}

	// ---- create / edit dialog ------------------------------------------------

	get_dialog_fields() {
		const is_termografia = !!(this.campanha_info && this.campanha_info.tecnica === "Termografia");

		const fields = [
			{
				fieldtype: "Link",
				fieldname: "area_planta",
				label: __("Área / Planta"),
				options: "Area De Inspecao",
				reqd: 1,
				get_query: () => ({
					filters: { cliente: this.campanha_info ? this.campanha_info.cliente : "" },
				}),
			},
			{
				fieldtype: "Select",
				fieldname: "severidade",
				label: __("Severidade"),
				options: RRA_SEVERIDADE_OPTIONS,
				reqd: 1,
			},
			{ fieldtype: "Section Break" },
			{
				fieldtype: "Link",
				fieldname: "equipamento_referencia",
				label: __("Referência do Equipamento"),
				options: "Equipamento De Inspecao",
				reqd: 1,
				get_query: () => ({
					filters: { cliente: this.campanha_info ? this.campanha_info.cliente : "" },
				}),
			},
			{ fieldtype: "Column Break" },
			{ fieldtype: "Int", fieldname: "item", label: __("Item (Nº)") },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Data", fieldname: "componente", label: __("Componente / Localização do Defeito") },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Data", fieldname: "ordem_de_servico", label: __("Ordem de Serviço") },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Small Text", fieldname: "descricao_do_defeito", label: __("Descrição do Defeito"), reqd: 1 },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Small Text", fieldname: "acao_recomendada", label: __("Ação Recomendada") },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Data", fieldname: "plano_de_monitorizacao", label: __("Plano de Monitorização") },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Attach Image", fieldname: "imagem", label: __("Imagem") },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Data", fieldname: "numero_da_imagem", label: __("Número da Imagem (Origem)") },
		];

		if (is_termografia) {
			fields.push(
				{ fieldtype: "Section Break", label: __("Leituras de Temperatura") },
				{ fieldtype: "Float", fieldname: "temp_max_operacao", label: __("Temp. Máx. Operação (°C)") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Float", fieldname: "temp_actual", label: __("Temp. Actual (°C)") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Float", fieldname: "temp_ambiente", label: __("Temp. Ambiente (°C)") }
			);
		}

		return fields;
	}

	open_achado_dialog({ mode, name }) {
		const is_new = mode === "new";

		const show_dialog = (data) => {
			const dialog = new frappe.ui.Dialog({
				title: is_new ? __("Novo Achado") : __("Editar Achado {0}", [name]),
				size: "large",
				fields: this.get_dialog_fields(),
				primary_action_label: is_new ? __("Guardar") : __("Guardar Alterações"),
				primary_action: (values) => {
					if (is_new) {
						this.create_achado(dialog, values);
					} else {
						this.update_achado(dialog, name, values);
					}
				},
			});

			if (data) {
				dialog.set_values(data);
			} else if (this.last_area_value) {
				dialog.set_value("area_planta", this.last_area_value);
			}

			dialog.show();
		};

		if (is_new) {
			show_dialog(null);
		} else {
			// Fetching the full doc takes a couple hundred ms - freeze so the
			// click gets instant feedback and a second click (no visible
			// reaction otherwise) can't fire a duplicate fetch/dialog.
			frappe.dom.freeze(__("A abrir achado..."));
			frappe
				.call({ method: "frappe.client.get", args: { doctype: "Achado De Inspecao", name } })
				.then((r) => {
					show_dialog(r.message);
				})
				.always(() => {
					frappe.dom.unfreeze();
				});
		}
	}

	create_achado(dialog, values) {
		dialog.get_primary_btn().prop("disabled", true);

		frappe
			.call({
				method: "frappe.client.insert",
				args: {
					doc: Object.assign(
						{ doctype: "Achado De Inspecao", campanha: this.campanha_control.get_value() },
						values
					),
				},
			})
			.then((r) => {
				frappe.show_alert({ message: __("Achado {0} guardado", [r.message.name]), indicator: "green" });
				this.last_area_value = values.area_planta;
				dialog.hide();

				const entry = { data: r.message };
				entry.$card = this.build_view_card(entry);
				this.saved_entries.unshift(entry);
				this.refresh_list();
				if (this.table_rows) this.load_table_data();
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}

	update_achado(dialog, name, values) {
		dialog.get_primary_btn().prop("disabled", true);

		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Achado De Inspecao", name, fieldname: values },
			})
			.then((r) => {
				frappe.show_alert({ message: __("Achado {0} actualizado", [name]), indicator: "green" });
				dialog.hide();

				const entry = this.saved_entries.find((e) => e.data.name === name);
				if (entry) {
					entry.data = r.message;
					const $old_card = entry.$card;
					entry.$card = this.build_view_card(entry);
					$old_card.replaceWith(entry.$card);
					this.apply_filters();
				}
				if (this.table_rows) this.load_table_data();
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
