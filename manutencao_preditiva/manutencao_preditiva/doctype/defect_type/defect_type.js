// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Typing a name warns about look-alikes before the duplicate is made -
// the server only refuses exact repeats (defect_type.py).
frappe.ui.form.on("Defect Type", {
	defect_name(frm) {
		frm.dashboard.clear_comment();
		if (!frm.doc.defect_name) return;
		frappe
			.call({
				method: "manutencao_preditiva.manutencao_preditiva.doctype.defect_type.defect_type.find_similar",
				args: { defect_name: frm.doc.defect_name, exclude: frm.is_new() ? null : frm.doc.name },
			})
			.then((r) => {
				const similar = r.message || [];
				if (!similar.length) return;
				const links = similar
					.map((s) => `<a href="/app/defect-type/${encodeURIComponent(s.name)}">${frappe.utils.escape_html(s.name)}</a>`)
					.join(", ");
				frm.dashboard.add_comment(__("Similar defects already exist: {0}. Use one of them if it is the same defect.", [links]), "orange", true);
			});
	},
});
