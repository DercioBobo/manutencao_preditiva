// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["registo-rapido-de-achados"].on_page_load = function (wrapper) {
	wrapper.rra = new manutencao_preditiva.RegistoRapidoDeAchados(wrapper);
};

frappe.pages["registo-rapido-de-achados"].on_page_show = function (wrapper) {
	wrapper.rra && wrapper.rra.load_saved();
};

const RRA_SEVERIDADE_OPTIONS = "Crítico\nAlarme\nAceitável\nBoa Condição\nNão Recolhido";

const RRA_BADGE_CLASS = {
	Crítico: "rra-badge-critico",
	Alarme: "rra-badge-alarme",
	Aceitável: "rra-badge-aceitavel",
	"Boa Condição": "rra-badge-boa-condicao",
	"Não Recolhido": "rra-badge-nao-recolhido",
};

let rra_draft_seq = 0;

manutencao_preditiva.RegistoRapidoDeAchados = class RegistoRapidoDeAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.campanha_info = null;
		this.drafts = [];
		this.saved_rows = [];
		this.area_name_cache = {};

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
		this.$list = $('<div class="rra-list">').appendTo(this.$container);
		this.refresh_list();
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
				${frappe.utils.icon("add", "sm")}<span>${__("Novo Achado")}</span>
			</button>
		`).appendTo($actions);
		this.$add_btn.on("click", () => this.add_draft());
	}

	on_campanha_change() {
		this.drafts = [];
		const campanha = this.campanha_control.get_value();

		if (!campanha) {
			this.campanha_info = null;
			this.$campanha_info.empty();
			this.$add_btn.prop("disabled", true);
			this.saved_rows = [];
			this.refresh_list();
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
			this.load_saved();
		});
	}

	// ---- list rendering ----------------------------------------------------

	refresh_list() {
		this.$list.empty();
		if (!this.drafts.length && !this.saved_rows.length) {
			const msg = this.campanha_info
				? __('Ainda sem achados. Clique em "Novo Achado" para começar.')
				: __("Selecione uma campanha para começar a registar achados.");
			this.$list.html(`<div class="rra-empty">${msg}</div>`);
			return;
		}
		this.drafts.forEach((draft) => this.$list.append(draft.$card));
		this.saved_rows.forEach((row) => this.$list.append(this.build_saved_card(row)));
	}

	load_saved() {
		const campanha = this.campanha_control.get_value();
		if (!campanha) {
			this.saved_rows = [];
			this.refresh_list();
			return;
		}
		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					filters: { campanha },
					fields: [
						"name",
						"area_planta",
						"equipamento_referencia",
						"componente",
						"severidade",
						"descricao_do_defeito",
						"creation",
					],
					order_by: "creation desc",
					limit_page_length: 50,
				},
			})
			.then((r) => {
				this.saved_rows = r.message || [];
				this.refresh_list();
			});
	}

	make_field(container, df, span2) {
		const $wrap = $(`<div class="rra-field${span2 ? " rra-span-2" : ""}">`).appendTo(container);
		const control = frappe.ui.form.make_control({ df, parent: $wrap[0], render_input: true });
		control.$wrapper_field = $wrap;
		control.refresh();
		return control;
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

	// ---- draft (editable) card ---------------------------------------------

	add_draft() {
		const draft = { id: ++rra_draft_seq };
		draft.$card = this.build_draft_card(draft);
		this.drafts.unshift(draft);
		this.refresh_list();
		draft.f.equipamento_referencia.$input && draft.f.equipamento_referencia.$input.focus();
	}

	build_draft_card(draft) {
		const $card = $('<div class="rra-card rra-card-draft">');
		const $header = $('<div class="rra-card-header">').appendTo($card);

		const $area_wrap = $('<div class="rra-field rra-field-area">').appendTo($header);
		draft.area_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "area_planta",
				label: __("Área / Planta"),
				options: "Area De Inspecao",
				reqd: 1,
				get_query: () => ({
					filters: { cliente: this.campanha_info ? this.campanha_info.cliente : "" },
				}),
			},
			parent: $area_wrap[0],
			render_input: true,
		});
		draft.area_control.$wrapper_field = $area_wrap;
		draft.area_control.refresh();
		if (this.last_area_value) draft.area_control.set_value(this.last_area_value);

		const $sev_wrap = $('<div class="rra-field rra-field-severidade">').appendTo($header);
		draft.severidade_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select",
				fieldname: "severidade",
				label: __("Severidade"),
				options: RRA_SEVERIDADE_OPTIONS,
				reqd: 1,
			},
			parent: $sev_wrap[0],
			render_input: true,
		});
		draft.severidade_control.$wrapper_field = $sev_wrap;
		draft.severidade_control.refresh();

		$('<span class="rra-card-status">').text(__("Rascunho")).appendTo($header);

		const $actions = $('<div class="rra-card-actions">').appendTo($header);
		const $discard = $(
			`<button class="rra-btn rra-btn-icon" title="${__("Descartar")}">${frappe.utils.icon("close", "sm")}</button>`
		).appendTo($actions);
		$discard.on("click", () => this.discard_draft(draft));

		draft.$save_btn = $(`<button class="rra-btn rra-btn-primary">${__("Guardar")}</button>`).appendTo($actions);
		draft.$save_btn.on("click", () => this.save_draft(draft));

		draft.$error = $('<div class="rra-card-error">').insertAfter($header);

		const $body = $('<div class="rra-card-body">').appendTo($card);
		const $grid = $('<div class="rra-grid">').appendTo($body);

		draft.f = {};
		draft.f.equipamento_referencia = this.make_field($grid, {
			fieldtype: "Data",
			fieldname: "equipamento_referencia",
			label: __("Referência do Equipamento"),
			reqd: 1,
		});
		draft.f.componente = this.make_field($grid, {
			fieldtype: "Data",
			fieldname: "componente",
			label: __("Componente / Localização do Defeito"),
		});
		draft.f.equipamento_descricao = this.make_field(
			$grid,
			{ fieldtype: "Small Text", fieldname: "equipamento_descricao", label: __("Descrição do Equipamento") },
			true
		);
		draft.f.descricao_do_defeito = this.make_field(
			$grid,
			{ fieldtype: "Small Text", fieldname: "descricao_do_defeito", label: __("Descrição do Defeito"), reqd: 1 },
			true
		);
		draft.f.acao_recomendada = this.make_field(
			$grid,
			{ fieldtype: "Small Text", fieldname: "acao_recomendada", label: __("Ação Recomendada") },
			true
		);
		draft.f.imagem = this.make_field($grid, {
			fieldtype: "Attach Image",
			fieldname: "imagem",
			label: __("Imagem"),
		});

		const is_termografia = !!(this.campanha_info && this.campanha_info.tecnica === "Termografia");
		draft.$thermo = $('<div class="rra-thermo-section">').appendTo($body).toggle(is_termografia);
		$('<div style="font-size:11px;font-weight:600;color:var(--rra-muted);margin-bottom:6px;">')
			.text(__("Leituras de Temperatura"))
			.appendTo(draft.$thermo);
		const $thermo_grid = $('<div class="rra-grid">').appendTo(draft.$thermo);

		draft.f.ordem_de_servico = this.make_field($thermo_grid, {
			fieldtype: "Data",
			fieldname: "ordem_de_servico",
			label: __("Ordem de Serviço"),
		});
		draft.f.plano_de_monitorizacao = this.make_field($thermo_grid, {
			fieldtype: "Data",
			fieldname: "plano_de_monitorizacao",
			label: __("Plano de Monitorização"),
		});
		draft.f.temp_max_operacao = this.make_field($thermo_grid, {
			fieldtype: "Float",
			fieldname: "temp_max_operacao",
			label: __("Temp. Máx. Operação (°C)"),
		});
		draft.f.temp_actual = this.make_field($thermo_grid, {
			fieldtype: "Float",
			fieldname: "temp_actual",
			label: __("Temp. Actual (°C)"),
		});
		draft.f.temp_ambiente = this.make_field($thermo_grid, {
			fieldtype: "Float",
			fieldname: "temp_ambiente",
			label: __("Temp. Ambiente (°C)"),
		});

		return $card;
	}

	discard_draft(draft) {
		const idx = this.drafts.indexOf(draft);
		if (idx > -1) this.drafts.splice(idx, 1);
		draft.$card.remove();
		if (!this.drafts.length && !this.saved_rows.length) this.refresh_list();
	}

	validate_draft(draft) {
		const required = [
			{ control: draft.area_control, label: __("Área / Planta") },
			{ control: draft.f.equipamento_referencia, label: __("Referência do Equipamento") },
			{ control: draft.severidade_control, label: __("Severidade") },
			{ control: draft.f.descricao_do_defeito, label: __("Descrição do Defeito") },
		];
		const missing = [];
		required.forEach(({ control, label }) => {
			const has_value = !!(control.get_value() || "").toString().trim();
			control.$wrapper_field && control.$wrapper_field.toggleClass("rra-invalid", !has_value);
			if (!has_value) missing.push(label);
		});

		if (missing.length) {
			draft.$error.text(__("Preencha antes de guardar: {0}", [missing.join(", ")])).addClass("rra-show");
			return false;
		}
		draft.$error.removeClass("rra-show");
		return true;
	}

	build_draft_doc(draft) {
		const doc = {
			doctype: "Achado De Inspecao",
			campanha: this.campanha_control.get_value(),
			area_planta: draft.area_control.get_value(),
			equipamento_referencia: draft.f.equipamento_referencia.get_value(),
			equipamento_descricao: draft.f.equipamento_descricao.get_value(),
			componente: draft.f.componente.get_value(),
			severidade: draft.severidade_control.get_value(),
			descricao_do_defeito: draft.f.descricao_do_defeito.get_value(),
			acao_recomendada: draft.f.acao_recomendada.get_value(),
			imagem: draft.f.imagem.get_value(),
		};

		if (this.campanha_info && this.campanha_info.tecnica === "Termografia") {
			Object.assign(doc, {
				ordem_de_servico: draft.f.ordem_de_servico.get_value(),
				plano_de_monitorizacao: draft.f.plano_de_monitorizacao.get_value(),
				temp_max_operacao: draft.f.temp_max_operacao.get_value(),
				temp_actual: draft.f.temp_actual.get_value(),
				temp_ambiente: draft.f.temp_ambiente.get_value(),
			});
		}

		return doc;
	}

	save_draft(draft) {
		if (!this.validate_draft(draft)) return;

		this.last_area_value = draft.area_control.get_value();
		draft.$save_btn.prop("disabled", true).text(__("A guardar..."));

		frappe
			.call({
				method: "frappe.client.insert",
				args: { doc: this.build_draft_doc(draft) },
			})
			.then((r) => {
				frappe.show_alert({ message: __("Achado {0} guardado", [r.message.name]), indicator: "green" });
				const idx = this.drafts.indexOf(draft);
				if (idx > -1) this.drafts.splice(idx, 1);
				this.saved_rows.unshift(r.message);
				draft.$card.replaceWith(this.build_saved_card(r.message));
			})
			.always(() => {
				draft.$save_btn.prop("disabled", false).text(__("Guardar"));
			});
	}

	// ---- saved (read-only summary) card -------------------------------------

	build_saved_card(row) {
		const badge_class = RRA_BADGE_CLASS[row.severidade] || "rra-badge-nao-recolhido";
		const $card = $('<div class="rra-card rra-card-saved">');
		const $row = $('<div class="rra-saved-row">').appendTo($card);

		$(`<span class="rra-badge ${badge_class}">`).text(row.severidade || "").appendTo($row);

		const $main = $('<div class="rra-saved-main">').appendTo($row);
		const title = [row.equipamento_referencia, row.componente].filter(Boolean).join(" · ");
		$('<div class="rra-saved-title">').text(title).appendTo($main);
		$('<div class="rra-saved-sub">').text(row.descricao_do_defeito || "").appendTo($main);

		const $meta = $('<div class="rra-saved-meta">').appendTo($row);
		const $area = $("<span>").appendTo($meta);
		this.resolve_area_label(row.area_planta, $area);
		$("<span>&middot;</span>").appendTo($meta);
		$("<span>").text(comment_when(row.creation)).appendTo($meta);
		$(`<a href="/app/achado-de-inspecao/${encodeURIComponent(row.name)}" target="_blank">${__("Abrir")}</a>`).appendTo(
			$meta
		);

		return $card;
	}
};
