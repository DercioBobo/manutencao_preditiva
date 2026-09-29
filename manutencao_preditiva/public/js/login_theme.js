// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Login page skin: turns Frappe's centred login card into a full-screen
// split layout - a brand panel on the left, the form on the right. Scoped
// to pages that have .for-login, so it no-ops on every other website page.
// Pure DOM tweak via web_include_js, no Website Settings/DB writes, so it
// disappears the moment this app is uninstalled and the login page reverts
// to stock Frappe.
//
// Frappe's login.html renders .for-login, .for-forgot, .for-signup, ... as
// sibling <section>s and shows one at a time by URL hash - the brand panel
// is added next to them, so it stays put while the form side switches.
document.addEventListener("DOMContentLoaded", function () {
	const login_section = document.querySelector(".for-login");
	if (!login_section) return;

	const t = typeof window.__ === "function" ? window.__ : (s) => s;
	const esc = (s) =>
		String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

	document.body.classList.add("mp-login-page");
	const host = login_section.parentElement;
	host.classList.add("mp-login-host");

	const heading = login_section.querySelector(".page-card-head h4");
	if (heading) heading.textContent = t("Sign in to your account");

	const logo = login_section.querySelector(".app-logo");
	const logo_src = logo && logo.getAttribute("src");

	const points = [
		t("Plant condition, month by month"),
		t("Findings and recommendations from every inspection"),
		t("Record the actions your team takes"),
	];

	const brand = document.createElement("aside");
	brand.className = "mp-login-brand";
	brand.innerHTML = `
		<div class="mp-login-brand-top">
			${logo_src ? `<span class="mp-login-logo"><img src="${esc(logo_src)}" alt=""></span>` : ""}
		</div>
		<div class="mp-login-brand-body">
			<h1 class="mp-login-title">Manutenção Preditiva</h1>
			<p class="mp-login-tagline">${esc(t("Vibration analysis and inspection findings for your plant, in one place."))}</p>
			<ul class="mp-login-points">
				${points.map((p) => `<li>${esc(p)}</li>`).join("")}
			</ul>
		</div>
		<svg class="mp-login-wave" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
			<polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"
				points="0,60 60,60 80,58 95,30 110,92 125,18 140,100 155,44 170,70 185,60 260,60 275,54 290,74 305,48 320,64 335,60 420,60 435,40 450,86 465,26 480,94 495,50 510,66 525,60 600,60" />
		</svg>
		<div class="mp-login-brand-foot">${esc(t("Accounts are created by your inspection team."))}</div>
	`;
	host.insertBefore(brand, host.firstChild);
});
