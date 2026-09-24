# Vibration Inspection Workflow

How to actually use the Inspection Report system, end to end, plus what's
still missing before it's ready for a real client. See `README.md` for the
data-model/architecture reference; this is the operational walkthrough.

**Status: now running on a real bench** (Frappe 15.106.0 / ERPNext
15.105.0) - most of it was only checked without one until now (pure-Python
tests, a mocked-frappe harness, a template render), so treat anything not
yet clicked through end-to-end as unverified. First live bug already found
and fixed: `order_by` referencing a bare column name (`creation`,
`modified`, ...) becomes ambiguous once a query also fetches a dotted
`link.field`, since Frappe joins in that table too. See "What's missing"
below.

## 0. Deploy it

```bash
bench --site <site> migrate
```
claude
This creates the new doctypes and seeds **Vibration Alarm Settings** with
the limits from the FR.TEC.09 report (via `after_install` on a fresh
install, or the `seed_vibration_alarm_settings` patch on an existing site).
Do a first pass on a test site, not the first real client.

## 1. One-time setup, per client

Not repeated per visit - set up once and reused every period. In the
**Manutenção Preditiva** workspace, this is the **Setup** block:

1. **Area** - one record per physical area/plant (e.g. "Linha 2
   Pastorizadora"), linked to the Customer.
2. **Equipment** - one record per machine, under that area:
   - **Rated Power (kW)** - required before any vibration reading can be
     judged (it picks the velocity alarm band).
   - **Measurement Points** - the point codes as the instrument reports
     them (M1H, M2H, M2A, ...). Copied onto every new sheet automatically.

**Vibration Alarm Settings** is already filled in and shared by every
client - only touch it if the actual thresholds change. Also under Setup.

## 2. The repeatable cycle, per visit/month

Everything below happens in **Report Workbench**, the single staff-side
page for this (Quick Finding Entry, an earlier separate page for the same
job, was retired 2026-09-23 once this page did everything it did and more
- see README):

1. Pick an existing report from **Recent Reports** (search by customer/
   area/period, filter Draft/Issued), or **+ New Report** (customer, area,
   date, team, instrument). Starts as **Draft**.
2. **Create the sheets**: **Create Equipment Sheets** shows a checklist of
   the area's active equipment without a sheet yet (pre-checked - uncheck
   any not being done this round) and creates one empty sheet each; or
   **New Sheet** for a single equipment (useful for one added mid-round) -
   either way opens straight into editing.
