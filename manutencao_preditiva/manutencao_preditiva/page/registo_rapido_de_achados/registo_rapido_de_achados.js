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

manutencao_preditiva.RegistoRapidoDeAchados = class RegistoRapidoDeAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.campanha_info = null;
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
		this.$add_btn.on("click", () => this.open_achado_dialog({ mode: "new" }));
	}

	on_campanha_change() {
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

	// ---- list of saved entries ---------------------------------------------

	refresh_list() {
		this.$list.empty();
		if (!this.saved_entries.length) {
			const msg = this.campanha_info
				? __('Ainda sem achados. Clique em "Novo Achado" para começar.')
				: __("Selecione uma campanha para começar a registar achados.");
			this.$list.html(`<div class="rra-empty">${msg}</div>`);
			return;
		}
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
				this.saved_entries = (r.message || []).map((row) => ({ data: row }));
				this.saved_entries.forEach((entry) => {
					entry.$card = this.build_view_card(entry);
				});
				this.refresh_list();
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
		const title = [row.equipamento_referencia, row.componente].filter(Boolean).join(" · ");
		$('<div class="rra-saved-title">').text(title).appendTo($main);
		$('<div class="rra-saved-sub">').text(row.descricao_do_defeito || "").appendTo($main);

		const $meta = $('<div class="rra-saved-meta">').appendTo($row);
		const $area = $("<span>").appendTo($meta);
		this.resolve_area_label(row.area_planta, $area);
		$("<span>&middot;</span>").appendTo($meta);
		$("<span>").html(comment_when(row.creation)).appendTo($meta);

		$row.on("click", () => this.open_achado_dialog({ mode: "edit", name: row.name }));

		return $card;
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
			{ fieldtype: "Data", fieldname: "equipamento_referencia", label: __("Referência do Equipamento"), reqd: 1 },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Int", fieldname: "item", label: __("Item (Nº)") },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Small Text", fieldname: "equipamento_descricao", label: __("Descrição do Equipamento") },
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
			frappe.call({ method: "frappe.client.get", args: { doctype: "Achado De Inspecao", name } }).then((r) => {
				show_dialog(r.message);
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
				}
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
