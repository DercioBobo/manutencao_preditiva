// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Rebrands the shared login page's heading - scoped to .for-login so this
// no-ops on every other website page. Pure DOM tweak via web_include_js,
// no Website Settings/DB writes, so it disappears the moment this app is
// uninstalled and the login page reverts to stock Frappe.
document.addEventListener("DOMContentLoaded", function () {
	const login_section = document.querySelector(".for-login");
	if (!login_section) return;

	const heading = login_section.querySelector("h4");
	if (heading) {
		heading.textContent = "Manutenção Preditiva";
	}
});
