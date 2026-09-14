// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["meus-achados"].on_page_load = function (wrapper) {
	wrapper.ma = new manutencao_preditiva.MeusAchados(wrapper);
};

frappe.pages["meus-achados"].on_page_show = function (wrapper) {
	if (!wrapper.ma) return;
	wrapper.ma.load_entries();
	wrapper.ma.load_dashboard();
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

// Same hex values as the CSS custom properties above - frappe.Chart needs
// literal colors, it can't read CSS variables. Kept identical to the badge
// colors on purpose: severity/estado already have an established meaning
// in this app (the card badges), so the charts reuse it rather than a
// fresh categorical palette.
const MA_SEVERIDADE_HEX = {
	Crítico: "#c4453a",
	Alarme: "#d99226",
	Aceitável: "#b8a021",
	"Boa Condição": "#3a9d5b",
	"Não Recolhido": "#6b7680",
};

const MA_ESTADO_HEX = {
	Pendente: "#d99226",
	"Em Curso": "#2b6cb0",
	Concluído: "#3a9d5b",
	"Não Aplicável": "#6b7680",
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

		this.render_tabs();

		this.$tab_painel_content = $('<div class="ma-tab-content">').appendTo(this.$container);
		this.$tab_achados_content = $('<div class="ma-tab-content">').appendTo(this.$container).hide();

		this.render_dashboard_shell(this.$tab_painel_content);

		this.$summary = $('<div class="ma-summary">').appendTo(this.$tab_achados_content);
		this.render_filters(this.$tab_achados_content);
		this.$list = $('<div class="ma-list">').appendTo(this.$tab_achados_content);
		this.$load_more_wrap = $('<div class="ma-load-more">').appendTo(this.$tab_achados_content).hide();
		this.$load_more_btn = $(`<button class="ma-btn">${__("Carregar mais")}</button>`).appendTo(this.$load_more_wrap);
		this.$load_more_btn.on("click", () => this.load_entries(true));
	}

	// ---- tabs -------------------------------------------------------------------

	render_tabs() {
		const $tabs = $('<div class="ma-tabs">').appendTo(this.$container);
		this.$tab_painel = $(`<button class="ma-tab active">${__("Painel")}</button>`).appendTo($tabs);
		this.$tab_achados = $(`<button class="ma-tab">${__("Achados")}</button>`).appendTo($tabs);
		this.$tab_painel.on("click", () => this.switch_tab("painel"));
		this.$tab_achados.on("click", () => this.switch_tab("achados"));
	}

	switch_tab(tab) {
		const is_painel = tab === "painel";
		this.$tab_painel.toggleClass("active", is_painel);
		this.$tab_achados.toggleClass("active", !is_painel);
		this.$tab_painel_content.toggle(is_painel);
		this.$tab_achados_content.toggle(!is_painel);
		// frappe.Chart (used for the trend chart) can size itself to 0 if built
		// while its container is display:none - rebuild on every return to this
		// tab so it's always constructed while visible. The composition bars /
		// rankings are plain CSS and don't have this problem, so this is cheap
		// insurance, not a full page reload.
		if (is_painel) this.load_dashboard();
	}

	// ---- dashboard: stat tiles + charts -----------------------------------------

	render_dashboard_shell($parent) {
		this.$dashboard = $('<div class="ma-dashboard">').appendTo($parent);
		this.$tiles = $('<div class="ma-tiles">').appendTo(this.$dashboard);

		const $charts_row = $('<div class="ma-charts-row">').appendTo(this.$dashboard);
		this.$chart_severidade = this.make_chart_card($charts_row, __("Por Severidade"));
		this.$chart_estado = this.make_chart_card($charts_row, __("Por Estado da Ação"));

		const $rankings_row = $('<div class="ma-charts-row">').appendTo(this.$dashboard);
		this.$rank_areas = this.make_chart_card($rankings_row, __("Áreas com Mais Achados"));
		this.$rank_equipamentos = this.make_chart_card($rankings_row, __("Equipamentos com Mais Achados"));

		this.$chart_trend = this.make_chart_card(this.$dashboard, __("Achados por Campanha (Inspeção)"));
	}

	make_chart_card(container, title) {
		const $card = $('<div class="ma-chart-card">').appendTo(container);
		$('<div class="ma-chart-title">').text(title).appendTo($card);
		return $('<div class="ma-chart-body">').appendTo($card);
	}

	load_dashboard() {
		Promise.all([
			frappe.call({ method: "frappe.client.get_count", args: { doctype: "Achado De Inspecao" } }),
			frappe.call({
				method: "frappe.client.get_count",
				args: {
					doctype: "Achado De Inspecao",
					filters: { estado_da_accao: ["in", ["Pendente", "Em Curso"]] },
				},
			}),
			frappe.call({
				method: "frappe.client.get_count",
				args: { doctype: "Achado De Inspecao", filters: { severidade: "Crítico" } },
			}),
			frappe.call({
				method: "frappe.client.get_count",
				args: {
					doctype: "Achado De Inspecao",
					filters: {
						prazo: ["<", frappe.datetime.get_today()],
						estado_da_accao: ["not in", ["Concluído", "Não Aplicável"]],
					},
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					fields: ["severidade", "count(name) as total"],
					group_by: "severidade",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					fields: ["estado_da_accao", "count(name) as total"],
					group_by: "estado_da_accao",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					fields: ["campanha", "count(name) as total"],
					group_by: "campanha",
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Campanha De Inspecao",
					fields: ["name", "data_da_inspecao", "referencia_do_documento"],
					order_by: "data_da_inspecao asc",
					limit_page_length: 0,
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					fields: [
						"area_planta",
						"area_planta.area as area_nome",
						"count(`tabAchado De Inspecao`.name) as total",
					],
					group_by: "area_planta",
					order_by: "total desc",
					limit_page_length: 5,
				},
			}),
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Achado De Inspecao",
					fields: [
						"equipamento_referencia",
						"equipamento_referencia.equipamento as equipamento_nome",
						"count(`tabAchado De Inspecao`.name) as total",
					],
					group_by: "equipamento_referencia",
					order_by: "total desc",
					limit_page_length: 5,
				},
			}),
		]).then((results) => {
			const [
				total,
				pendentes,
				criticos,
				atraso,
				by_severidade,
				by_estado,
				by_campanha,
				campanhas,
				top_areas,
				top_equipamentos,
			] = results.map((r) => r.message);
			this.render_stat_tiles({
				total: total || 0,
				pendentes: pendentes || 0,
				criticos: criticos || 0,
				atraso: atraso || 0,
			});
			this.render_severidade_chart(by_severidade || []);
			this.render_estado_chart(by_estado || []);
			this.render_ranking(this.$rank_areas, top_areas || [], "area_nome", "area_planta");
			this.render_ranking(this.$rank_equipamentos, top_equipamentos || [], "equipamento_nome", "equipamento_referencia");
			this.render_trend_chart(by_campanha || [], campanhas || []);
		});
	}

	render_stat_tiles(stats) {
		this.$tiles.empty();
		const tiles = [
			[__("Total de Achados"), stats.total, ""],
			[__("Por Resolver"), stats.pendentes, "ma-tile-warning"],
			[__("Críticos"), stats.criticos, "ma-tile-critical"],
			[__("Em Atraso"), stats.atraso, "ma-tile-critical"],
		];
		tiles.forEach(([label, value, cls]) => {
			$(`<div class="ma-tile ${cls}"><div class="ma-tile-value">${value}</div><div class="ma-tile-label">${label}</div></div>`).appendTo(
				this.$tiles
			);
		});
	}

	render_empty_chart($body) {
		$body.html(`<div class="ma-empty">${__("Sem dados")}</div>`);
	}

	// Hand-built composition bar instead of frappe.Chart's "percentage" type -
	// gives full control over spacing/typography and shows the percentage
	// alongside the count, matching the rest of the page's design language
	// rather than the chart library's default look.
	render_severidade_chart(rows) {
		const items = [];
		MA_SEVERIDADE_OPTIONS.forEach((sev) => {
			const row = rows.find((r) => r.severidade === sev);
			if (row && row.total) items.push({ label: sev, value: row.total, color: MA_SEVERIDADE_HEX[sev] });
		});
		this.render_comp_bar(this.$chart_severidade, items);
	}

	render_estado_chart(rows) {
		const items = [];
		MA_ESTADO_OPTIONS.forEach((estado) => {
			const row = rows.find((r) => r.estado_da_accao === estado);
			if (row && row.total) items.push({ label: estado, value: row.total, color: MA_ESTADO_HEX[estado] });
		});
		this.render_comp_bar(this.$chart_estado, items);
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

	render_trend_chart(campanha_counts, campanhas) {
		this.$chart_trend.empty();
		const counts_by_name = {};
		campanha_counts.forEach((r) => {
			counts_by_name[r.campanha] = r.total;
		});

		const labels = [];
		const values = [];
		campanhas.forEach((c) => {
			if (!counts_by_name[c.name]) return;
			labels.push(c.data_da_inspecao ? frappe.datetime.str_to_user(c.data_da_inspecao) : c.name);
			values.push(counts_by_name[c.name]);
		});

		if (!labels.length) return this.render_empty_chart(this.$chart_trend);
		new frappe.Chart(this.$chart_trend[0], {
			data: { labels, datasets: [{ name: __("Achados"), values }] },
			type: "bar",
			height: 200,
			colors: ["#14877e"],
			valuesOverPoints: 1,
		});
	}

	// ---- filters --------------------------------------------------------------

	render_filters($parent) {
		const $bar = $('<div class="ma-filters">').appendTo($parent);

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

		this.$chips = $('<div class="ma-chips">').appendTo($parent);
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
			const fmt = (v) => Math.round(v * 100) / 100;
			const temps = [];
			if (data.temp_max_operacao != null) temps.push(`${__("Máx. Operação")}: ${fmt(data.temp_max_operacao)}°C`);
			if (data.temp_actual != null) temps.push(`${__("Actual")}: ${fmt(data.temp_actual)}°C`);
			if (data.temp_ambiente != null) temps.push(`${__("Ambiente")}: ${fmt(data.temp_ambiente)}°C`);
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
				this.load_dashboard();
			})
			.always(() => {
				dialog.get_primary_btn().prop("disabled", false);
			});
	}
};
