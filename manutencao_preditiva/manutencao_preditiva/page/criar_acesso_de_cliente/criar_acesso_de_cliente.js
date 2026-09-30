// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["criar-acesso-de-cliente"].on_page_load = function (wrapper) {
	wrapper.cac = new manutencao_preditiva.GestaoDeUtilizadores(wrapper);
};

// Must match api.PROFILES - the server is what actually enforces them.
const CAC_PROFILES = [
	{ value: "Técnico de Inspeção", hint: "Faz inspeções e relatórios." },
	{ value: "Gestor de Inspeção", hint: "Tudo o que o técnico faz, mais as permissões de gestão." },
	{ value: "Administrador", hint: "Tudo o que o gestor faz, e cria e gere os utilizadores." },
	{ value: "Cliente", hint: "Vê apenas os relatórios emitidos do seu cliente, no Portal do Cliente." },
];
const CAC_CLIENT = "Cliente";
const CAC_MIN_PASSWORD = 8;

manutencao_preditiva.GestaoDeUtilizadores = class GestaoDeUtilizadores {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.rows = [];
		this.filter_profile = "";
		this.search = "";

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Gestão de Utilizadores"),
			single_column: true,
		});

		this.render_shell();
	}

	render_shell() {
		this.$container = $('<div class="cac">').appendTo(this.page.body);

		$(`<p class="cac-intro">${__(
			"Cria logins para a equipa e para os clientes, repõe passwords e ativa ou desativa acessos. Cada pessoa recebe apenas o perfil escolhido."
		)}</p>`).appendTo(this.$container);

		const $layout = $('<div class="cac-layout">').appendTo(this.$container);
		const $aside = $('<div class="cac-aside">').appendTo($layout);
		const $main = $('<div class="cac-main">').appendTo($layout);

		this.$card = $('<div class="cac-card">').appendTo($aside);
		$(`<div class="cac-card-title">${__("Novo utilizador")}</div>`).appendTo(this.$card);
		this.render_form();

		const $panel = $('<div class="cac-panel">').appendTo($main);
		const $head = $('<div class="cac-panel-head">').appendTo($panel);
		$(`<div class="cac-card-title">${__("Utilizadores")}</div>`).appendTo($head);
		this.$count = $('<span class="cac-count">').appendTo($head);
		this.render_toolbar($panel);
		this.$accounts_wrap = $('<div class="cac-accounts-wrap">').appendTo($panel);
		this.load_accounts();
	}

	render_form() {
		const $field = (extra_class) => $(`<div class="cac-field ${extra_class || ""}">`).appendTo(this.$card);

		this.full_name_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				fieldname: "full_name",
				label: __("Nome Completo"),
			},
			parent: $field()[0],
			render_input: true,
		});
		this.full_name_control.refresh();

		this.email_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				fieldname: "email",
				label: __("Email"),
				options: "Email",
			},
			parent: $field()[0],
			render_input: true,
		});
		this.email_control.refresh();

		this.profile_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select",
				fieldname: "profile",
				label: __("Perfil"),
				options: ["", ...CAC_PROFILES.map((p) => p.value)].join("\n"),
				change: () => this.on_profile_change(),
			},
			parent: $field()[0],
			render_input: true,
		});
		this.profile_control.refresh();

		this.$customer_field = $field();
		this.customer_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "customer",
				label: __("Cliente"),
				options: "Customer",
				description: __("O cliente cujos relatórios esta pessoa poderá ver."),
			},
			parent: this.$customer_field[0],
			render_input: true,
		});
		this.customer_control.refresh();
		this.$customer_field.hide();

		this.password_control = this.make_password_control($field()[0]);

		this.send_welcome_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Check",
				fieldname: "send_welcome",
				label: __("Enviar também o link de acesso por email"),
				default: 1,
			},
			parent: $field("cac-field-check")[0],
			render_input: true,
		});
		this.send_welcome_control.refresh();
		this.send_welcome_control.set_value(1);

		this.$submit_btn = $(`<button class="cac-btn cac-btn-primary">${__("Criar Utilizador")}</button>`).appendTo(
			this.$card
		);
		this.$submit_btn.on("click", () => this.submit());
	}

	// Optional password: blank means the server generates one. A Data
	// control masked as a password, with a Mostrar/Ocultar toggle - the
	// admin is about to hand it over, so they must be able to check it.
	make_password_control(parent, extra_df) {
		const control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				fieldname: "password",
				label: __("Password"),
				placeholder: __("Deixa em branco para gerar"),
				description: __("Mínimo {0} caracteres. Em branco, é gerada uma password segura.", [CAC_MIN_PASSWORD]),
				...(extra_df || {}),
			},
			parent,
			render_input: true,
		});
		control.refresh();
		control.$input.attr({ type: "password", autocomplete: "new-password" });

		const $wrap = $('<div class="cac-password-wrap">').insertBefore(control.$input);
		control.$input.appendTo($wrap);
		const $toggle = $(`<button type="button" class="cac-password-toggle">${__("Mostrar")}</button>`).appendTo($wrap);
		$toggle.on("click", () => {
			const hidden = control.$input.attr("type") === "password";
			control.$input.attr("type", hidden ? "text" : "password");
			$toggle.text(hidden ? __("Ocultar") : __("Mostrar"));
		});
		return control;
	}

	// Mirrors the server's minimum (api.MIN_PASSWORD_LENGTH) so a short
	// password is caught before the round trip; the server still decides.
	check_password(password) {
		if (password && password.length < CAC_MIN_PASSWORD) {
			frappe.msgprint(__("A password tem de ter pelo menos {0} caracteres.", [CAC_MIN_PASSWORD]));
			return false;
		}
		return true;
	}

	on_profile_change() {
		const profile = this.profile_control.get_value();
		const hint = CAC_PROFILES.find((p) => p.value === profile)?.hint || "";
		this.profile_control.set_description(__(hint));
		this.$customer_field.toggle(profile === CAC_CLIENT);
	}

	submit() {
		const full_name = (this.full_name_control.get_value() || "").trim();
		const email = (this.email_control.get_value() || "").trim();
		const profile = this.profile_control.get_value();
		const customer = profile === CAC_CLIENT ? (this.customer_control.get_value() || "").trim() : "";
		const send_welcome = this.send_welcome_control.get_value() ? 1 : 0;
		const password = this.password_control.get_value() || "";

		if (!full_name || !email || !profile) {
			frappe.msgprint(__("Preenche o Nome, o Email e o Perfil."));
			return;
		}
		if (profile === CAC_CLIENT && !customer) {
			frappe.msgprint(__("Escolhe o cliente."));
			return;
		}
		if (!this.check_password(password)) return;

		frappe.call({
			method: "manutencao_preditiva.api.criar_utilizador",
			args: { full_name, email, profile, customer, send_welcome, password },
			freeze: true,
			freeze_message: __("A criar utilizador…"),
			callback: (r) => {
				if (!r.message) return;
				this.reset_form();
				this.show_credentials({
					title: __("Utilizador criado"),
					full_name,
					customer,
					chosen: Boolean(password),
					...r.message,
				});
				this.load_accounts();
			},
		});
	}

	reset_form() {
		this.full_name_control.set_value("");
		this.email_control.set_value("");
		this.profile_control.set_value("");
		this.customer_control.set_value("");
		this.password_control.set_value("");
		this.send_welcome_control.set_value(1);
		this.$customer_field.hide();
	}

	// ---- hand-over: credentials + how to deliver them ---------------------
	//
	// A dialog rather than a panel under the form: it's the one moment the
	// password is visible (it's never shown again), so it has to be seen,
	// and it has room for the delivery instructions next to the values.

	login_url() {
		return `${frappe.urllib.get_base_url()}/login`;
	}

	handover_message(result) {
		const first_name = (result.full_name || "").split(/\s+/)[0];
		return [
			first_name ? __("Olá {0},", [first_name]) : __("Olá,"),
			"",
			__("O teu acesso à plataforma Manutenção Preditiva está pronto:"),
			`${__("Endereço")}: ${this.login_url()}`,
			`${__("Email")}: ${result.email}`,
			`${__("Password")}: ${result.password}`,
			"",
			__("Se preferires escolher a tua própria password, usa este link:"),
			result.link,
		].join("\n");
	}

	show_credentials(result) {
		const esc = frappe.utils.escape_html;
		const dialog = new frappe.ui.Dialog({
			title: result.title,
			size: "large",
			fields: [{ fieldtype: "HTML", fieldname: "body" }],
			primary_action_label: __("Concluído"),
			primary_action: () => dialog.hide(),
		});
		dialog.$wrapper.addClass("cac-dialog");
		const $body = dialog.fields_dict.body.$wrapper.empty();

		const meta = [
			result.full_name && `<b>${esc(result.full_name)}</b>`,
			esc(result.email),
			result.profile && esc(__(result.profile)),
			result.customer && esc(result.customer),
		].filter(Boolean);
		$(`<div class="cac-hand-meta">${meta.join('<span class="cac-hand-sep">·</span>')}</div>`).appendTo($body);

		const $grid = $('<div class="cac-hand-grid">').appendTo($body);

		const $creds = $('<div class="cac-hand-creds">').appendTo($grid);
		$(`<div class="cac-hand-label">${__("Credenciais")}</div>`).appendTo($creds);
		this.build_copy_row(__("Endereço"), this.login_url(), $creds);
		this.build_copy_row(__("Email"), result.email, $creds);
		this.build_copy_row(__("Password"), result.password, $creds);
		$(`<div class="cac-hand-hint">${
			result.chosen ? __("Password definida por ti.") : __("Password gerada automaticamente.")
		} ${__("Não volta a ser mostrada depois de fechares esta janela.")}</div>`).appendTo($creds);

		$(`<div class="cac-hand-label cac-hand-label-gap">${__("Link para escolher a própria password")}</div>`).appendTo(
			$creds
		);
		this.build_copy_row(__("Link"), result.link, $creds);

		const $steps = $('<div class="cac-hand-steps">').appendTo($grid);
		$(`<div class="cac-hand-label">${__("Como entregar o acesso")}</div>`).appendTo($steps);
		const steps = [
			__("Copia a mensagem abaixo e envia-a à pessoa (WhatsApp, SMS ou email)."),
			__("A pessoa entra no endereço com o email e a password."),
			__("Se preferir outra password, usa o link - fica com a que escolher e a anterior deixa de funcionar."),
		];
		if (result.email_sent) {
			steps.push(__("Também foi enviado um email para {0} com o link.", [esc(result.email)]));
		}
		$(`<ol class="cac-hand-list">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>`).appendTo($steps);

		const message = this.handover_message(result);
		$('<textarea readonly class="cac-hand-message" rows="12">').val(message).appendTo($steps);
		$(`<button class="cac-btn cac-btn-primary cac-hand-copy">${__("Copiar mensagem")}</button>`)
			.appendTo($steps)
			.on("click", () => this.copy(message));

		dialog.show();
	}

	copy(value, $input) {
		if ($input) $input.select();
		const done = () => frappe.show_alert({ message: __("Copiado"), indicator: "green" });
		if (navigator.clipboard) {
			navigator.clipboard.writeText(value).then(done, () => document.execCommand("copy") && done());
		} else if (document.execCommand("copy")) {
			done();
		}
	}

	build_copy_row(label, value, $parent) {
		const $row = $('<div class="cac-link-row">').appendTo($parent);
		$(`<span class="cac-copy-label">${frappe.utils.escape_html(label)}</span>`).appendTo($row);
		const $input = $('<input type="text" readonly class="cac-link-input">').val(value).appendTo($row);
		const $copy_btn = $(`<button class="cac-btn">${__("Copiar")}</button>`).appendTo($row);

		$copy_btn.on("click", () => this.copy(value, $input));
	}

	// ---- existing accounts: list + manage --------------------------------

	render_toolbar($parent) {
		const $bar = $('<div class="cac-toolbar">').appendTo($parent);

		$(`<input type="search" class="cac-search" placeholder="${__("Procurar por nome ou email")}">`)
			.appendTo($bar)
			.on("input", (e) => {
				this.search = (e.target.value || "").trim().toLowerCase();
				this.render_accounts();
			});

		this.$chips = $('<div class="cac-chips">').appendTo($bar);
		[{ value: "", label: __("Todos") }, ...CAC_PROFILES.map((p) => ({ value: p.value, label: __(p.value) }))].forEach(
			(p) => {
				$(`<button class="cac-chip" data-profile="${frappe.utils.escape_html(p.value)}">`)
					.append($('<span class="cac-chip-label">').text(p.label))
					.append('<span class="cac-chip-count"></span>')
					.toggleClass("active", p.value === this.filter_profile)
					.appendTo(this.$chips)
					.on("click", () => {
						this.filter_profile = p.value;
						this.$chips.find(".cac-chip").each((_i, el) => {
							$(el).toggleClass("active", $(el).attr("data-profile") === p.value);
						});
						this.render_accounts();
					});
			}
		);
	}

	update_counts() {
		this.$count.text(this.rows.length);
		this.$chips.find(".cac-chip").each((_i, el) => {
			const profile = $(el).attr("data-profile");
			const n = profile ? this.rows.filter((r) => r.profile === profile).length : this.rows.length;
			$(el).find(".cac-chip-count").text(n);
		});
	}

	load_accounts() {
		frappe.call({
			method: "manutencao_preditiva.api.listar_utilizadores",
			callback: (r) => {
				this.rows = r.message || [];
				this.update_counts();
				this.render_accounts();
			},
		});
	}

	render_accounts() {
		this.$accounts_wrap.empty();

		const rows = this.rows.filter((row) => {
			if (this.filter_profile && row.profile !== this.filter_profile) return false;
			if (!this.search) return true;
			return `${row.full_name || ""} ${row.email}`.toLowerCase().includes(this.search);
		});

		if (!rows.length) {
			const msg = this.rows.length
				? __("Nenhum utilizador corresponde ao filtro.")
				: __("Ainda não há utilizadores criados.");
			$(`<p class="cac-empty">${msg}</p>`).appendTo(this.$accounts_wrap);
			return;
		}

		const $table_wrap = $('<div class="cac-table-wrap">').appendTo(this.$accounts_wrap);
		const $table = $('<table class="cac-table">').appendTo($table_wrap);
		$(
			`<thead><tr>
				<th>${__("Utilizador")}</th>
				<th>${__("Perfil")}</th>
				<th>${__("Cliente")}</th>
				<th>${__("Estado")}</th>
				<th class="cac-th-actions"></th>
			</tr></thead>`
		).appendTo($table);
		const $tbody = $("<tbody>").appendTo($table);

		rows.forEach((row) => this.render_account_row($tbody, row));
	}

	render_account_row($tbody, row) {
		const $tr = $("<tr>").toggleClass("cac-row-disabled", !row.enabled).appendTo($tbody);

		const name = row.full_name || row.email;
		const initials = name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0].toUpperCase())
			.join("");
		const $who = $('<div class="cac-who">').appendTo($("<td>").appendTo($tr));
		$('<span class="cac-avatar">').text(initials).appendTo($who);
		const $who_text = $('<div class="cac-who-text">').appendTo($who);
		const $who_name = $('<div class="cac-who-name">').text(name).appendTo($who_text);
		if (row.is_self) $(`<span class="cac-you">${__("tu")}</span>`).appendTo($who_name);
		$('<div class="cac-who-email">').text(row.email).appendTo($who_text);

		const profile_idx = CAC_PROFILES.findIndex((p) => p.value === row.profile);
		$("<td>")
			.append(
				row.profile
					? $(`<span class="cac-pill cac-pill-${profile_idx}">`).text(__(row.profile))
					: $('<span class="cac-dash">—</span>')
			)
			.appendTo($tr);

		$("<td>")
			.append(row.customers ? $("<span>").text(row.customers) : $('<span class="cac-dash">—</span>'))
			.appendTo($tr);

		$(`<td><span class="cac-status ${row.enabled ? "on" : "off"}">${
			row.enabled ? __("Ativo") : __("Inativo")
		}</span></td>`).appendTo($tr);

		const $actions = $('<div class="cac-row-actions">').appendTo($('<td class="cac-td-actions">').appendTo($tr));

		if (!row.manageable) {
			$(`<span class="cac-muted" title="${__(
				"Esta conta tem outras funções no sistema e só pode ser gerida pelo System Manager."
			)}">${__("Gerido pelo System Manager")}</span>`).appendTo($actions);
			return;
		}

		$(`<button class="cac-btn cac-btn-sm">${__("Repor password")}</button>`)
			.appendTo($actions)
			.on("click", () => this.reset_password(row));

		if (row.is_self) return;

		$(`<button class="cac-btn cac-btn-sm">${__("Mudar perfil")}</button>`)
			.appendTo($actions)
			.on("click", () => this.change_profile(row));

		$(`<button class="cac-btn cac-btn-sm ${row.enabled ? "cac-btn-danger" : ""}">${
			row.enabled ? __("Desativar") : __("Ativar")
		}</button>`)
			.appendTo($actions)
			.on("click", () => this.toggle_enabled(row));
	}

	reset_password(row) {
		const dialog = new frappe.ui.Dialog({
			title: `${__("Repor password")} - ${row.full_name || row.email}`,
			fields: [{ fieldtype: "HTML", fieldname: "note" }, { fieldtype: "HTML", fieldname: "password" }],
			primary_action_label: __("Repor password"),
			primary_action: () => {
				const password = password_control.get_value() || "";
				if (!this.check_password(password)) return;
				frappe.call({
					method: "manutencao_preditiva.api.repor_password",
					args: { email: row.email, password },
					freeze: true,
					freeze_message: __("A repor password…"),
					callback: (r) => {
						if (!r.message) return;
						dialog.hide();
						this.show_credentials({
							title: __("Password reposta"),
							full_name: row.full_name,
							profile: row.profile,
							customer: row.customers,
							chosen: Boolean(password),
							...r.message,
						});
					},
				});
			},
		});
		dialog.fields_dict.note.$wrapper.html(
			`<p class="cac-result-note">${__("A password atual de {0} deixa de funcionar de imediato.", [
				`<b>${frappe.utils.escape_html(row.email)}</b>`,
			])}</p>`
		);
		const password_control = this.make_password_control(dialog.fields_dict.password.$wrapper[0], {
			label: __("Nova password"),
		});
		dialog.show();
	}

	toggle_enabled(row) {
		const will_enable = !row.enabled;
		const message = will_enable
			? `${__("Ativar o acesso de")} ${frappe.utils.escape_html(row.email)}?`
			: `${__("Desativar o acesso de")} ${frappe.utils.escape_html(row.email)}? ${__(
					"As sessões abertas são terminadas de imediato."
				)}`;

		frappe.confirm(message, () => {
			frappe.call({
				method: "manutencao_preditiva.api.alternar_activo",
				args: { email: row.email, enabled: will_enable ? 1 : 0 },
				freeze: true,
				callback: (r) => {
					if (!r.message) return;
					frappe.show_alert({
						message: will_enable ? __("Acesso ativado") : __("Acesso desativado"),
						indicator: "green",
					});
					this.load_accounts();
				},
			});
		});
	}

	change_profile(row) {
		const current_customer = (row.customers || "").split(",")[0].trim();
		const dialog = new frappe.ui.Dialog({
			title: `${__("Mudar Perfil")} - ${row.full_name || row.email}`,
			fields: [
				{
					fieldtype: "Select",
					fieldname: "profile",
					label: __("Perfil"),
					options: CAC_PROFILES.map((p) => p.value).join("\n"),
					default: row.profile || "",
					reqd: 1,
				},
				{
					fieldtype: "Link",
					fieldname: "customer",
					label: __("Cliente"),
					options: "Customer",
					default: current_customer,
					depends_on: `eval:doc.profile == "${CAC_CLIENT}"`,
					mandatory_depends_on: `eval:doc.profile == "${CAC_CLIENT}"`,
				},
			],
			primary_action_label: __("Confirmar"),
			primary_action: (values) => {
				frappe.call({
					method: "manutencao_preditiva.api.mudar_perfil",
					args: { email: row.email, profile: values.profile, customer: values.customer || "" },
					freeze: true,
					callback: (r) => {
						if (!r.message) return;
						dialog.hide();
						frappe.show_alert({ message: __("Perfil alterado"), indicator: "green" });
						this.load_accounts();
					},
				});
			},
		});
		$(`<p class="cac-result-note">${__(
			"As sessões abertas desta pessoa são terminadas, para o novo perfil valer de imediato."
		)}</p>`).appendTo(dialog.body);
		dialog.show();
	}
};
