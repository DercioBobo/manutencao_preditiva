// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["meus-achados"].on_page_load = function (wrapper) {
	wrapper.ma = new manutencao_preditiva.MeusAchados(wrapper);
};

frappe.pages["meus-achados"].on_page_show = function (wrapper) {
	wrapper.ma && wrapper.ma.load_entries();
};

const MA_PAGE_SIZE = 50;

const MA_SEVERIDADE_OPTIONS = ["Crítico", "Alarme", "Aceitável", "Boa Condição", "Não Recolhido"];
const MA_ESTADO_OPTIONS = ["Pendente", "Em Curso", "Concluído", "Não Aplicável"];

const MA_SEVERIDADE_BADGE = {
	Crítico: "ma-badge-critico",
	Alarme: "ma-badge-alarme",
	Aceitável: "ma-badge-aceitavel",
	"Boa Condição": "ma-badge-boa-condicao",
	"Não Recolhido": "ma-badge-nao-recolhido",
};

const MA_ESTADO_BADGE = {
	Pendente: "ma-badge-pendente",
	"Em Curso": "ma-badge-em-curso",
	Concluído: "ma-badge-concluido",
	"Não Aplicável": "ma-badge-na",
};

manutencao_preditiva.MeusAchados = class MeusAchados {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.entries = [];
		this.offset = 0;
		this.has_more = false;
		this.active_estado = "all";
		this.severity_filter = "";
		this.search_term = "";

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Meus Achados"),
			single_column: true,
		});

		this.render_shell();
	}

	render_shell() {
		this.$container = $('<div class="ma">').appendTo(this.page.body);
		$(`<div class="ma-intro">${__(
			"Achados registados nas inspeções realizadas nas suas instalações. Clique num achado para ver os detalhes e registar a sua resposta."
		)}</div>`).appendTo(this.$container);

		this.$summary = $('<div class="ma-summary">').appendTo(this.$container);
		this.render_filters();
		this.$list = $('<div class="ma-list">').appendTo(this.$container);
		this.$load_more_wrap = $('<div class="ma-load-more">').appendTo(this.$container).hide();
		this.$load_more_btn = $(`<button class="ma-btn">${__("Carregar mais")}</button>`).appendTo(this.$load_more_wrap);
		this.$load_more_btn.on("click", () => this.load_entries(true));
	}

	// ---- filters --------------------------------------------------------------

	render_filters() {
		const $bar = $('<div class="ma-filters">').appendTo(this.$container);

		this.$search = $(
			`<input type="text" class="ma-search" placeholder="${__("Pesquisar por equipamento, área, descrição...")}">`
		).appendTo($bar);
		this.$search.on("input", () => {
			this.search_term = (this.$search.val() || "").toLowerCase().trim();
			this.apply_search();
		});

		this.$severity_select = $('<select class="ma-select">').appendTo($bar);
		$(`<option value="">${__("Todas as severidades")}</option>`).appendTo(this.$severity_select);
		MA_SEVERIDADE_OPTIONS.forEach((s) => $(`<option value="${s}">${s}</option>`).appendTo(this.$severity_select));
		this.$severity_select.on("change", () => {
			this.severity_filter = this.$severity_select.val();
			this.load_entries();
		});

		this.$chips = $('<div class="ma-chips">').appendTo(this.$container);
		const chip_defs = [["all", __("Todos")]].concat(MA_ESTADO_OPTIONS.map((s) => [s, s]));
		chip_defs.forEach(([key, label]) => {
			const $chip = $(`<button class="ma-chip" data-key="${frappe.utils.escape_html(key)}">${label}</button>`).appendTo(
				this.$chips
			);
			if (key === "all") $chip.addClass("active");
			$chip.on("click", () => {
				this.active_estado = key;
				this.$chips.find(".ma-chip").removeClass("active");
				$chip.addClass("active");
				this.load_entries();
			});
		});
	}

	apply_search() {
		let visible = 0;
		this.entries.forEach((entry) => {
			const row = entry.data;
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
			const show = !this.search_term || haystack.includes(this.search_term);
			entry.$card.toggle(show);
			if (show) visible++;
		});
		this.$empty_filtered && this.$empty_filtered.remove();
		if (this.entries.length && visible === 0) {
			this.$empty_filtered = $(`<div class="ma-empty">${__("Nenhum achado corresponde à pesquisa.")}</div>`).appendTo(
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
			const estado = entry.data.estado_da_accao || "Pendente";
			counts[estado] = (counts[estado] || 0) + 1;
		});

		const parts = [`<span class="ma-summary-total">${this.entries.length} ${__("achados")}</span>`];
		MA_ESTADO_OPTIONS.forEach((estado) => {
			if (counts[estado]) {
				parts.push(`<span class="ma-badge ${MA_ESTADO_BADGE[estado]}">${counts[estado]} ${estado}</span>`);
			}
		});
		this.$summary.html(parts.join(""));
	}

	// ---- list ------------------------------------------------------------------

	refresh_list() {
		this.$list.empty();
		this.render_summary_bar();

		if (!this.entries.length) {
			this.$list.html(`<div class="ma-empty">${__("Ainda não há achados registados para o seu Cliente.")}</div>`);
			this.$load_more_wrap.hide();
			return;
		}

		this.entries.forEach((entry) => this.$list.append(entry.$card));
		this.apply_search();
		this.$load_more_wrap.toggle(this.has_more);
	}

	load_entries(append) {
		if (!append) this.offset = 0;

		const filters = {};
		if (this.active_estado !== "all") filters.estado_da_accao = this.active_estado;
		if (this.severity_filter) filters.severidade = this.severity_filter;

		this.$load_more_btn.prop("disabled", true).text(__("A carregar..."));

		frappe
			.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					filters,
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
						"imagem",
						"creation",
					],
					order_by: "creation desc",
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
				this.$load_more_btn.prop("disabled", false).text(__("Carregar mais"));
			});
	}

	build_card(entry) {
		const row = entry.data;
		const sev_class = MA_SEVERIDADE_BADGE[row.severidade] || "ma-badge-nao-recolhido";
		const estado_class = MA_ESTADO_BADGE[row.estado_da_accao] || "ma-badge-pendente";

		const $card = $('<div class="ma-card">');
		const $row = $('<div class="ma-row">').appendTo($card);

		if (row.imagem) {
			$(`<img class="ma-thumb" src="${frappe.utils.escape_html(row.imagem)}">`).appendTo($row);
		}

		const $badges = $('<div class="ma-badges">').appendTo($row);
		$(`<span class="ma-badge ${sev_class}">`).text(row.severidade || "").appendTo($badges);
		$(`<span class="ma-badge ${estado_class}">`).text(row.estado_da_accao || __("Pendente")).appendTo($badges);

		const $main = $('<div class="ma-main">').appendTo($row);
		const $title = $('<div class="ma-title">').appendTo($main);
		$title.text([row.equipamento_nome || row.equipamento_referencia, row.componente].filter(Boolean).join(" · "));
		$('<div class="ma-sub">').text(row.descricao_do_defeito || "").appendTo($main);

		const $meta = $('<div class="ma-meta">').appendTo($row);
		$("<span>").text(row.area_nome || row.area_planta || "").appendTo($meta);
		$("<span>&middot;</span>").appendTo($meta);
		$("<span>").html(comment_when(row.creation)).appendTo($meta);

		$row.on("click", () => this.open_achado_dialog(entry));

		return $card;
	}

	// ---- detail + response dialog -----------------------------------------------

	build_summary_html(data) {
		const rows = [[__("Severidade"), `<span class="ma-badge ${MA_SEVERIDADE_BADGE[data.severidade] || "ma-badge-nao-recolhido"}">${frappe.utils.escape_html(data.severidade || "")}</span>`]];

		rows.push([__("Equipamento"), frappe.utils.escape_html(data.equipamento_nome || data.equipamento_referencia || "")]);
		if (data.componente) rows.push([__("Componente"), frappe.utils.escape_html(data.componente)]);
		rows.push([__("Área / Planta"), frappe.utils.escape_html(data.area_nome || data.area_planta || "")]);
		rows.push([__("Descrição do Defeito"), frappe.utils.escape_html(data.descricao_do_defeito || "")]);
		if (data.acao_recomendada) rows.push([__("Ação Recomendada"), frappe.utils.escape_html(data.acao_recomendada)]);
		if (data.plano_de_monitorizacao)
			rows.push([__("Plano de Monitorização"), frappe.utils.escape_html(data.plano_de_monitorizacao)]);

		if (data.tecnica === "Termografia") {
			const temps = [];
			if (data.temp_max_operacao != null) temps.push(`${__("Máx. Operação")}: ${data.temp_max_operacao}°C`);
			if (data.temp_actual != null) temps.push(`${__("Actual")}: ${data.temp_actual}°C`);
			if (data.temp_ambiente != null) temps.push(`${__("Ambiente")}: ${data.temp_ambiente}°C`);
			if (temps.length) rows.push([__("Temperaturas"), temps.join(" · ")]);
		}

		let html = '<div class="ma-summary-block">';
		rows.forEach(([label, value]) => {
			html += `<div class="ma-summary-row"><div class="ma-summary-label">${label}</div><div class="ma-summary-value">${value}</div></div>`;
		});
		html += "</div>";

		if (data.imagem) {
			html += `<img class="ma-summary-image" src="${frappe.utils.escape_html(data.imagem)}">`;
		}

		return html;
	}

	open_achado_dialog(entry) {
		const name = entry.data.name;

		frappe.call({ method: "frappe.client.get", args: { doctype: "Achado De Inspecao", name } }).then((r) => {
			const data = r.message;

			Promise.all([
				data.area_planta
					? frappe.db.get_value("Area De Inspecao", data.area_planta, "area")
					: Promise.resolve({ message: {} }),
				data.equipamento_referencia
					? frappe.db.get_value("Equipamento De Inspecao", data.equipamento_referencia, "equipamento")
					: Promise.resolve({ message: {} }),
			]).then(([area_r, equip_r]) => {
				data.area_nome = area_r.message && area_r.message.area;
				data.equipamento_nome = equip_r.message && equip_r.message.equipamento;
				this.show_achado_dialog(data);
			});
		});
	}

	show_achado_dialog(data) {
		const dialog = new frappe.ui.Dialog({
			title: __("Achado {0}", [data.name]),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "resumo", options: this.build_summary_html(data) },
				{ fieldtype: "Section Break", label: __("A Sua Resposta") },
				{ fieldtype: "Small Text", fieldname: "resposta_do_cliente", label: __("Ação Tomada / Resposta") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "responsavel", label: __("Responsável") },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Date", fieldname: "prazo", label: __("Prazo") },
				{ fieldtype: "Column Break" },
				{
					fieldtype: "Select",
					fieldname: "estado_da_accao",
					label: __("Estado da Ação"),
					options: MA_ESTADO_OPTIONS.join("\n"),
				},
				{ fieldtype: "Section Break" },
				{ fieldtype: "Date", fieldname: "data_de_conclusao", label: __("Data de Conclusão") },
			],
			primary_action_label: __("Guardar Resposta"),
			primary_action: (values) => this.save_response(dialog, data.name, values),
		});

		dialog.set_values({
			resposta_do_cliente: data.resposta_do_cliente,
			responsavel: data.responsavel,
			prazo: data.prazo,
			estado_da_accao: data.estado_da_accao,
			data_de_conclusao: data.data_de_conclusao,
		});

		dialog.show();
	}

	save_response(dialog, name, values) {
		dialog.get_primary_btn().prop("disabled", true);

		frappe
			.call({
				method: "frappe.client.set_value",
				args: { doctype: "Achado De Inspecao", name, fieldname: values },
			})
			.then((r) => {
				frappe.show_alert({ message: __("Resposta guardada"), indicator: "green" });
				dialog.hide();

				const entry = this.entries.find((e) => e.data.name === name);
				if (entry) {
					entry.data = Object.assign({}, entry.data, {
						estado_da_accao: r.message.estado_da_accao,
					});
					const $old_card = entry.$card;
					entry.$card = this.build_card(entry);
					$old_card.replaceWith(entry.$card);
					this.render_summary_bar();
				}
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
