// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Cliente Portal users have every other module blocked (see
// manutencao_preditiva.api._restrict_client_desk) and default_workspace
// pointed at Portal do Cliente, so the only thing worth landing on is
// Meus Achados directly - skip the one extra click through the workspace.
frappe.ready(function () {
	function is_cliente_portal() {
		const roles = (frappe.boot && frappe.boot.user && frappe.boot.user.roles) || [];
		return roles.includes("Cliente Portal");
	}

	function redirect_if_landing() {
		if (!is_cliente_portal()) return;
		const route = frappe.get_route();
		const is_landing = !route || !route.length;
		if (is_landing && frappe.get_route_str() !== "meus-achados") {
			frappe.set_route("meus-achados");
		}
	}

	frappe.router.on("change", redirect_if_landing);
	redirect_if_landing();
});
