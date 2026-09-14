// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.provide("manutencao_preditiva");

frappe.pages["criar-acesso-de-cliente"].on_page_load = function (wrapper) {
	wrapper.cac = new manutencao_preditiva.CriarAcessoDeCliente(wrapper);
};

manutencao_preditiva.CriarAcessoDeCliente = class CriarAcessoDeCliente {
	constructor(wrapper) {
		this.wrapper = wrapper;

		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Criar Acesso de Cliente"),
			single_column: true,
		});

		this.render_shell();
	}

	render_shell() {
		this.$container = $('<div class="cac">').appendTo(this.page.body);

		$(`<p class="cac-intro">${__(
			"Dá a um contacto do cliente acesso ao Portal do Cliente: cria o login, restringe-o apenas aos achados desse cliente, e devolve um link para o cliente definir a sua password."
		)}</p>`).appendTo(this.$container);

		this.$card = $('<div class="cac-card">').appendTo(this.$container);
		this.render_form();

		this.$result = $('<div class="cac-result">').appendTo(this.$container).hide();
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
				description: __("Vai ser o email de login no portal."),
			},
			parent: $field()[0],
			render_input: true,
		});
		this.email_control.refresh();

		this.customer_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "customer",
				label: __("Cliente"),
				options: "Customer",
				reqd: 1,
				description: __("O cliente cujos achados esta pessoa poderá ver."),
			},
			parent: $field()[0],
			render_input: true,
		});
		this.customer_control.refresh();

		this.send_welcome_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Check",
				fieldname: "send_welcome",
				label: __("Enviar o link de acesso por email ao cliente"),
				default: 1,
			},
			parent: $field("cac-field-check")[0],
			render_input: true,
		});
		this.send_welcome_control.refresh();
		this.send_welcome_control.set_value(1);

		this.$submit_btn = $(`<button class="cac-btn cac-btn-primary">${__("Criar Acesso")}</button>`).appendTo(
			this.$card
		);
		this.$submit_btn.on("click", () => this.submit());
	}

	submit() {
		const full_name = (this.full_name_control.get_value() || "").trim();
		const email = (this.email_control.get_value() || "").trim();
		const customer = (this.customer_control.get_value() || "").trim();
		const send_welcome = this.send_welcome_control.get_value() ? 1 : 0;

		if (!full_name || !email || !customer) {
			frappe.msgprint(__("Preenche o Nome, o Email e o Cliente."));
			return;
		}

		frappe.call({
			method: "manutencao_preditiva.api.criar_acesso_cliente",
			args: { full_name, email, customer, send_welcome },
			freeze: true,
			freeze_message: __("A criar acesso…"),
			callback: (r) => {
				if (!r.message) return;
				this.render_result(r.message, { full_name, customer });
			},
		});
	}

	render_result(result, { full_name, customer }) {
		this.$result.empty().show();

		const title = result.created_user
			? __("Acesso criado para")
			: __("Acesso atualizado para");
		$(`<div class="cac-result-title">✓ ${title} ${frappe.utils.escape_html(full_name)}</div>`).appendTo(this.$result);

		const $meta = $('<div class="cac-result-meta">').appendTo(this.$result);
		$(`<span>${__("Email")}: <b>${frappe.utils.escape_html(result.email)}</b></span>`).appendTo($meta);
		$(`<span>${__("Cliente")}: <b>${frappe.utils.escape_html(customer)}</b></span>`).appendTo($meta);

		if (result.password) {
			$(`<p class="cac-result-note">${__(
				"Conta pronta a usar já com esta password - podes partilhar o email e a password diretamente com o cliente (WhatsApp, telefone, etc.), sem depender do envio de email."
			)}</p>`).appendTo(this.$result);
			this.build_copy_row(__("Password"), result.password, this.$result);

			$(`<p class="cac-result-note">${__(
				"Em alternativa, o cliente pode definir a própria password através deste link:"
			)}</p>`).appendTo(this.$result);
		} else if (result.email_sent) {
			$(`<p class="cac-result-note">${__(
				"Esta conta já existia - foi enviado um email ao cliente com o link para definir/repor a password. Se não chegar (por exemplo, se o envio de email não estiver configurado no servidor), usa o link abaixo."
			)}</p>`).appendTo(this.$result);
		} else {
			$(`<p class="cac-result-note">${__(
				"Esta conta já existia - a password atual não foi alterada. Envia este link ao cliente se ele precisar de a repor:"
			)}</p>`).appendTo(this.$result);
		}

		this.build_copy_row(__("Link"), result.link, this.$result);

		const $again_btn = $(`<button class="cac-btn cac-link-again">${__("Criar outro acesso")}</button>`).appendTo(
			this.$result
		);
		$again_btn.on("click", () => {
			this.full_name_control.set_value("");
			this.email_control.set_value("");
			this.customer_control.set_value("");
			this.send_welcome_control.set_value(1);
			this.$result.hide().empty();
		});

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
};
