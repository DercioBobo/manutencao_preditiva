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

The severity rules are plain Python in `manutencao_preditiva/vibration.py`;
their tests need no bench:

```bash
python -m unittest manutencao_preditiva.tests.test_vibration
```

The Portuguese *doctypes* below (Campanha / Achado / Área / Equipamento) are
the earlier, summary-level model, kept only so the historical data imported
into them isn't lost until the user removes it - nothing new should be
written there. Both pages that used to write to them, **My Findings** (Meus
Achados) and **Quick Finding Entry** (Registo Rápido de Achados), have been
ported and now read/write Equipment Inspection / Inspection Report instead
(see their sections further down), with fully English UI - the old doctypes
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
system together: pick or create a report, see its status/team/instrument,
its severity summary, and every Equipment Inspection sheet in it in one
table, all in one page.

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
- **Create Equipment Sheets** (bulk) and **New Sheet** (single equipment,
  excludes equipment that already has a sheet here) sit right above the
  sheets table. (Quick Finding Entry's equivalent button is called "New
  Finding" instead - see below for why the two pages don't share that
  word.)
- Clicking a sheet in the table navigates to its native Equipment
  Inspection form - **on purpose**, not an inline dialog. That form already
  auto-fills the readings table the moment you pick an equipment (see
  `equipment_inspection.js`), and Quick Finding Entry already has its own
  editing dialog; a third hand-built copy of that same UI here would be a
  third thing to keep in sync with no bench to verify any of them against.
  This page's job is the overview and the connections between the pieces,
  not re-implementing data entry.

Staff-only (System Manager / Tecnico de Inspecao) - not client-facing.

### Quick Finding Entry / Registo Rápido de Achados (page)

Dedicated page for a técnico to log findings quickly in the field, at
`/app/registo-rapido-de-achados` (also reachable through the awesomebar,
e.g. `Ctrl+G` → "Quick Finding Entry"). **Ported** - reads and writes
Equipment Inspection / Inspection Report, not the old Achado De Inspecao /
Campanha De Inspecao. UI is fully English now, like My Findings.

**Why this page says "Finding" while Report Workbench says "Sheet"** for
the exact same kind of record (Equipment Inspection): this page and My
Findings are ported from the old Portuguese pages and deliberately kept
"Finding"/"Achado" wording for técnico and client continuity with what
they already knew; Report Workbench and the Inspection Report/Equipment
Inspection forms were built fresh with no legacy wording to protect, so
they use "Sheet" - matching the doctype's own concept. Two vocabularies,
split cleanly by which pages are ported vs newly built, not a typo.

Structural change from the old flow: a finding is no longer a free-form
entry (a técnico used to be able to log several separate findings for the
same equipment in one campanha); it's now **one sheet per equipment per
report** (Equipment Inspection), with a readings table per measurement
point - reflecting the real structure of the Word report. "New Finding"
here creates/opens that sheet, not a standalone entry:

- Pick a **Report** (only ones in **Draft** show up - once **Issued**,
  editing moves to the full sheet form). Since the area is now fixed per
  report (not chosen per finding like before), a técnico covering several
  areas in one visit needs one report per area.
- **Create Equipment Sheets** creates, in one go, an empty sheet for every
  active equipment in the report's area (reuses the same button that
  already exists on the Inspection Report form). **New Finding** creates a
  sheet for a single equipment (useful for one added mid-round) and opens
  it straight into editing - an empty sheet with no readings isn't useful
  on its own.
- Editing shows a plain table (not a native Frappe grid, to reduce risk
  without a bench to test against) with one row per point - mm/s, g's,
  temp. - pre-filled from the equipment's configured measurement points.
  Severity is **suggested automatically** from the readings (`vibration.py`,
  same as the rest of the system) and is only editable through an "Override
  suggested severity" checkbox, for cases where the diagnosis (e.g. a
  bearing defect seen in the spectrum) is worse than the readings alone
  indicate.
- Only lets you attach **one** new image per edit session (the full
  gallery, with captions, stays on the native Equipment Inspection form - a
  hand-built multi-attachment grid inside a Dialog carried more risk than
  was worth it without a bench to test against).
- Saves via `frappe.client.set_value` (not `insert`) once the sheet exists
  - real validation still happens in the Equipment Inspection controller
  (severity, previous readings, etc.), the same path used by any other way
  of editing the document.

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

UI is fully English - severity and status are stored in English
(`Normal`/`Acceptable`/`Alarm`/`Critical`/`Not Collected`,
`Open`/`In Progress`/`Done`/`Not Applicable`) and shown as-is, no
translation layer.

Two things the old Achado had that the new Equipment Inspection doesn't
model (left out of the finding's summary): "Componente / Localização do
Defeito" (free text per finding) and "Plano de Monitorização". The card
thumbnail is gone too - Equipment Inspection allows several images per
sheet (a gallery in the detail dialog), not one, and there's no cheap way
to bring back "the first one" for the list without a query per row. In
exchange, the detail dialog now shows the equipment's readings table
(point, mm/s, g's, temp.).

### Workspaces

Two Workspaces (visible per the user's role, via `roles`):

- **Manutenção Preditiva** — the internal workspace, visible to **System
  Manager** and **Tecnico de Inspecao**, ordered as **Setup** (Vibration
  Alarm Settings, Area, Equipment) → **Workflow**
  (Report Workbench, Quick Finding Entry, Inspection Report, Equipment
  Inspection, Action Tracker) → **Client Portal** (shortcut to the client
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
