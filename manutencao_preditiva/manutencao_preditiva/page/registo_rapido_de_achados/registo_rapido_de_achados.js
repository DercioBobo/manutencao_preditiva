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

// Mirrors achado_de_inspecao.json exactly: these are the fields shown to
// técnicos (the "Resposta do Cliente" section is deliberately excluded -
// that's for the client to fill in later, not the field operator).
const RRA_FIELD_DEFS = [
	{ fieldname: "equipamento_referencia", fieldtype: "Data", label: __("Referência do Equipamento"), reqd: 1 },
	{ fieldname: "item", fieldtype: "Int", label: __("Item (Nº)") },
	{ fieldname: "equipamento_descricao", fieldtype: "Small Text", label: __("Descrição do Equipamento"), span2: true },
	{ fieldname: "componente", fieldtype: "Data", label: __("Componente / Localização do Defeito") },
	{ fieldname: "ordem_de_servico", fieldtype: "Data", label: __("Ordem de Serviço") },
	{
		fieldname: "descricao_do_defeito",
		fieldtype: "Small Text",
		label: __("Descrição do Defeito"),
		reqd: 1,
		span2: true,
	},
	{ fieldname: "acao_recomendada", fieldtype: "Small Text", label: __("Ação Recomendada"), span2: true },
	{ fieldname: "plano_de_monitorizacao", fieldtype: "Data", label: __("Plano de Monitorização") },
	{ fieldname: "numero_da_imagem", fieldtype: "Data", label: __("Número da Imagem (Origem)") },
	{ fieldname: "imagem", fieldtype: "Attach Image", label: __("Imagem") },
];

// Only shown when the campaign's técnica is Termografia (matches the
// doctype's own depends_on on the sb_temperaturas section).
const RRA_THERMO_FIELD_DEFS = [
	{ fieldname: "temp_max_operacao", fieldtype: "Float", label: __("Temp. Máx. Operação (°C)") },
	{ fieldname: "temp_actual", fieldtype: "Float", label: __("Temp. Actual (°C)") },
	{ fieldname: "temp_ambiente", fieldtype: "Float", label: __("Temp. Ambiente (°C)") },
];

let rra_entry_seq = 0;

