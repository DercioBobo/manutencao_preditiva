app_name = "manutencao_preditiva"
app_title = "Manutencao Preditiva"
app_publisher = "Dércio Bobo"
app_description = "Manutenção Preditiva - Gestão de Manutenção Preditiva de Ativos para Frappe/ERPNext"
app_email = "derciobob@gmail.com"
app_license = "mit"
app_icon = "octicon octicon-pulse"
app_color = "#e67e22"

# Apps
# ------------------
# Predictive maintenance plans/readings will link to ERPNext's own Asset
# doctype rather than duplicating an equipment registry inside this app.
required_apps = ["erpnext"]

# Includes in <head>
# ------------------
# Redirects a Cliente Portal login straight to Meus Achados instead of
# landing on the Portal do Cliente workspace (which just holds a single
# link to it) - see manutencao_preditiva/public/js/cliente_portal_redirect.js.
app_include_js = ["/assets/manutencao_preditiva/js/cliente_portal_redirect.js"]

# web_include_* apply to every website page (not just /login), but the
# login theme's own CSS/JS are scoped to the .for-login wrapper so they
# no-op everywhere else. Deliberately not a Website Settings change - this
# is pure app-owned hooks + static assets, so uninstalling the app removes
# the include and the login page reverts to stock Frappe automatically.
web_include_css = ["/assets/manutencao_preditiva/css/login_theme.css"]
web_include_js = ["/assets/manutencao_preditiva/js/login_theme.js"]

# Fixtures
# --------
# Exported so `bench get-app` + `bench migrate` reproduces the three roles
# out of the box. "Cliente Portal" is restricted per-client via a User
# Permission on Customer (Setup -> User Permissions) - it then only ever
# sees/edits the Achado De Inspecao rows for its own Customer.
#
# "Gestor de Acessos de Cliente" has no doctype permissions of its own - it
# only grants access to the "Criar Acesso de Cliente" page, whose whitelisted
# method (manutencao_preditiva.api.criar_acesso_cliente) does the actual User
# / User Permission writes with ignore_permissions=True. That way a
# non-technical admin can onboard client logins without ever needing direct
# access to Setup > User List / User Permissions.

fixtures = [
	{
		"dt": "Role",
		"filters": [
			["name", "in", ["Tecnico de Inspecao", "Cliente Portal", "Gestor de Acessos de Cliente"]]
		],
	},
]

# Installation
# ------------
# Patches don't run on a fresh install, so the default alarm limits are
# seeded here too (and by a patch on sites that already had the app).
after_install = "manutencao_preditiva.setup.install.after_install"

# Permissions
# -----------
# Clients (Cliente Portal) only see a report - and its sheets - once it is
# Issued; drafts stay internal. Staff roles are unaffected.
permission_query_conditions = {
	"Inspection Report": "manutencao_preditiva.permissions.report_query_conditions",
	"Equipment Inspection": "manutencao_preditiva.permissions.sheet_query_conditions",
}
has_permission = {
	"Inspection Report": "manutencao_preditiva.permissions.report_has_permission",
	"Equipment Inspection": "manutencao_preditiva.permissions.sheet_has_permission",
}

# Document Events
# ---------------
# Add per-doctype once doctypes exist (doc_events = {...}).

# Scheduled Tasks
# ---------------
# Add once background jobs (e.g. daily condition-monitoring checks) are
# needed (scheduler_events = {...}).
