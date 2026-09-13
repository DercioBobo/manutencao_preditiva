// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["registo-rapido-de-achados"].on_page_load = function (wrapper) {
	wrapper.rra = new manutencao_preditiva.RegistoRapidoDeAchados(wrapper);
};

frappe.pages["registo-rapido-de-achados"].on_page_show = function (wrapper) {
	wrapper.rra && wrapper.rra.load_recent();
};

const RRA_SEVERIDADE_OPTIONS = "Crítico\nAlarme\nAceitável\nBoa Condição\nNão Recolhido";

const RRA_BADGE_CLASS = {
	Crítico: "rra-badge-critico",
	Alarme: "rra-badge-alarme",
	Aceitável: "rra-badge-aceitavel",
	"Boa Condição": "rra-badge-boa-condicao",
	"Não Recolhido": "rra-badge-nao-recolhido",
};

const RRA_FINDING_FIELDS = [
	"equipamento_referencia",
	"equipamento_descricao",
	"componente",
	"severidade",
	"descricao_do_defeito",
	"acao_recomendada",
	"imagem",
	"ordem_de_servico",
	"plano_de_monitorizacao",
	"temp_max_operacao",
	"temp_actual",
	"temp_ambiente",
];

manutencao_preditiva.RegistoRapidoDeAchados = class RegistoRapidoDeAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.f = {};
		this.campanha_info = null;

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Registo Rápido de Achados"),
			single_column: true,
		});

		this.render();
	}

	render() {
		this.$container = $('<div class="rra">').appendTo(this.page.body);
		this.render_campanha_card();
		this.render_form();
		this.render_recent();
		this.on_campanha_change();
	}

	// ---- campanha / área -------------------------------------------------

	render_campanha_card() {
		const $card = $('<div class="rra-campanha-card">').appendTo(this.$container);

		const $campanha_wrap = $('<div class="rra-field">').appendTo($card);
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
		this.campanha_control.$wrapper_field = $campanha_wrap;
		this.campanha_control.refresh();

		const $area_wrap = $('<div class="rra-field">').appendTo($card);
		this.area_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "area_planta",
				label: __("Área / Planta"),
				options: "Area De Inspecao",
				reqd: 1,
				read_only: 1,
				get_query: () => ({
					filters: { cliente: this.campanha_info ? this.campanha_info.cliente : "" },
				}),
			},
			parent: $area_wrap[0],
			render_input: true,
		});
		this.area_control.$wrapper_field = $area_wrap;
		this.area_control.refresh();

		this.$campanha_info = $('<div class="rra-campanha-info">').appendTo($card);
	}

	on_campanha_change() {
		const campanha = this.campanha_control.get_value();

		if (!campanha) {
			this.campanha_info = null;
			this.$campanha_info.empty();
			this.area_control.set_value("");
			this.set_area_enabled(false);
			this.toggle_thermo_section();
			this.load_recent();
			return;
		}

		frappe.db.get_value("Campanha De Inspecao", campanha, ["cliente", "tecnica"]).then((r) => {
			this.campanha_info = r.message;
			this.$campanha_info.html(
				`${__("Cliente")}: <b>${frappe.utils.escape_html(this.campanha_info.cliente || "")}</b>` +
					`&nbsp;&middot;&nbsp;${__("Técnica")}: <b>${frappe.utils.escape_html(this.campanha_info.tecnica || "")}</b>`
			);
			this.area_control.set_value("");
			this.set_area_enabled(true);
			this.toggle_thermo_section();
			this.load_recent();
		});
	}

	set_area_enabled(enabled) {
		this.area_control.df.read_only = enabled ? 0 : 1;
		this.area_control.refresh();
	}

	toggle_thermo_section() {
		const show = !!(this.campanha_info && this.campanha_info.tecnica === "Termografia");
		this.$thermo_title && this.$thermo_title.toggle(show);
		this.$thermo && this.$thermo.toggle(show);
	}

	// ---- new finding form --------------------------------------------------

	make_field(container, df, span2) {
		const $wrap = $(`<div class="rra-field${span2 ? " rra-span-2" : ""}">`).appendTo(container);
		const control = frappe.ui.form.make_control({
			df,
			parent: $wrap[0],
			render_input: true,
		});
		control.$wrapper_field = $wrap;
		control.refresh();
		return control;
	}

	render_form() {
		this.$container.append(`<div class="rra-section-title">${__("Novo Achado")}</div>`);
		const $grid = $('<div class="rra-grid">').appendTo(this.$container);

		this.f.equipamento_referencia = this.make_field($grid, {
			fieldtype: "Data",
			fieldname: "equipamento_referencia",
			label: __("Referência do Equipamento"),
			reqd: 1,
		});
		this.f.componente = this.make_field($grid, {
			fieldtype: "Data",
			fieldname: "componente",
			label: __("Componente / Localização do Defeito"),
		});
		this.f.equipamento_descricao = this.make_field(
			$grid,
			{
				fieldtype: "Small Text",
				fieldname: "equipamento_descricao",
				label: __("Descrição do Equipamento"),
			},
			true
		);
		this.f.severidade = this.make_field($grid, {
			fieldtype: "Select",
			fieldname: "severidade",
			label: __("Severidade"),
			options: RRA_SEVERIDADE_OPTIONS,
			reqd: 1,
		});
		this.f.imagem = this.make_field($grid, {
			fieldtype: "Attach Image",
			fieldname: "imagem",
			label: __("Imagem"),
		});
		this.f.descricao_do_defeito = this.make_field(
			$grid,
			{
				fieldtype: "Small Text",
				fieldname: "descricao_do_defeito",
				label: __("Descrição do Defeito"),
				reqd: 1,
			},
			true
		);
		this.f.acao_recomendada = this.make_field(
			$grid,
			{
				fieldtype: "Small Text",
				fieldname: "acao_recomendada",
				label: __("Ação Recomendada"),
			},
			true
		);

		this.$thermo_title = $(
			`<div class="rra-section-title">${__("Leituras de Temperatura (Termografia)")}</div>`
		).appendTo(this.$container);
		this.$thermo = $('<div class="rra-grid rra-grid-3 rra-thermo-section">').appendTo(this.$container);

		this.f.ordem_de_servico = this.make_field(this.$thermo, {
			fieldtype: "Data",
			fieldname: "ordem_de_servico",
			label: __("Ordem de Serviço"),
		});
		this.f.plano_de_monitorizacao = this.make_field(this.$thermo, {
			fieldtype: "Data",
			fieldname: "plano_de_monitorizacao",
			label: __("Plano de Monitorização"),
		});
		this.f.temp_max_operacao = this.make_field(this.$thermo, {
			fieldtype: "Float",
			fieldname: "temp_max_operacao",
			label: __("Temp. Máx. Operação (°C)"),
		});
		this.f.temp_actual = this.make_field(this.$thermo, {
			fieldtype: "Float",
			fieldname: "temp_actual",
			label: __("Temp. Actual (°C)"),
		});
		this.f.temp_ambiente = this.make_field(this.$thermo, {
			fieldtype: "Float",
			fieldname: "temp_ambiente",
			label: __("Temp. Ambiente (°C)"),
		});

		const $actions = $('<div class="rra-actions">').appendTo(this.$container);
		this.$save_btn = $(`<button class="btn btn-primary btn-sm">${__("Guardar Achado")}</button>`).appendTo(
			$actions
		);
		this.$save_btn.on("click", () => this.save());
		$(
			`<span class="text-muted" style="font-size: 12px;">${__(
				"A Campanha e a Área mantêm-se seleccionadas para o próximo registo."
			)}</span>`
		).appendTo($actions);
	}

	// ---- validation + save --------------------------------------------------

	get_required_controls() {
		return [
			{ control: this.campanha_control, label: __("Campanha") },
			{ control: this.area_control, label: __("Área / Planta") },
			{ control: this.f.equipamento_referencia, label: __("Referência do Equipamento") },
			{ control: this.f.severidade, label: __("Severidade") },
			{ control: this.f.descricao_do_defeito, label: __("Descrição do Defeito") },
		];
	}

	validate() {
		const missing = [];
		this.get_required_controls().forEach(({ control, label }) => {
			const has_value = !!(control.get_value() || "").toString().trim();
			control.$wrapper_field && control.$wrapper_field.toggleClass("rra-invalid", !has_value);
			if (!has_value) missing.push(label);
		});

		if (missing.length) {
			frappe.msgprint({
				title: __("Campos obrigatórios em falta"),
				message: __("Preencha antes de guardar: {0}", [missing.join(", ")]),
				indicator: "red",
			});
			return false;
		}
		return true;
	}

	build_doc() {
		const doc = {
			doctype: "Achado De Inspecao",
			campanha: this.campanha_control.get_value(),
			area_planta: this.area_control.get_value(),
			equipamento_referencia: this.f.equipamento_referencia.get_value(),
			equipamento_descricao: this.f.equipamento_descricao.get_value(),
			componente: this.f.componente.get_value(),
			severidade: this.f.severidade.get_value(),
			descricao_do_defeito: this.f.descricao_do_defeito.get_value(),
			acao_recomendada: this.f.acao_recomendada.get_value(),
			imagem: this.f.imagem.get_value(),
		};

		if (this.campanha_info && this.campanha_info.tecnica === "Termografia") {
			Object.assign(doc, {
				ordem_de_servico: this.f.ordem_de_servico.get_value(),
				plano_de_monitorizacao: this.f.plano_de_monitorizacao.get_value(),
				temp_max_operacao: this.f.temp_max_operacao.get_value(),
				temp_actual: this.f.temp_actual.get_value(),
				temp_ambiente: this.f.temp_ambiente.get_value(),
			});
		}

		return doc;
	}

	save() {
		if (!this.validate()) return;

		this.$save_btn.prop("disabled", true).text(__("A guardar..."));

		frappe
			.call({
				method: "frappe.client.insert",
				args: { doc: this.build_doc() },
			})
			.then((r) => {
				frappe.show_alert({
					message: __("Achado {0} guardado", [r.message.name]),
					indicator: "green",
				});
				this.reset_finding_fields();
				this.load_recent();
			})
			.always(() => {
				this.$save_btn.prop("disabled", false).text(__("Guardar Achado"));
			});
	}

	reset_finding_fields() {
		RRA_FINDING_FIELDS.forEach((fieldname) => {
			this.f[fieldname] && this.f[fieldname].set_value("");
			this.f[fieldname] && this.f[fieldname].$wrapper_field && this.f[fieldname].$wrapper_field.removeClass("rra-invalid");
		});
		if (this.f.equipamento_referencia.$input) {
			this.f.equipamento_referencia.$input.focus();
		}
	}

	// ---- recent entries --------------------------------------------------

	render_recent() {
		this.$container.append(`<div class="rra-section-title">${__("Achados Recentes desta Campanha")}</div>`);
		this.$recent = $('<div class="rra-recent">').appendTo(this.$container);
	}

	load_recent() {
		if (!this.$recent) return;

		const campanha = this.campanha_control.get_value();
		if (!campanha) {
			this.$recent.html(`<div class="rra-empty">${__("Selecione uma campanha para ver os achados recentes.")}</div>`);
			return;
		}

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					filters: { campanha },
					fields: ["name", "area_planta", "equipamento_referencia", "severidade", "descricao_do_defeito", "creation"],
					order_by: "creation desc",
					limit_page_length: 15,
				},
			})
			.then((r) => {
				this.render_recent_table(r.message || []);
			});
	}

	render_recent_table(rows) {
		if (!rows.length) {
			this.$recent.html(`<div class="rra-empty">${__("Ainda sem achados registados nesta campanha.")}</div>`);
			return;
		}

		const badge_class = (sev) => RRA_BADGE_CLASS[sev] || "rra-badge-nao-recolhido";
		const rows_html = rows
			.map(
				(row) => `
			<tr>
				<td><a href="/app/achado-de-inspecao/${encodeURIComponent(row.name)}" target="_blank">${frappe.utils.escape_html(row.name)}</a></td>
				<td>${frappe.utils.escape_html(row.area_planta || "")}</td>
				<td>${frappe.utils.escape_html(row.equipamento_referencia || "")}</td>
				<td><span class="rra-badge ${badge_class(row.severidade)}">${frappe.utils.escape_html(row.severidade || "")}</span></td>
				<td>${frappe.utils.escape_html((row.descricao_do_defeito || "").slice(0, 60))}</td>
				<td>${comment_when(row.creation)}</td>
			</tr>`
			)
			.join("");

		this.$recent.html(`
			<table class="rra-recent-table">
				<thead>
					<tr>
						<th>${__("Nome")}</th>
						<th>${__("Área")}</th>
						<th>${__("Equipamento")}</th>
						<th>${__("Severidade")}</th>
						<th>${__("Defeito")}</th>
						<th>${__("Quando")}</th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
		`);
	}
};
