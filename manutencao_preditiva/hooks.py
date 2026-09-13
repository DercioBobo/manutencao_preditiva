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
# No custom assets yet - add app_include_css / app_include_js once the
# first doctype or workspace UI needs them.

# Fixtures
# --------
# No fixtures yet - add once roles/workflows are defined alongside the
# first doctypes.

# Document Events
# ---------------
# Add per-doctype once doctypes exist (doc_events = {...}).

# Scheduled Tasks
# ---------------
# Add once background jobs (e.g. daily condition-monitoring checks) are
# needed (scheduler_events = {...}).
