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
	{ value: "Administrador", hint: "Cria e gere os utilizadores nesta página." },
	{ value: "Cliente", hint: "Vê apenas os relatórios emitidos do seu cliente, no Portal do Cliente." },
];
const CAC_CLIENT = "Cliente";

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

		this.$card = $('<div class="cac-card">').appendTo(this.$container);
		this.render_form();

		this.$result = $('<div class="cac-result">').appendTo(this.$container).hide();

		$('<h3 class="cac-section-title">').text(__("Utilizadores")).appendTo(this.$container);
		this.render_toolbar();
		this.$accounts_wrap = $('<div class="cac-accounts-wrap">').appendTo(this.$container);
		this.load_accounts();
	}

	render_form() {
		const $field = (extra_class) => $(`<div class="cac-field ${extra_class || ""}">`).appendTo(this.$card);

		this.full_name_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				fieldname: "full_name",
				label: __("Nome Completo"),
				reqd: 1,
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
				reqd: 1,
				description: __("Vai ser o email de login."),
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
				reqd: 1,
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
				reqd: 1,
				description: __("O cliente cujos relatórios esta pessoa poderá ver."),
			},
			parent: this.$customer_field[0],
			render_input: true,
		});
		this.customer_control.refresh();
		this.$customer_field.hide();

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

		if (!full_name || !email || !profile) {
			frappe.msgprint(__("Preenche o Nome, o Email e o Perfil."));
			return;
		}
		if (profile === CAC_CLIENT && !customer) {
			frappe.msgprint(__("Escolhe o cliente."));
			return;
		}

		frappe.call({
			method: "manutencao_preditiva.api.criar_utilizador",
			args: { full_name, email, profile, customer, send_welcome },
			freeze: true,
			freeze_message: __("A criar utilizador…"),
			callback: (r) => {
				if (!r.message) return;
				this.render_result(r.message, { full_name, customer });
				this.load_accounts();
			},
		});
	}

	reset_form() {
		this.full_name_control.set_value("");
		this.email_control.set_value("");
		this.profile_control.set_value("");
		this.customer_control.set_value("");
		this.send_welcome_control.set_value(1);
		this.$customer_field.hide();
		this.$result.hide().empty();
	}

	render_result(result, { full_name, customer }) {
		this.$result.empty().show();

		$(`<div class="cac-result-title">✓ ${__("Utilizador criado")}: ${frappe.utils.escape_html(full_name)}</div>`).appendTo(
			this.$result
		);

		const $meta = $('<div class="cac-result-meta">').appendTo(this.$result);
		$(`<span>${__("Email")}: <b>${frappe.utils.escape_html(result.email)}</b></span>`).appendTo($meta);
		$(`<span>${__("Perfil")}: <b>${frappe.utils.escape_html(result.profile)}</b></span>`).appendTo($meta);
		if (customer) {
			$(`<span>${__("Cliente")}: <b>${frappe.utils.escape_html(customer)}</b></span>`).appendTo($meta);
		}

		$(`<p class="cac-result-note">${__(
			"Conta pronta a usar com esta password - podes partilhar o email e a password diretamente (WhatsApp, telefone, etc.), sem depender do envio de email."
		)}</p>`).appendTo(this.$result);
		this.build_copy_row(__("Password"), result.password, this.$result);

		$(`<p class="cac-result-note">${__(
			"Em alternativa, a pessoa pode definir a própria password através deste link:"
		)}</p>`).appendTo(this.$result);
		this.build_copy_row(__("Link"), result.link, this.$result);

		$(`<button class="cac-btn cac-link-again">${__("Criar outro utilizador")}</button>`)
			.appendTo(this.$result)
			.on("click", () => this.reset_form());

		this.$result[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	build_copy_row(label, value, $parent) {
		const $row = $('<div class="cac-link-row">').appendTo($parent);
		$(`<span class="cac-copy-label">${frappe.utils.escape_html(label)}</span>`).appendTo($row);
		const $input = $('<input type="text" readonly class="cac-link-input">').val(value).appendTo($row);
		const $copy_btn = $(`<button class="cac-btn">${__("Copiar")}</button>`).appendTo($row);

		$copy_btn.on("click", () => {
			$input.select();
			navigator.clipboard
				?.writeText(value)
				.then(() => frappe.show_alert({ message: __("Copiado"), indicator: "green" }))
				.catch(() => document.execCommand("copy"));
		});
	}

	// ---- existing accounts: list + manage --------------------------------

	render_toolbar() {
		const $bar = $('<div class="cac-toolbar">').appendTo(this.$container);

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
					.text(p.label)
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

	load_accounts() {
		frappe.call({
			method: "manutencao_preditiva.api.listar_utilizadores",
			callback: (r) => {
				this.rows = r.message || [];
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
				<th>${__("Nome")}</th>
				<th>${__("Email")}</th>
				<th>${__("Perfil")}</th>
				<th>${__("Cliente")}</th>
				<th>${__("Estado")}</th>
				<th>${__("Ações")}</th>
			</tr></thead>`
		).appendTo($table);
		const $tbody = $("<tbody>").appendTo($table);

		rows.forEach((row) => this.render_account_row($tbody, row));
	}

	render_account_row($tbody, row) {
		const $tr = $("<tr>").appendTo($tbody);
		const $name = $("<td>").text(row.full_name || "").appendTo($tr);
		if (row.is_self) $(`<span class="cac-you">${__("tu")}</span>`).appendTo($name);
		$("<td>").text(row.email).appendTo($tr);
		$("<td>").text(row.profile ? __(row.profile) : "—").appendTo($tr);
		$("<td>").text(row.customers || "—").appendTo($tr);

		const badge_class = row.enabled ? "cac-badge-active" : "cac-badge-inactive";
		const badge_label = row.enabled ? __("Ativo") : __("Inativo");
		$(`<td><span class="cac-badge ${badge_class}">${badge_label}</span></td>`).appendTo($tr);

		const $actions = $('<td class="cac-row-actions">').appendTo($tr);

		if (!row.manageable) {
			$(`<span class="cac-muted" title="${__(
				"Esta conta tem outras funções no sistema e só pode ser gerida pelo System Manager."
			)}">${__("Gerido pelo System Manager")}</span>`).appendTo($actions);
			return;
		}

		$(`<button class="cac-btn cac-btn-sm">${__("Repor Password")}</button>`)
			.appendTo($actions)
			.on("click", () => this.reset_password(row));

		if (row.is_self) return;

		$(`<button class="cac-btn cac-btn-sm">${row.enabled ? __("Desativar") : __("Ativar")}</button>`)
			.appendTo($actions)
			.on("click", () => this.toggle_enabled(row));

		$(`<button class="cac-btn cac-btn-sm">${__("Mudar Perfil")}</button>`)
			.appendTo($actions)
			.on("click", () => this.change_profile(row));
	}

	reset_password(row) {
		const message = `${__("Repor a password de")} ${frappe.utils.escape_html(row.email)}? ${__(
			"A password atual deixa de funcionar de imediato."
		)}`;
		frappe.confirm(message, () => {
			frappe.call({
				method: "manutencao_preditiva.api.repor_password",
				args: { email: row.email },
				freeze: true,
				freeze_message: __("A repor password…"),
				callback: (r) => {
					if (!r.message) return;
					this.render_reset_result(row, r.message);
				},
			});
		});
	}

	render_reset_result(row, result) {
		this.$result.empty().show();
		$(`<div class="cac-result-title">✓ ${__("Password reposta para")} ${frappe.utils.escape_html(row.email)}</div>`).appendTo(
			this.$result
		);
		$(`<p class="cac-result-note">${__(
			"Partilha esta nova password com a pessoa, ou envia-lhe o link para escolher a sua:"
		)}</p>`).appendTo(this.$result);
		this.build_copy_row(__("Password"), result.password, this.$result);
		this.build_copy_row(__("Link"), result.link, this.$result);
		this.$result[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
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