3. **Enter readings.** Each sheet already lists its equipment's points; the
   técnico types velocity (mm/s), acceleration (g's), temperature per
   point. Severity is computed the moment it's saved - not set manually.
   Click any sheet in the table (or Cards view - there's a toggle, plus a
   search box and severity chips over whatever's loaded) to open it.
4. **Add the diagnosis.** Defects found, recommendations, actions taken,
   photos (a gallery - add several, caption each one). If the readings
   alone don't tell the full story (e.g. a bearing defect visible in the
   spectrum), tick **Override suggested severity** and pick the real
   severity - otherwise it keeps following the numbers.
5. Repeat per equipment. The full Equipment Inspection form ("Open Full
   Form" inside the dialog) covers anything the Workbench's dialog doesn't
   (more than one new photo per save, more detail).

## 3. Finishing

Once every sheet has a severity, click **Issue Report** in Report Workbench
(or set the status to Issued on the form directly):

- The client can now see it - My Findings only ever shows Issued reports.
- **Print Report** in the Workbench opens the finished PDF: cover page,
  alarm tables, area summary with pie chart, per-equipment sheets - all
  computed from what was typed in, nothing retyped.
- **Its sheets lock for technical edits** the moment it's Issued - readings,
  severity, diagnosis, images can't be changed (or a new sheet added)
  without first clicking **Reopen to Draft**. The Client Response section
  stays open throughout, since that's what the client (or staff on their
  behalf) uses after Issue.

## 4. Day to day

- **Client** - **My Findings**: dashboard (totals, severity/status
  breakdown, trend), a searchable list, and a response dialog per finding
  (action taken, responsible, due date, status).
- **You** - **Action Tracker** report: the summary that used to be a
  hand-built Excel file, now an *Export → Excel* click away, always in
  sync with the sheets.

## The outcome

One Inspection Report per period/area *is* the PDF report - not a separate
document retyped afterward - plus a live Excel-equivalent and a client
portal, all reading the same sheets. Nothing entered twice.

---

## What's missing / next steps

### Before trusting it with a real client
- [x] ~~Never run against a live bench.~~ Now running on one (Frappe
  15.106.0 / ERPNext 15.105.0) - do the full walkthrough above, one small
  test report start to finish, before a real client visit.
- [ ] **New visual design (2026-09-23) needs a real-browser check.**
  Verified with headless Chrome screenshots of a static mockup using the
  actual CSS files (not the live Frappe page - Frappe wasn't running), so
  the component-level look is confirmed but the *real* page - Frappe's own
  chrome around it, the Google Fonts import actually loading, wide/narrow
  window behaviour - isn't. See README's "Visual design" section for what
  changed and why.
- [x] ~~Report Workbench reads as unrelated sections; Cards view shows
  nothing.~~ Fixed 2026-09-23, from real feedback on a live-bench
  screenshot: the report header and Equipment Sheets are now one merged
  panel (`.rw-panel-divider` inside `.rw-card-featured`, not a sibling
  card), Recent Reports auto-collapses once a report loads (with a Customer
  filter added for when there are many reports/customers to search
  through), and `switch_sheets_view()` now actually renders Cards instead
  of just toggling an empty container's visibility. Re-verified with a
  headless-Chrome screenshot of the merged layout; still needs the same
  real-bench click-through as everything else in this section.
- [ ] **Print format unverified in real wkhtmltopdf.** Only rendered
  through PyMuPDF as an approximation. Check page breaks, image sizing,
  and the pie chart at real print resolution.
- [ ] **Action Tracker Excel export not spot-checked.** It's a plain
  Script Report export - no colours/formatting like the original
  hand-built workbook. Confirm it's good enough to send as-is, or it needs
  styling.
- [ ] **Client portal not tested with a real Cliente Portal login** - the
  draft-hides-from-clients permission logic (`permissions.py`) is
  reasoned through, not exercised against actual Frappe permission checks.
- [ ] **Report Workbench needs a full click-through.** One bug already
  found and fixed there (see below); the picker, New Report dialog,
  toggling Issue/Draft, the Create Equipment Sheets checklist (brand new,
  2026-09-23 - the sequential-insert loop in particular), New Sheet, the
  sheet editor dialog (readings, gallery), search/chips/Cards view, and
  Print Report are otherwise still unverified against the real bench.
- [ ] **The two new native-form panels (2026-09-23) need a real look too**
  - Equipment's Inspection History and Inspection Report's Equipment
    Sheets (`equipment.js`/`inspection_report.js`). Straightforward
    `get_list` + a hand-built table, same pattern proven elsewhere, but
    never rendered inside an actual Frappe form - worth confirming the
    HTML field's placement/section behaves as expected and the click
    handlers survive a real `refresh()` cycle (re-bound every time, not
    just once, since the whole wrapper is replaced on each call).
- [ ] **The Issue-lock (2026-09-23) needs a real save, not just the mock
  test.** `test_equipment_inspection_lock.py` covers the logic against a
  fake frappe (7 scenarios, all passing - see README), but nothing has
  confirmed the actual server error surfaces cleanly in a real dialog, or
  that `get_doc_before_save()` behaves the same on a real bench as the
  mock assumes.
- [x] ~~`order_by` ambiguous-column crash~~ Fixed 2026-09-23: any query
  fetching a dotted `link.field` (e.g. `area.area_name`) joins that table,
  so a bare `order_by` column (`creation`, `modified`, ...) - or even
  Frappe's *implicit default* order when none is given - can collide with
  the same column name on the joined table. Qualified every affected
  `order_by` with the right table name, or set `order_by: ""` where row
  order didn't matter. If a new query hits this again, that's the fix.

### Known gaps (deliberate scope cuts, not bugs)
- [ ] **Report Workbench's sheet dialog is one hand-built editor now
  covering everything** - readings, diagnosis, a real image gallery
  (add/remove/caption, multiple photos), search/severity-chip filtering,
  and a Table/Cards toggle, all ported into this one page once Quick
  Finding Entry was retired (2026-09-23). None of it has been clicked
  through on the real bench yet (see above).
- [ ] **The readings grid is hand-built inputs**, not a native Frappe
  Table control - lower risk without a bench to test against, but less
  capable (e.g. can't add/remove points from there).
- [ ] **My Findings dropped two things** the old Achado had:
  "Componente / Localização do Defeito" and "Plano de Monitorização". The
  card thumbnail stays gone by design (multiple images per sheet now, no
  cheap "first one" query for a list) but the detail dialog's gallery
  shows captions under each photo since 2026-09-23.
- [ ] **Native Equipment Inspection form's "Images" field is untouched** -
  it's a plain Frappe Table grid (already supports multiple rows, each
  with its own image + caption), just not styled as a gallery. Left as-is:
  it's the power-user fallback ("Open Full Form" from the sheet dialog),
  and reskinning a native grid's rendering is more invasive than the
  hand-built editor above.
- [ ] **Only vibration is built.** Thermography (the other Excel tracker,
  FR.TEC.016) and any other technique need their own Word report examined
  the same way `relatorio 1.pdf` was, plus their thresholds.

### Loose ends from the old system
- [ ] **Old Portuguese doctypes still hold historical data**
  (Achado De Inspecao / Campanha De Inspecao / Area De Inspecao /
  Equipamento De Inspecao) - nothing writes to them anymore, but nothing
  reads them either. You said you'd remove them; that hasn't happened yet.
- [ ] **No migration path** from the old Achado records into the new
  model, if historical continuity in My Findings/Action Tracker ever
  matters.
- [ ] **The "Portal do Cliente" workspace still has its Portuguese name**
  (unlike everything else, which is now English) - it doubles as the
  `default_workspace` client accounts are provisioned with in
  `manutencao_preditiva/api.py` (`PORTAL_WORKSPACE` constant), so renaming
  it means updating that constant too. Left alone in this pass since it's
  a functional identifier, not just display text.

### Worth doing next, roughly in order
1. Deploy + full test-report walkthrough (this is the actual blocker for
   everything else).
2. Fix whatever that walkthrough turns up - it's the first time any of
   this touches real Frappe.
3. Real wkhtmltopdf check of the Vibration Report print format.
4. Decide what to do with the old doctypes (export history then delete,
   or leave them dormant).
5. Get the thermography Word report (and any others) to extend the same
   pattern past vibration.