manutencao_preditiva.RegistoRapidoDeAchados = class RegistoRapidoDeAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.campanha_info = null;
		this.drafts = [];
		this.saved_entries = [];
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
				<span class="rra-icon-plus"></span><span>${__("Novo Achado")}</span>
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
			this.saved_entries = [];
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
		if (!this.drafts.length && !this.saved_entries.length) {
			const msg = this.campanha_info
				? __('Ainda sem achados. Clique em "Novo Achado" para começar.')
				: __("Selecione uma campanha para começar a registar achados.");
			this.$list.html(`<div class="rra-empty">${msg}</div>`);
			return;
		}
		this.drafts.forEach((entry) => this.$list.append(entry.$card));
		this.saved_entries.forEach((entry) => this.$list.append(entry.$card));
	}

	load_saved() {
		const campanha = this.campanha_control.get_value();
		if (!campanha) {
			this.saved_entries = [];
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
						"imagem",
						"creation",
					],
					order_by: "creation desc",
					limit_page_length: 50,
				},
			})
			.then((r) => {
				this.saved_entries = (r.message || []).map((row) => ({ mode: "view", data: row }));
				this.saved_entries.forEach((entry) => {
					entry.$card = this.build_view_card(entry);
				});
				this.refresh_list();
			});
	}

	// ---- shared field helpers ------------------------------------------------

	make_field(container, df, span2) {
		const $wrap = $(`<div class="rra-field${span2 ? " rra-span-2" : ""}">`).appendTo(container);
		const control = frappe.ui.form.make_control({ df, parent: $wrap[0], render_input: true });
		control.$wrapper_field = $wrap;
		control.refresh();
		return control;
	}

	build_fields(container, defs, prefill) {
		const controls = {};
		defs.forEach((def) => {
			const control = this.make_field(
				container,
				{
					fieldtype: def.fieldtype,
					fieldname: def.fieldname,
					label: def.label,
					reqd: def.reqd || 0,
				},
				def.span2
			);
			const value = prefill && prefill[def.fieldname];
			if (value !== undefined && value !== null && value !== "") control.set_value(value);
			controls[def.fieldname] = control;
		});
		return controls;
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

	// ---- editable card (used for both "new" drafts and "editing" a saved entry) --

	build_editable_card(entry) {
		const is_new = entry.mode === "new";
		const prefill = is_new ? null : entry.data;

		const $card = $(`<div class="rra-card ${is_new ? "rra-card-draft" : "rra-card-editing"}">`);
		const $header = $('<div class="rra-card-header">').appendTo($card);

		const $area_wrap = $('<div class="rra-field rra-field-area">').appendTo($header);
		entry.area_control = frappe.ui.form.make_control({
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
		entry.area_control.$wrapper_field = $area_wrap;
		entry.area_control.refresh();
		if (prefill && prefill.area_planta) {
			entry.area_control.set_value(prefill.area_planta);
		} else if (is_new && this.last_area_value) {
			entry.area_control.set_value(this.last_area_value);
		}

		const $sev_wrap = $('<div class="rra-field rra-field-severidade">').appendTo($header);
		entry.severidade_control = frappe.ui.form.make_control({
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
		entry.severidade_control.$wrapper_field = $sev_wrap;
		entry.severidade_control.refresh();
		if (prefill && prefill.severidade) entry.severidade_control.set_value(prefill.severidade);

		$('<span class="rra-card-status">').text(is_new ? __("Rascunho") : __("A Editar")).appendTo($header);

		const $actions = $('<div class="rra-card-actions">').appendTo($header);
		const $cancel = $(
			`<button class="rra-btn rra-btn-icon" title="${is_new ? __("Descartar") : __("Cancelar")}"><span class="rra-icon-close"></span></button>`
		).appendTo($actions);
		$cancel.on("click", () => (is_new ? this.discard_draft(entry) : this.cancel_edit(entry)));

		entry.$save_btn = $(
			`<button class="rra-btn rra-btn-primary">${is_new ? __("Guardar") : __("Guardar Alterações")}</button>`
		).appendTo($actions);
		entry.$save_btn.on("click", () => (is_new ? this.save_draft(entry) : this.save_edit(entry)));

		entry.$error = $('<div class="rra-card-error">').insertAfter($header);

		const $body = $('<div class="rra-card-body">').appendTo($card);
		const $grid = $('<div class="rra-grid">').appendTo($body);
		entry.fields = this.build_fields($grid, RRA_FIELD_DEFS, prefill);

		const is_termografia = !!(this.campanha_info && this.campanha_info.tecnica === "Termografia");
		entry.$thermo = $('<div class="rra-thermo-section">').appendTo($body).toggle(is_termografia);
		$('<div style="font-size:11px;font-weight:600;color:var(--rra-muted);margin-bottom:6px;">')
			.text(__("Leituras de Temperatura"))
			.appendTo(entry.$thermo);
		const $thermo_grid = $('<div class="rra-grid">').appendTo(entry.$thermo);
		const thermo_controls = this.build_fields($thermo_grid, RRA_THERMO_FIELD_DEFS, prefill);
		Object.assign(entry.fields, thermo_controls);

		const $diff_preview = $('<div class="rra-diff-preview">').appendTo(entry.$thermo);
		const update_diff_preview = () => {
			const max = parseFloat(entry.fields.temp_max_operacao.get_value());
			const actual = parseFloat(entry.fields.temp_actual.get_value());
			if (!isNaN(max) && !isNaN(actual)) {
				$diff_preview.text(__("Diferença sobre máx.: {0} °C", [(actual - max).toFixed(1)]));
			} else {
				$diff_preview.text("");
			}
		};
		thermo_controls.temp_max_operacao.$input && thermo_controls.temp_max_operacao.$input.on("input", update_diff_preview);
		thermo_controls.temp_actual.$input && thermo_controls.temp_actual.$input.on("input", update_diff_preview);
		update_diff_preview();

		return $card;
	}

	get_required_controls(entry) {
		return [
			{ control: entry.area_control, label: __("Área / Planta") },
			{ control: entry.fields.equipamento_referencia, label: __("Referência do Equipamento") },
			{ control: entry.severidade_control, label: __("Severidade") },
			{ control: entry.fields.descricao_do_defeito, label: __("Descrição do Defeito") },
		];
	}

	validate_entry(entry) {
		const missing = [];
		this.get_required_controls(entry).forEach(({ control, label }) => {
			const has_value = !!(control.get_value() || "").toString().trim();
			control.$wrapper_field && control.$wrapper_field.toggleClass("rra-invalid", !has_value);
			if (!has_value) missing.push(label);
		});

		if (missing.length) {
			entry.$error.text(__("Preencha antes de guardar: {0}", [missing.join(", ")])).addClass("rra-show");
			return false;
		}
		entry.$error.removeClass("rra-show");
		return true;
	}

	build_field_values(entry) {
		const values = {
			area_planta: entry.area_control.get_value(),
			severidade: entry.severidade_control.get_value(),
		};
		RRA_FIELD_DEFS.forEach((def) => {
			values[def.fieldname] = entry.fields[def.fieldname].get_value();
		});
		if (this.campanha_info && this.campanha_info.tecnica === "Termografia") {
			RRA_THERMO_FIELD_DEFS.forEach((def) => {
				values[def.fieldname] = entry.fields[def.fieldname].get_value();
			});
		}
		return values;
	}

	// ---- new draft: add / discard / save -----------------------------------

	add_draft() {
		const entry = { id: ++rra_entry_seq, mode: "new" };
		entry.$card = this.build_editable_card(entry);
		this.drafts.unshift(entry);
		this.refresh_list();
		entry.fields.equipamento_referencia.$input && entry.fields.equipamento_referencia.$input.focus();
	}

	discard_draft(entry) {
		const idx = this.drafts.indexOf(entry);
		if (idx > -1) this.drafts.splice(idx, 1);
		entry.$card.remove();
		if (!this.drafts.length && !this.saved_entries.length) this.refresh_list();
	}

	save_draft(entry) {
		if (!this.validate_entry(entry)) return;

		this.last_area_value = entry.area_control.get_value();
		const $save_btn = entry.$save_btn;
		$save_btn.prop("disabled", true).text(__("A guardar..."));

		frappe
			.call({
				method: "frappe.client.insert",
				args: {
					doc: Object.assign({ doctype: "Achado De Inspecao", campanha: this.campanha_control.get_value() }, this.build_field_values(entry)),
				},
			})
			.then((r) => {
				frappe.show_alert({ message: __("Achado {0} guardado", [r.message.name]), indicator: "green" });
				const idx = this.drafts.indexOf(entry);
				if (idx > -1) this.drafts.splice(idx, 1);

				const saved_entry = { mode: "view", data: r.message };
				saved_entry.$card = this.build_view_card(saved_entry);
				this.saved_entries.unshift(saved_entry);

				entry.$card.replaceWith(saved_entry.$card);
			})
			.always(() => {
				$save_btn.prop("disabled", false).text(__("Guardar"));
			});
	}

	// ---- view (saved, collapsed) card ---------------------------------------

	build_view_card(entry) {
		const row = entry.data;
		const badge_class = RRA_BADGE_CLASS[row.severidade] || "rra-badge-nao-recolhido";
		const $card = $('<div class="rra-card rra-card-saved">');
		const $row = $('<div class="rra-saved-row">').appendTo($card);

		if (row.imagem) {
			$(`<img class="rra-saved-thumb" src="${frappe.utils.escape_html(row.imagem)}">`).appendTo($row);
		}

		$(`<span class="rra-badge ${badge_class}">`).text(row.severidade || "").appendTo($row);

		const $main = $('<div class="rra-saved-main">').appendTo($row);
		const title = [row.equipamento_referencia, row.componente].filter(Boolean).join(" · ");
		$('<div class="rra-saved-title">').text(title).appendTo($main);
		$('<div class="rra-saved-sub">').text(row.descricao_do_defeito || "").appendTo($main);

		const $meta = $('<div class="rra-saved-meta">').appendTo($row);
		const $area = $("<span>").appendTo($meta);
		this.resolve_area_label(row.area_planta, $area);
		$("<span>&middot;</span>").appendTo($meta);
		$("<span>").html(comment_when(row.creation)).appendTo($meta);
		const $abrir = $(
			`<a href="/app/achado-de-inspecao/${encodeURIComponent(row.name)}" target="_blank">${__("Abrir")}</a>`
		).appendTo($meta);
		$abrir.on("click", (e) => e.stopPropagation());

		$('<span class="rra-saved-chevron">').appendTo($row);

		$row.on("click", () => this.expand_entry(entry));

		return $card;
	}

	// ---- expand a saved entry into edit mode --------------------------------

	expand_entry(entry) {
		const $old_card = entry.$card;
		$old_card.css("opacity", 0.6);
		frappe
			.call({
				method: "frappe.client.get",
				args: { doctype: "Achado De Inspecao", name: entry.data.name },
			})
			.then((r) => {
				entry.mode = "edit";
				entry.data = r.message;
				entry.$card = this.build_editable_card(entry);
				$old_card.replaceWith(entry.$card);
			})
			.always(() => {
				$old_card.css("opacity", "");
			});
	}

	cancel_edit(entry) {
		entry.mode = "view";
		const $old_card = entry.$card;
		entry.$card = this.build_view_card(entry);
		$old_card.replaceWith(entry.$card);
	}

	save_edit(entry) {
		if (!this.validate_entry(entry)) return;

		const $save_btn = entry.$save_btn;
		$save_btn.prop("disabled", true).text(__("A guardar..."));

		frappe
			.call({
				method: "frappe.client.set_value",
				args: {
					doctype: "Achado De Inspecao",
					name: entry.data.name,
					fieldname: this.build_field_values(entry),
				},
			})
			.then((r) => {
				frappe.show_alert({ message: __("Achado {0} actualizado", [entry.data.name]), indicator: "green" });
				entry.mode = "view";
				entry.data = r.message;
				const $old_card = entry.$card;
				entry.$card = this.build_view_card(entry);
				$old_card.replaceWith(entry.$card);
			})
			.always(() => {
				$save_btn.prop("disabled", false).text(__("Guardar Alterações"));
			});
	}
};
