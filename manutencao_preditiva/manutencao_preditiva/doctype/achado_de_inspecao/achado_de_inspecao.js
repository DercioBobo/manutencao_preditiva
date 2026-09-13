// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

frappe.ui.form.on("Achado De Inspecao", {
	refresh(frm) {
		frm.trigger("cliente");
	},
	cliente(frm) {
		frm.set_query("area_planta", () => ({
			filters: { cliente: frm.doc.cliente },
		}));
	},
});
