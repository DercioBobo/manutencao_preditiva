# Manutenção Preditiva (manutencao_preditiva)

**Manutenção Preditiva** — predictive asset maintenance application built on
the Frappe Framework, installable on a bench with ERPNext.

## Installation

```bash
bench get-app manutencao_preditiva <repo-url>
bench --site <site> install-app manutencao_preditiva
```

## Inspection reports (vibration)

The source of truth is the **report** the team writes for each client and
month - severity legend, alarm tables, a summary of the area, and one sheet
per equipment with the readings, previous-month comparison, diagnosis and
photos. The Excel "Action Tracker" is only a summary of it, so the app now
models the report itself and produces the Excel from it.

See **`WORKFLOW.md`** for the step-by-step operational guide (how to start,
the day-to-day cycle, what's still missing before a real client visit). The
summary below is the architecture reference.

**Workflow**

1. Once: set up the client's **Area** and **Equipment**
   (rated power in kW, and its measurement points - `M1H`, `M2H`, `M2A`, ...).
2. Per month: create an **Inspection Report** (customer, area, date, team),
   then *Create Equipment Sheets* - one **Equipment Inspection** per active
   equipment, already carrying its measurement points and, next to them, last
   month's readings.
3. The technician types velocity (mm/s), acceleration (g's) and temperature
   per point. The sheet grades every reading against the alarm tables and
   **suggests** a severity; the analyst confirms or overrides it (bearing
   defects can make an equipment worse than its raw numbers) and adds the
   defects, recommendations and images.
4. Set the report to **Issued**. The *Vibration Report* print format renders
   the full PDF - the counts, percentages and pie are computed from the
   sheets - and the client can now see it.
5. **Action Tracker** (report) lists the sheets with the client's response
   columns; *Export > Excel* gives the summary file.

**Alarm tables** live in *Vibration Alarm Settings* (seeded with the limits of
the current report, FR.TEC.09) and are shared by every client. Velocity limits
depend on the motor's power band; acceleration has a single set; a reading that
reaches a limit is at that severity and below the first limit is Normal. An
equipment can carry a tolerance up to the maximum set there (10%).

**Severity levels:** Normal, Acceptable, Alarm, Critical, Not Collected.

Clients (role *Cliente Portal*) only see a report, and its sheets, once it is
Issued, and can only write the *Client Response* fields. They see it through
**My Findings** (`/app/meus-achados` - the route is unchanged, see below),
which reads Equipment Inspection / Inspection Report instead of the old
Achado De Inspecao.

**Sheets lock once their report is Issued.** A sheet's technical content
(readings, severity, defects, recommendations, follow-up, images, equipment,
tolerance) can't be changed - or a new sheet added - while the parent
report is Issued; saving throws `"{report} is Issued - reopen it to Draft
before changing {field}."` (`equipment_inspection.py`,
`validate_locked_after_issue()`). The Client Response section is exempt -
that's exactly what's meant to be edited after Issue, by the client or by
staff on their behalf. **Reopen to Draft** (Report Workbench) is the
explicit way back into editing; there's no other override. Report
Workbench shows a note above the sheets table when this applies, since its
report picker isn't limited to Draft reports.

The severity rules are plain Python in `manutencao_preditiva/vibration.py`,
and this lock has its own test using a minimal frappe mock
(`manutencao_preditiva/tests/fake_frappe.py` - see its docstring for what it
does and doesn't guarantee); neither needs a bench:

```bash
python -m unittest manutencao_preditiva.tests.test_vibration
python -m unittest manutencao_preditiva.tests.test_equipment_inspection_lock
```

The Portuguese *doctypes* below (Campanha / Achado / Área / Equipamento) are
the earlier, summary-level model, kept only so the historical data imported
into them isn't lost until the user removes it - nothing new should be
written there. The pages that used to write to them are gone: **My
Findings** (ported from Meus Achados, still around - see its section) now
reads Equipment Inspection / Inspection Report instead, and **Registo
Rápido de Achados** (the técnico-facing one) was ported to **Quick Finding
Entry** and then retired outright on 2026-09-23 once **Report Workbench**
could do everything it did and more - see that section. The old doctypes
exist without any still-active way to reach them through the UI.

## Modules (Portuguese, legacy)

Kept for their historical data only - see the note above. Route/page/role
names below stay as they were created; only this description is in English.

- **Campanha De Inspecao** — header of one inspection round for a client
  (Customer, Technique: Vibração/Termografia/…, date, document reference).
- **Area De Inspecao** — area/plant master (e.g. "Sala Eléctrica", "WCP A"),
  always tied to a Customer. Internal name is a series (`AP-00001`) so
  accents/formatting in the free-text name never collide with it - the
  "Área / Planta" field itself stays free to edit/search normally. The
  dropdown on Achado De Inspecao filters automatically by the same
  customer's areas, so a técnico can't type the same area two different ways
  by mistake.
- **Achado De Inspecao** — each defect/finding found, linked to the campanha
  and the area. Includes a "Client Response" section (action taken,
  responsible, due date, status, completion date), writable only by whoever
  has permission level 1 on those fields.

Replaced the earlier "1 Excel per client, emailed" flow: each client gets a
restricted Desk login, scoped via a **User Permission** on Customer to their
own Customer - they see and update only their own findings, never another
client's. Roles: **Tecnico de Inspecao** (internal team, full access) and
**Cliente Portal** (read + respond only).

### Report Workbench (page)

`/app/report-workbench` - the hub that ties the whole Inspection Report
system together, and the only staff-side page for technical data entry
(Quick Finding Entry, its predecessor, was retired 2026-09-23 - see below):
pick or create a report, see its status/team/instrument, its severity
summary, and every Equipment Inspection sheet in it, and edit any of them,
all in one page.

- **Recent Reports** table below the picker - search by customer/area/
  period, filter by Draft/Issued, click a row to load it. **+ New Report**
  opens a creation dialog (customer, area filtered by that customer, date,
  team, instrument) instead of leaving the page.
- Once a report is loaded: **Issue Report** / **Reopen to Draft** toggles
  its status (the same `validate_can_be_issued()` rule applies - every
  sheet needs a severity first), **Print Report** opens Frappe's native
  print preview for it (`frappe.set_route("print", ...)`, so it works with
  any print format later added, not just Vibration Report), **Open Full
  Form** goes to the report's own Desk form for editing its metadata
  (service reference, site address, notes, ...) - this page doesn't
  duplicate those fields.
- **Create Equipment Sheets** opens a **checklist** (2026-09-23) - every
  active equipment in the area without a sheet yet, all pre-checked;
  uncheck anything not being inspected this round, then confirm. Which
  equipment end up covered by a report was never recorded as its own fact
  anywhere - it's always been inferred live from "same customer, same
  area, not Disabled" - so there was no way to leave one out for a single
  round short of disabling it outright. This is still the same live query
  underneath (nothing new is stored), just a deliberate confirmation step
  in front of it instead of silently creating for everyone. **New Sheet**
  (single equipment, excludes equipment that already has a sheet here,
  opens straight into editing since an empty sheet with no readings isn't
  useful on its own) covers the one-off case. Both sit right above the
  sheets table, alongside a **search box**, **severity chips**, and a
  **Table/Cards view toggle** over whatever's already loaded. The native
  Inspection Report form's own "Create Equipment Sheets" button
  (`inspection_report.py`'s `create_sheets()`) still does the old
  unconditional bulk-create with no checklist - consistent with that form
  being the power-user escape hatch elsewhere in this app too.
- Clicking a sheet - in either view - opens it in a **Dialog right there**:
  a plain table (not a native Frappe grid, to reduce risk without a bench
  to test against) with one row per measurement point - mm/s, g's, temp. -
  pre-filled from the equipment's configured points; diagnosis fields; an
  image **gallery** (thumbnails, one caption each, add/remove freely, click
  to open full size); and an "Override suggested severity" checkbox for
  cases where the diagnosis (e.g. a bearing defect seen in the spectrum) is
  worse than the readings alone indicate - otherwise severity keeps
  following the readings automatically (`vibration.py`). Saves via
  `frappe.client.set_value` (not `insert`) once the sheet exists - real
  validation still happens in the Equipment Inspection controller. The
  dialog's own **Open Full Form** link covers anything it doesn't (e.g.
  more detail). A real side panel and a second full page were both
  considered for this dialog and rejected - see the file's header comment
  for why.

Staff-only (System Manager / Tecnico de Inspecao) - not client-facing.

**Quick Finding Entry / Registo Rápido de Achados**, the técnico's
original field-entry page, was ported the same way My Findings was (see
below) but then retired outright once Report Workbench could do everything
it did - creating sheets in bulk or one at a time, the same readings/
diagnosis/gallery editor, search and severity-chip filtering, a Cards view
- plus report creation, browsing Issued reports, and the status/print
actions Quick Finding Entry never had. Keeping two pages that both create
and edit sheets meant keeping the *same* editor code in sync in two places
(this already happened more than once); retiring one removes that tax.
Nothing has been deployed yet, so there was no rollout/bookmark cost to
retiring it - see `WORKFLOW.md` if that calculus changes later.

### My Findings / Meus Achados (client portal)

Dedicated page for the client (`/app/meus-achados`, role **Cliente
Portal**), with two tabs:

- **Dashboard** — stat tiles (total, open, critical, overdue), composition
  charts by severity/status, top-areas/top-equipment rankings, and a trend
  chart of findings by report over time. Always reflects the client's full
  history, not just whatever page of the list is currently loaded.
- **Findings** — search, severity/status filter, and the list itself.
  Clicking a finding opens a dialog with the read-only detail and the
  response section (action taken, responsible, due date, status, completion
  date) - the only fields this role can save, enforced both in the UI and
  in the doctype's permissions (level 1).

Reads Equipment Inspection / Inspection Report (not the old Achado De
Inspecao / Campanha De Inspecao). A finding only appears here once its
Inspection Report is **Issued** - enforced server-side
(`manutencao_preditiva/permissions.py`), not just in this page's query.

**Why this page says "Finding" while the rest of the app says "Sheet"** for
the exact same kind of record (Equipment Inspection): this page is ported
from the old Portuguese Meus Achados and deliberately kept
"Finding"/"Achado" wording for client continuity with what they already
knew; everything else was built fresh with no legacy wording to protect,
so it uses "Sheet" - matching the doctype's own concept. One page,
deliberately, not an inconsistency.

UI is fully English - severity and status are stored in English
(`Normal`/`Acceptable`/`Alarm`/`Critical`/`Not Collected`,
`Open`/`In Progress`/`Done`/`Not Applicable`) and shown as-is, no
translation layer.

Two things the old Achado had that the new Equipment Inspection doesn't
model (left out of the finding's summary): "Componente / Localização do
Defeito" (free text per finding) and "Plano de Monitorização". The card
thumbnail is gone too - Equipment Inspection allows several images per
sheet (a gallery in the detail dialog, captions shown under each photo when
set), not one, and there's no cheap way to bring back "the first one" for
the list without a query per row. In exchange, the detail dialog now shows
the equipment's readings table (point, mm/s, g's, temp.).

### Visual design

Report Workbench and My Findings share one deliberate visual identity
(2026-09-23) - an "instrument panel" for condition monitoring, not a
generic SaaS dashboard: this app replaces printed, severity-coded
inspection reports, so severity/status colour is treated as real signal,
not decoration.

- **Type:** IBM Plex Sans for everything read as prose/UI chrome, IBM Plex
  Mono for anything read as data - readings, dates/periods, IDs, badge
  text, stat-tile numbers. Loaded via a Google Fonts `@import` at the top
  of each page's CSS, with a system-font fallback stack if it's blocked.
- **Colour:** a cool graphite/slate neutral palette (not the warm-cream or
  near-black-plus-acid-accent look generic AI output defaults to), one
  teal accent spent only on primary actions and focus states, and the
  severity/status colours - refined but still meaningfully close to the
  original report's green/amber/orange/red - shared as literal hex
  constants between `report_workbench.js` and `meus_achados.js` (no CSS
  variable, since `frappe.Chart` and inline SVG both need real values).
- **Badges are an indicator light + label** (`rw_badge()`/`ma_badge()`),
  not a filled pill - a small dot in the severity/status colour next to
  plain text, closer to a physical panel's status light than a generic
  SaaS tag.
- **Only one panel per screen gets real elevation and shadow** - the
  loaded report on Report Workbench (`.rw-card-featured`, with a teal top
  edge). Everything else - the sheets list, the recent-reports table, My
  Findings' stat tiles - is hairline-bordered and flat, so that one panel
  actually reads as "the thing in focus" instead of every section looking
  identically boxed (the generic "SaaS card kit" look this was built to
  avoid).
- **The severity summary is a gauge, not a progress bar** - a segmented
  bar with tick marks underneath (`.rw-summary-ticks`), read against a
  legend with monospace counts.
- Table headers and section labels are **not ALL CAPS** - hierarchy comes
  from weight/size/colour instead; the one exception is the loaded
  report's own big status badge (`.rw-badge-lg`), which does use caps,
  matching how a real alarm panel labels its state (ARMED, FAULT, ...) -
  deliberately used exactly once per screen, not as a repeated pattern.

Native Frappe forms and dialogs (Equipment Inspection, Inspection Report,
Print preview) are untouched - reskinning Frappe's own shared Desk chrome
is a materially bigger, riskier undertaking than styling this app's own
pages, and out of scope here.

### Workspaces

Two Workspaces (visible per the user's role, via `roles`):

- **Manutenção Preditiva** — the internal workspace, visible to **System
  Manager** and **Tecnico de Inspecao**, ordered as **Setup** (Vibration
  Alarm Settings, Area, Equipment) → **Workflow**
  (Report Workbench, Inspection Report, Equipment Inspection, Action
  Tracker) → **Client Portal** (shortcut to the client
  view) → **Legacy
  Data (Portuguese model)** (Campanha/Achado/Área/Equipamento and their old
  reports, demoted to the bottom since nothing writes to them anymore).
- **Portal do Cliente** — direct shortcut to the "My Findings" page. Has to
  be named differently from the page itself: Frappe's router resolves
  Workspaces before Pages for the same route segment (`/app/<name>`), so a
  Workspace named "My Findings" would permanently block access to the page
  of that name. Visible to **System Manager** and **Cliente Portal**; kept
  in Portuguese (`Portal do Cliente`) since that name is also the
  `default_workspace` value client accounts are provisioned with in
  `manutencao_preditiva/api.py` - renaming it needs that constant updated
  too, so it was left out of this pass.

### Importing the historical trackers (Excel)

The two original "Action Tracker" files (vibration and thermography) were
already extracted locally into
`manutencao_preditiva/setup/data/achados_import.json` - a flat,
frappe-independent file that ships with the app in git. The original
`.xlsx` files are never committed (see `.gitignore`).

After installing the app on the site (`bench get-app` + `bench migrate`),
just run this, no arguments needed - no `openpyxl` required on the bench,
nothing to upload:

```bash
bench --site <site> execute manutencao_preditiva.setup.import_action_trackers.load_from_json
```

Safe to run more than once - it checks for existing records before creating
duplicates. Creates the "Kenmare"/"CLN" Customers if they don't exist yet,
then the 2 Campanhas and the 321 Achados.

If one of the source Excel files changes, run this locally (needs
`openpyxl`, not frappe) to regenerate the JSON before committing:

```bash
python -c "
from manutencao_preditiva.setup.import_action_trackers import extract_to_json
extract_to_json(
    vibration_file='FR.TEC.014...xlsx',
    thermography_file='FR.TEC.016...xlsx',
)"
```

## License

mit
