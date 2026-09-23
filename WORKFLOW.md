# Vibration Inspection Workflow

How to actually use the Inspection Report system, end to end, plus what's
still missing before it's ready for a real client. See `README.md` for the
data-model/architecture reference; this is the operational walkthrough.

**Status: not yet run against a live bench.** Everything here has been
checked as far as it can be without one (pure-Python tests, a mocked-frappe
harness, a template render) - see "What's missing" below before relying on
it for a real client visit.

## 0. Deploy it

```bash
bench --site <site> migrate
```

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

The **Workflow** block in the same workspace:

1. **Create an Inspection Report** - customer, area, date, team, instrument.
   Starts as **Draft**.
2. **Create the sheets**, either:
   - the **Create Equipment Sheets** button on the report itself (bulk -
     one empty sheet per active equipment in that area), or
   - **Quick Finding Entry**, the técnico's field-entry page: pick the
     (Draft) report, **Create Equipment Sheets** there for the same bulk
     effect, or **New Finding** to add one equipment on the spot.
3. **Enter readings.** Each sheet already lists its equipment's points; the
   técnico types velocity (mm/s), acceleration (g's), temperature per
   point. Severity is computed the moment it's saved - not set manually.
4. **Add the diagnosis.** Defects found, recommendations, actions taken,
   photos. If the readings alone don't tell the full story (e.g. a bearing
   defect visible in the spectrum), tick **Override suggested severity**
   and pick the real severity - otherwise it keeps following the numbers.
5. Repeat per equipment. Quick Finding Entry is the fast path for this; the
   full Equipment Inspection form covers anything the quick page doesn't
   (multiple photos, more detail).

## 3. Finishing

Once every sheet has a severity, set the Inspection Report to **Issued**:

- The client can now see it - My Findings only ever shows Issued reports.
- The **Vibration Report** print format becomes the finished PDF: cover
  page, alarm tables, area summary with pie chart, per-equipment sheets -
  all computed from what was typed in, nothing retyped.

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
- [ ] **Never run against a live bench.** Do the full walkthrough above -
  one small test report, start to finish - on a test site first.
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

### Known gaps (deliberate scope cuts, not bugs)
- [ ] **Quick Finding Entry: one image per edit session**, no multi-image
  gallery or captions there - full galleries need the native Equipment
  Inspection form.
- [ ] **Quick Finding Entry's readings grid is hand-built inputs**, not a
  native Frappe Table control - lower risk without a bench to test
  against, but less capable (e.g. can't add/remove points from there).
- [ ] **My Findings dropped three things** the old Achado had:
  "Componente / Localização do Defeito", "Plano de Monitorização", and
  the card thumbnail image (now only in the detail dialog's gallery).
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
