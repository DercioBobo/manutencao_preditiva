// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Cliente Portal users have every other module blocked (see
// manutencao_preditiva.api._setup_desk) and default_workspace
// pointed at Portal do Cliente, so the only thing worth landing on is
// Meus Achados directly - skip the one extra click through the workspace.
//
// After login, /app resolves to the default workspace, so the route is
// ["Workspaces", "Portal do Cliente"] rather than empty by the time this
// runs - any workspace route (or the bare /app) sends them to Meus Achados.
// replaceState instead of set_route so Back doesn't bounce off the
// workspace straight into another redirect.
$(function () {
	function is_cliente_portal() {
		const roles = (frappe.boot && frappe.boot.user && frappe.boot.user.roles) || [];
		return roles.includes("Cliente Portal") && !roles.includes("System Manager");
	}

	function should_redirect() {
		const route = frappe.get_route() || [];
		return !route.length || !route[0] || route[0] === "Workspaces";
	}

	function redirect_to_meus_achados() {
		if (!is_cliente_portal() || !should_redirect()) return;
		// Let the router finish the current render before re-routing.
		setTimeout(() => {
			if (!should_redirect()) return;
			window.history.replaceState(null, null, "/app/meus-achados");
			frappe.router.route();
		}, 0);
	}

	if (!frappe.router || !frappe.router.on) return;
	frappe.router.on("change", redirect_to_meus_achados);
	redirect_to_meus_achados();
});
