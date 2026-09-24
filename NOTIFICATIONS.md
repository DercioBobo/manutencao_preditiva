# Email Notifications

Setup for this app's emails using Frappe's built-in **Notification**
doctype (*Setup → Notification → New*). There's no app code: each entry
below lists the settings for one Notification record and its message
template, ready to paste.

I checked the settings against Frappe v15's Notification source
(`frappe/email/doctype/notification/notification.py`), but **no template
has been run on a real bench yet**. See [Testing](#testing).

| # | Notification | Goes to | Doctype | Fires on |
|---|---|---|---|---|
| A | Report issued | Client | Inspection Report | Value Change `status` |
| B | Urgent finding (advance notice) | Client | Equipment Inspection | Value Change `notify_client` |
| C | Action due soon | Client | Equipment Inspection | 3 days before `due_date` |
| D | Action overdue | Client | Equipment Inspection | 1 (and 7) days after `due_date` |
| E | Client updated an action | Staff | Equipment Inspection | Value Change `action_status` |
| F | Critical fixed: verify | Staff | Equipment Inspection | Value Change `action_status` |
| G | Report still in Draft | Staff | Inspection Report | 7 days after `report_date` |

---

## Before you start

- **Outgoing Email Account.** Set one up and tick *Default Outgoing*.
- **Channel = Email, Message Type = HTML** on every Notification below.
- **Client recipients go in CC.** On the Notification's *Recipients* table, add
  one row with this in the **CC** box (it accepts Jinja). This is what "Client CC"
  means below:

  ```
  {% set users = frappe.get_all("User Permission", filters={"allow": "Customer", "for_value": doc.customer}, pluck="user") %}{{ frappe.get_all("User", filters={"name": ["in", users or ["-"]], "enabled": 1}, pluck="name") | join(",") }}
  ```

  It resolves to the enabled client portal logins scoped to that document's
  customer, the same people who see it in My Findings. **Never** use
  *Receiver By Role → Cliente Portal*: that role covers every customer, so
  every client would get every other client's findings.

### How Frappe Notifications behave

- **Conditions can only use `doc` and `frappe.utils`.** They can't query the
  database or check who saved. Message bodies, subjects and CC can do more,
  since they have `frappe.get_all` and `frappe.db.get_value`.
- **A broken template blocks the save.** When a notification's template errors,
  saving the document fails with "Error in Notification". Enable each one on a
  test customer first.
- **Days Before/After fire once.** They're checked by the daily scheduler and
  fire only on the exact day. A second reminder needs a second Notification.
- **Value Change fires on every save that changes the field,** by anyone,
  staff included. It doesn't fire when a document is first created.
- **Attach Print needs Print Settings → Allow Print for Draft.** Neither
  doctype is submittable, so every record is `docstatus = 0` (a "draft" to
  Frappe) even once Issued. Without that setting the attachment throws, and
  the save fails.

---

## Client-facing

### A. Report issued

| Setting | Value |
|---|---|
| Document Type | Inspection Report |
| Send Alert On | Value Change → `status` |
| Condition | `doc.status == "Issued"` |
| Recipients | Client CC |
| Attach Print | Optional → *Vibration Report* (see "Before you start") |
| Subject | `Vibration report ready: {{ frappe.db.get_value("Area", doc.area, "area_name") }} – {{ doc.period_label or frappe.utils.formatdate(doc.report_date) }}` |

```html
{% set colors = {"Normal": "#00b050", "Acceptable": "#ffff66", "Alarm": "#ffb266", "Critical": "#ff0000", "Not Collected": "#d9d9d9"} %}
{% set rank = {"Normal": 0, "Acceptable": 1, "Alarm": 2, "Critical": 3} %}
{% set area = frappe.db.get_value("Area", doc.area, "area_name") or doc.area %}
{% set sheets = frappe.get_all("Equipment Inspection", filters={"report": doc.name},
     fields=["equipment", "equipment_description", "severity", "defects", "recommendations", "previous_sheet"],
     order_by="equipment_description asc") %}
{% set cell = "border:1px solid #d0d7de;padding:6px 10px" %}

<p>Hello,</p>
<p>The vibration inspection report for <b>{{ area }}</b> ({{ doc.period_label or frappe.utils.formatdate(doc.report_date) }}) is now available.</p>

<table style="border-collapse:collapse">
{% for sev in ["Critical", "Alarm", "Acceptable", "Normal", "Not Collected"] %}
  {% set n = sheets | selectattr("severity", "equalto", sev) | list | length %}
  {% if n %}<tr><td style="{{ cell }};background:{{ colors[sev] }};font-weight:bold">{{ sev }}</td><td style="{{ cell }}">{{ n }}</td></tr>{% endif %}
{% endfor %}
  <tr><td style="{{ cell }}"><b>Total</b></td><td style="{{ cell }}"><b>{{ sheets | length }}</b></td></tr>
</table>

{% set urgent = sheets | selectattr("severity", "in", ["Critical", "Alarm"]) | sort(attribute="severity", reverse=True) | list %}
{% if urgent %}
<h3>Needs action</h3>
<table style="border-collapse:collapse">
  <tr><th style="{{ cell }}">Equipment</th><th style="{{ cell }}">Severity</th><th style="{{ cell }}">Defect</th><th style="{{ cell }}">Recommendation</th></tr>
  {% for s in urgent %}
  <tr>
    <td style="{{ cell }}">{{ s.equipment_description or s.equipment }}</td>
    <td style="{{ cell }};background:{{ colors[s.severity] }};font-weight:bold">{{ s.severity }}</td>
    <td style="{{ cell }}">{{ s.defects or "" }}</td>
    <td style="{{ cell }}">{{ s.recommendations or "" }}</td>
  </tr>
  {% endfor %}
</table>
{% endif %}

{% set worse = [] %}
{% for s in sheets if s.previous_sheet and s.severity in rank %}
  {% set prev = frappe.db.get_value("Equipment Inspection", s.previous_sheet, "severity") %}
  {% if prev in rank and rank[s.severity] > rank[prev] %}{% set _ = worse.append((s, prev)) %}{% endif %}
{% endfor %}
{% if worse %}
<h3>Worse since the last visit</h3>
<ul>{% for s, prev in worse %}<li><b>{{ s.equipment_description or s.equipment }}</b>: {{ prev }} → {{ s.severity }}</li>{% endfor %}</ul>
{% endif %}

<p><a href="{{ frappe.utils.get_url('/app/meus-achados') }}">Open My Findings</a> to see every finding and record the actions you take.</p>
```

Notes:
- **Re-issuing sends it again.** Reopen to Draft followed by Issue Report sends this email a second time.
- **The "Worse since the last visit" block** needs `worse.append` to work in Frappe's sandboxed Jinja. If the template errors on save, delete that block first.

### B. Urgent finding: advance notice

For an Alarm/Critical finding the client should hear about before the round
is over. The report is still Draft at this point, and `permissions.py` hides
Draft reports from clients, so **the email must be self-contained**: a link
into the portal would just give them a permission error.

**Trigger: a checkbox, not the severity.** Severity is recalculated on every
save, so triggering on it would email the client the moment a mistyped
reading is saved. Instead:

1. **Customize Form → Equipment Inspection:** add a field `notify_client`
   (Check, label "Notify Client"), e.g. in the Diagnosis section.
2. The technician ticks it on the **full form** once the sheet is right.
   The Workbench dialog doesn't show custom fields.

| Setting | Value |
|---|---|
| Document Type | Equipment Inspection |
| Send Alert On | Value Change → `notify_client` |
| Condition | `doc.notify_client and doc.severity in ("Alarm", "Critical")` |
| Set Property After Alert | `notify_client` → `0` (unticks it, so it can be sent again later) |
| Attach Files | All |
| Recipients | Client CC |
| Subject | `[{{ doc.severity }}] {{ doc.equipment_description or doc.equipment }} – advance notice` |

Fully automatic alternative: use Value Change → `severity` with the same
condition and skip the custom field, accepting the mistyped-reading risk.

```html
{% set colors = {"Alarm": "#ffb266", "Critical": "#ff0000"} %}
{% set cell = "border:1px solid #d0d7de;padding:6px 10px;text-align:center" %}

<p>Hello,</p>
<p>During the current inspection round at <b>{{ frappe.db.get_value("Area", doc.area, "area_name") }}</b> we found
<b>{{ doc.equipment_description or doc.equipment }}</b> in
<span style="background:{{ colors[doc.severity] }};padding:2px 8px;font-weight:bold">{{ doc.severity }}</span> condition.
{% if doc.severity == "Critical" %}Consider stopping it for corrective maintenance as soon as possible.{% else %}Schedule corrective maintenance without interfering with production.{% endif %}</p>
<p>We are telling you now rather than waiting for the full report, which will follow at the end of the round.</p>

{% if doc.defects %}<h3>Defects found</h3><p>{{ doc.defects | replace("\n", "<br>") }}</p>{% endif %}
{% if doc.recommendations %}<h3>Recommendations</h3><p>{{ doc.recommendations | replace("\n", "<br>") }}</p>{% endif %}
{% if doc.follow_up %}<h3>Actions taken</h3><p>{{ doc.follow_up | replace("\n", "<br>") }}</p>{% endif %}

<h3>Readings</h3>
<table style="border-collapse:collapse">
  <tr><th style="{{ cell }}">Point</th><th style="{{ cell }}">mm/s</th><th style="{{ cell }}">Prev.</th><th style="{{ cell }}">g's</th><th style="{{ cell }}">Temp. °C</th></tr>
  {% for r in doc.readings if r.velocity_mm_s or r.acceleration_g %}
  <tr>
    <td style="{{ cell }}"><b>{{ r.point }}</b></td>
    <td style="{{ cell }}{% if r.velocity_severity in colors %};background:{{ colors[r.velocity_severity] }};font-weight:bold{% endif %}">{{ r.velocity_mm_s or "" }}</td>
    <td style="{{ cell }};color:#57606a">{{ r.previous_velocity_mm_s or "" }}</td>
    <td style="{{ cell }}{% if r.acceleration_severity in colors %};background:{{ colors[r.acceleration_severity] }};font-weight:bold{% endif %}">{{ r.acceleration_g or "" }}</td>
    <td style="{{ cell }}">{{ r.temperature_c or "" }}</td>
  </tr>
  {% endfor %}
</table>
{% if doc.tolerance_percent %}<p style="font-size:12px;color:#57606a">Alarm limits include a {{ doc.tolerance_percent }}% tolerance.</p>{% endif %}
```

Notes:
- **Photos:** *Attach Files → All* attaches the files linked to this sheet.
  Photos uploaded on the full form are linked. Photos added through the
  Workbench dialog may not be, so check one on the bench before relying on it.

### C. Action due soon

| Setting | Value |
|---|---|
| Document Type | Equipment Inspection |
| Send Alert On | Days Before → `due_date`, **3** days |
| Condition | `doc.action_status in ("Open", "In Progress")` |
| Recipients | Client CC |
| Subject | `Action due {{ frappe.utils.formatdate(doc.due_date) }}: {{ doc.equipment_description or doc.equipment }}` |

```html
<p>Hello,</p>
<p>The corrective action for <b>{{ doc.equipment_description or doc.equipment }}</b> ({{ doc.severity }}) is due on
<b>{{ frappe.utils.formatdate(doc.due_date) }}</b>{% if doc.responsible %}, responsible: {{ doc.responsible }}{% endif %}.</p>
{% if doc.recommendations %}<p><b>Our recommendation:</b><br>{{ doc.recommendations | replace("\n", "<br>") }}</p>{% endif %}
<p>Current status: <b>{{ doc.action_status }}</b>. Please update it in
<a href="{{ frappe.utils.get_url('/app/meus-achados') }}">My Findings</a> once it's done.</p>
```

The client sets `responsible` as free text, not an email address, so this
goes to the customer's portal logins rather than to that person.

### D. Action overdue

| Setting | Value |
|---|---|
| Document Type | Equipment Inspection |
| Send Alert On | Days After → `due_date`, **1** day |
| Condition | `doc.action_status in ("Open", "In Progress") and doc.severity in ("Alarm", "Critical")` |
| Recipients | Client CC |
| Subject | `Overdue: {{ doc.equipment_description or doc.equipment }} ({{ doc.severity }})` |

```html
<p>Hello,</p>
<p>The corrective action for <b>{{ doc.equipment_description or doc.equipment }}</b> ({{ doc.severity }}) was due on
<b>{{ frappe.utils.formatdate(doc.due_date) }}</b> and is still marked <b>{{ doc.action_status }}</b>{% if doc.responsible %} (responsible: {{ doc.responsible }}){% endif %}.</p>
{% if doc.recommendations %}<p><b>Our recommendation:</b><br>{{ doc.recommendations | replace("\n", "<br>") }}</p>{% endif %}
<p>Please update it in <a href="{{ frappe.utils.get_url('/app/meus-achados') }}">My Findings</a>.</p>
```

For a second reminder, duplicate this Notification with **7** days.

---

## Staff-facing

Recipients: *Receiver By Role → Tecnico de Inspecao* (the whole team), or
*Receiver By Document Field → owner* (whoever created the record).

### E. Client updated an action

| Setting | Value |
|---|---|
| Document Type | Equipment Inspection |
| Send Alert On | Value Change → `action_status` |
| Condition | *(optional, skips your own team's edits)* `not doc.modified_by.endswith("@yourcompany.com")` |
| Recipients | Role → Tecnico de Inspecao |
| Subject | `{{ doc.customer }} updated {{ doc.equipment_description or doc.equipment }}: {{ doc.action_status }}` |

```html
<p><b>{{ doc.customer }}</b> changed the action on <b>{{ doc.equipment_description or doc.equipment }}</b> ({{ doc.severity }}) to <b>{{ doc.action_status }}</b>.</p>
<ul>
  {% if doc.client_response %}<li>Response: {{ doc.client_response }}</li>{% endif %}
  {% if doc.responsible %}<li>Responsible: {{ doc.responsible }}</li>{% endif %}
  {% if doc.due_date %}<li>Due: {{ frappe.utils.formatdate(doc.due_date) }}</li>{% endif %}
  {% if doc.completion_date %}<li>Completed: {{ frappe.utils.formatdate(doc.completion_date) }}</li>{% endif %}
</ul>
<p><a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}">Open the sheet</a></p>
```

### F. Critical fixed: schedule a verification reading

| Setting | Value |
|---|---|
| Document Type | Equipment Inspection |
| Send Alert On | Value Change → `action_status` |
| Condition | `doc.action_status == "Done" and doc.severity == "Critical"` |
| Recipients | Role → Tecnico de Inspecao |
| Subject | `Verify: {{ doc.customer }} says {{ doc.equipment_description or doc.equipment }} is fixed` |

```html
<p><b>{{ doc.customer }}</b> marked the Critical finding on <b>{{ doc.equipment_description or doc.equipment }}</b> as Done
{% if doc.completion_date %}on {{ frappe.utils.formatdate(doc.completion_date) }}{% endif %}.</p>
{% if doc.client_response %}<p>What they did: {{ doc.client_response }}</p>{% endif %}
<p>Schedule a verification reading to confirm the fix.
<a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}">Open the sheet</a></p>
```

E also fires for this change. To avoid two emails, add
`and not (doc.action_status == "Done" and doc.severity == "Critical")` to E's
condition.

### G. Report still in Draft

| Setting | Value |
|---|---|
| Document Type | Inspection Report |
| Send Alert On | Days After → `report_date`, **7** days |
| Condition | `doc.status == "Draft"` |
| Recipients | Document Field → owner |
| Subject | `Still in Draft: {{ doc.customer }} – {{ doc.period_label or frappe.utils.formatdate(doc.report_date) }}` |

```html
{% set sheets = frappe.get_all("Equipment Inspection", filters={"report": doc.name}, fields=["severity"]) %}
{% set pending = sheets | rejectattr("severity") | list | length %}
<p>The report for <b>{{ doc.customer }}</b> dated {{ frappe.utils.formatdate(doc.report_date) }} is still in Draft, so the client can't see it yet.</p>
<p>{{ sheets | length }} sheets, {{ pending }} without a severity yet.</p>
<p><a href="{{ frappe.utils.get_url('/app/report-workbench') }}">Open Report Workbench</a></p>
```

---

## Testing

None of the above has run on a bench yet. For each Notification:

1. Create a **test Customer** with a client portal login using your own
   email address (Gestão de Acessos), plus a test Area, Equipment and report.
2. Enable the Notification, then trigger it on the test records. Days
   Before/After can be forced by setting the date so the daily run picks it up
   (or run `bench --site <site> execute frappe.email.doctype.notification.notification.trigger_daily_alerts`).
3. Check **Email Queue** for the sent message, and read it in the mail client
   the customer actually uses (Outlook and Gmail render HTML differently).
4. Confirm the CC resolved to the test customer's login only, not to other
   customers' logins.

Specific things to confirm:
- [ ] A: the "Worse since the last visit" block renders (sandboxed `append`).
- [ ] A: Attach Print works with *Allow Print for Draft* on, and the PDF looks right.
- [ ] B: photos arrive as attachments, including ones added via the Workbench.
- [ ] B: *Set Property After Alert* unticks `notify_client` without re-firing.
- [ ] C/D: fire on the right day from the daily scheduler.
