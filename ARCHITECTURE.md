# Strategic Triage Board — Architecture & Logic

A personal task-triage web app. Items flow through time-bucketed lanes (Today, This Week, etc.) and are organized by strategic initiatives. Single-user, password-gated, locally stored with optional Supabase sync. Live at <https://meaglewellyn-blip.github.io/triage/>.

---

## Tech Stack

- **Frontend:** Vanilla HTML / CSS / JS — no build step, no framework.
- **Sync:** Supabase (Postgres + Realtime), with localStorage as the primary cache.
- **Hosting:** GitHub Pages from the `main` branch of `meaglewellyn-blip/triage`.
- **Auth:** Client-side SHA-256 password gate (one shared password for the whole board).

## File Layout

```
Triage/
├── index.html        Markup: sidebar, lanes, modals, password gate
├── styles.css        All styling — warm cream palette, dialog rules,
│                     drag/drop visuals, work-mode + stage pills
├── app.js            All logic (~3900 lines, IIFE-scoped)
├── ARCHITECTURE.md   This file
└── .claude/          (gitignored) launch.json + serve.py for local preview
```

There is no build. Edit, refresh, ship.

---

## Data Model

### Item

The core unit. Every captured task is an item.

```js
{
  id:              uuid,
  title:           string,
  initiative:      string | null,        // initiative name (active/tabled/completed/custom)
  source:          'native' | 'clickup',
  clickupStatus:   string | null,        // original ClickUp status if imported
  clickupSpace:    string | null,
  clickupFolder:   string | null,
  clickupList:     string | null,
  displayGroup:    string | null,        // e.g. 'Imported — In Progress'
  lane:            string,               // see Lanes
  context:         'work' | 'personal',  // defaults to 'work'
  workMode:        'figure-out' | 'collaborate' | 'review' | 'ready-to-launch' | null,
  stage:           'Unclear' | 'In progress' | 'Pending' | 'Blocked' | 'Done',
  dueDate:         'YYYY-MM-DD' | null,
  notes:           string,
  nextStep:        string,
  waitingOn:       string,               // free-text person/thing
  waitingOnItemId: uuid | null,          // OR a hard link to another item
  checklist:       ChecklistEntry[],     // optional subtasks; [] when unused
  archived:        boolean,
  completedAt:     timestamp | null,
  createdAt:       timestamp,
  updatedAt:       timestamp,
}
```

### State

Held in memory, persisted to localStorage and Supabase:

```js
state = {
  items:                Item[],
  tabledInitiatives:    string[],   // names of initiatives currently on hold
  completedInitiatives: string[],   // names of finished initiatives
  deletedInitiatives:   string[],   // names that should never reappear
  customInitiatives:    string[],   // user-added beyond the seeded INITIATIVES list
  filter:               { initiative: string | null },
  contextView:          'work' | 'personal' | 'combined',  // per-device, NOT synced
  completedFilter:      { initiative, period: 'all' | 'this-week' | 'this-month' | 'past-3m' },
  deletedItems:         { id, deletedAt }[],  // deletion tombstones
  activeItemId:         string | null,  // currently expanded card
  ui:                   { editingItemId: string | null },
}
```

`state.items` is the canonical source of truth for both **content** and **order**. Drag-and-drop reorders this array; rendering preserves array order within each lane.

---

## Lanes

Order shown in the sidebar nav (and roughly the page):

| Lane                    | ID                     | Purpose |
|-------------------------|------------------------|---------|
| Inbox                   | `inbox`                | Quick-capture landing zone |
| Overdue                 | `overdue` (virtual)    | Auto-aggregated view of items past their due date |
| Needs Placement         | `needs-placement`      | Items awaiting triage — ClickUp imports + unplaced captures land here |
| Today                   | `today`                | Today's active items — no cap |
| This Week               | `this-week`            | Current week's commitments |
| This Month              | `this-month`           | Slightly farther horizon |
| Strategic Radar         | `strategic-radar`      | Active initiatives — grouped by initiative inside the lane |
| Delegate                | `delegate`             | Items handed off to someone else — you still track progress |
| Distractions            | `distractions` (special) | Standalone subsystem for unplanned-load logs — not a lane; see Distractions section below |
| Waiting / Blocked       | `waiting`              | Anything blocked by a person, dependency, or external event |
| Tabled Items            | `tabled-items`         | Individual items set aside (distinct from a whole tabled initiative) |
| Tabled Initiatives      | `tabled-initiatives`   | Section that appears only if any initiatives are tabled |
| Completed Initiatives   | `completed-initiatives`| Section that appears only if any initiatives are completed |
| Completed               | `completed-items`      | All Done items, with period + initiative filters |
| Archived                | `archived-items`       | Hidden by default; shows only if anything is archived |
| Weekly Review           | `weekly-review`        | Live stats + on-demand text report |

**Overdue** is a virtual aggregator — items still live in their original lane. The overdue section just queries `state.items` by `dueDate < today`.

### Auto-rules

- **Moving an item to `waiting` automatically sets its stage to `Blocked`** (unless already `Done`). Implemented in `moveItem`, `handleCaptureSubmit`, and the cross-lane drag-and-drop path.

---

## Initiatives

Hardcoded seed list lives in `INITIATIVES`. Custom initiatives added by the user live in `state.customInitiatives` and merge in via `getAllInitiatives()`.

Each initiative is in exactly one state:

- **Active** — default. Shows up in sidebar, Strategic Radar, weekly report.
- **Tabled** — in `state.tabledInitiatives`. Hidden from radar; items remain but flagged. A "Tabled" sub-section in the sidebar lists them.
- **Completed** — in `state.completedInitiatives`. Items move to the Completed Initiatives section. A "Completed" sub-section in the sidebar lists them.
- **Deleted** — in `state.deletedInitiatives`. Items become unassigned (`initiative: null`) but stay in their lanes. Initiative never reappears.

State transitions happen via the `···` action button on any initiative chip in the sidebar, or via the `handleInitiativeAction` function.

`getActiveInitiatives()` returns everything that isn't tabled or completed — used for rendering the sidebar, the Strategic Radar, and the weekly report.

### Inline "+ Add Initiative"

The capture/edit modal has a `+` button next to the Initiative dropdown. Clicking it reveals an inline row that lets you name and add a new initiative without leaving the form. New names go into `state.customInitiatives` and appear everywhere the active initiatives are rendered.

---

## Contexts — work vs personal

Every item carries a `context` of `'work'` or `'personal'`. The board shows one
or both, chosen with the three-way toggle in the sidebar header (**Work /
Personal / Both**).

### Why a field and not a second board

Personal items follow exactly the same lane logic, stages, work modes, due
dates and drag-and-drop as work items — the only difference is which lens shows
them. A single item collection keeps all of that shared, and makes the migration
free: `applyMigrations` maps anything not explicitly `'personal'` to `'work'`,
so every pre-existing item stays precisely where it was.

**Initiatives are deliberately not contextual.** They remain one shared list;
a personal item is normally unassigned, or can use a custom initiative.

### The filter gate

`inContext(item)` is the single gate every item-listing path runs through.
`'combined'` lets everything past, so the default view behaves exactly as the
board did before contexts existed.

`getItemsForLane` covers the main lanes, but roughly a dozen renderers query
`state.items` directly (Overdue, Tabled Items, Archived, tabled/completed
initiative sections, Completed, sidebar initiative counts, the initiative
detail modal, and both weekly-review paths). **Each of those calls `inContext`
explicitly** — the gate is intentionally *not* buried inside `isActiveVisible`,
because Completed and Archived deliberately bypass that function and would
otherwise ignore the toggle.

Distractions are *not* context-filtered. They are a separate subsystem for
tracking unplanned work load, so they show in every view.

### View state is per-device

`state.contextView` is excluded from `buildStateData`, and persists on its own
under `localStorage['triage_context_view_v1']`. Which lens you are looking
through on your phone therefore never changes what your laptop shows, and
switching views never touches synced data or the sync trust guards.

### Visual treatment

Personal items get a tinted card surface (`--color-personal-tint`) plus a teal
"Personal" pill. **Deliberately not a left border** — the 3px left stripe is
already spoken for by lane and stage (`open-loop`, `waiting`, `blocked`,
`in-progress`), so `.card--personal` is declared *above* those stripe rules in
`styles.css` to avoid clobbering `border-left-color`. A blocked personal item
therefore shows both signals at once.

Capture inherits the current lens: quick-capture in Personal view files the
item as personal (the placeholder says so), and the capture modal's **Type**
radio defaults to the active view, or Work in Both.

---

## Work Modes

Exactly four. Defined in `WORK_MODES`:

| Mode             | What it means |
|------------------|---------------|
| Figure Out       | Unclear ask or path — dive in and make sense of it |
| Collaborate      | Working through something with others — alignment or shared progress |
| Review           | Read, assess, redline, QA, validate, or pressure-test |
| Ready to Launch  | Finalized — ready to send, present, publish, or hand off |

Rendered as a tinted pill with an inline SVG icon + full label. Icon set is defined inline in `WORK_MODE_ICONS`. CSS tint classes are `.wm--figure-out`, `.wm--collaborate`, `.wm--review`, `.wm--ready-to-launch`.

**Legacy modes** (`communicate`, `move-forward`) are migrated to `null` on load — they are no longer accepted.

## Stages

Five values: `Unclear` (default), `In progress`, `Pending`, `Blocked`, `Done`.

- `Unclear` is the default and renders no pill.
- `Pending` indicates queued / awaiting external readiness (replaces the old `Ready`).
- `Blocked` is set automatically by lane-move logic when an item lands in Waiting.
- `Done` marks completion and stamps `completedAt`.

**Legacy stages** are migrated on load: `Waiting` → `Blocked`, `Ready` → `Pending`.

---

## Card Lifecycle

### Capture

- **Quick capture** (Inbox header): single input, Enter creates an item in Inbox.
- **+ Add** button on any lane header: opens capture modal pre-filled with that lane.
- **Modal** has fields for title, initiative, lane, work mode, stage, due date, notes, next step, waiting-on (free text or linked item).
- **`Cmd/Ctrl+K`** or **`n`** opens the capture modal globally.

#### Next-step triage aid

The Next Step field has two lightweight helpers, none of which block save:

- **Vague-step warning** — `isVagueNextStep()` matches phrases like *figure out, work on, deal with, think about, handle, look at* and shows an amber helper line suggesting a concrete verb instead. Re-checks on every keystroke and when the modal opens for editing.
- **Triage prompts** — a collapsed `<details>` block below the field expands to four questions: *What is this, really? / What is the job right now? / What kind of progress is needed? / What is the single next concrete step?* Closed by default; resets to closed when the modal closes.

`nextStep` is also surfaced on the collapsed card as a single `→` line under the title, max 2 lines, hidden when empty.

#### Optional checklist

Any item can carry a list of subtasks. Entirely optional — items without one show
no checklist UI at all.

```js
ChecklistEntry = { id: uuid, text: string, done: boolean }
```

- **Editor** — in the capture/edit modal, below Notes. Rows are held in a
  module-level `_formChecklist` array while the modal is open (not as form
  fields), so they can be added and removed without fighting `FormData`.
  Written back to the item on submit; **blank rows are discarded**, so an
  accidental "+ Add" never persists. `Enter` inside a row adds the next row
  rather than submitting the form.
- **Collapsed card** — a compact progress chip (`☐ 2/5`, or `☑ 5/5` tinted
  when complete) in the meta row. Renders nothing when there is no checklist.
- **Expanded card** — active entries render as a live list with working
  checkboxes; ticking one goes through `updateItem` so `updatedAt` is stamped
  and the sync trust guards treat it as a genuine local edit. Completed
  entries collapse behind a `<details>` summary. When *everything* is done the
  whole list collapses to "All N checklist items done", so a finished
  checklist stops taking up space.

Persistence needs no special handling: `buildStateData` already serialises
`state.items` wholesale, so `checklist` rides along to localStorage and
Supabase automatically. `applyMigrations` normalises the field on every load
path — older items simply get `[]`, and malformed entries are coerced rather
than dropped.

### Edit

Click the **Edit** button on any card to reopen the same modal with the item loaded. Submitting calls `updateItem` and stamps `updatedAt`.

`handleCaptureSubmit` resolves the edit target as
`state.ui.editingItemId || <hidden form id, if that item still exists>`.
The hidden `name="id"` field was previously set on open but never read, so
anything that cleared `editingItemId` before the submit handler ran (an
overlay closing, a stray outside-click) silently turned an edit into a
**duplicate item**. The fallback closes that hole; `form-id` is explicitly
blanked when opening a fresh capture so a new item can never adopt a stale id.

### Expand / collapse

Clicking a card's main area toggles its expanded state, showing notes, next step, waiting-on chip, source breadcrumb (if imported), and danger actions (Archive, Delete).

### Move

The **Move** button opens a popover listing all lanes. Selecting one calls `moveItem`. Cross-lane drag-and-drop has the same effect.

### Done

The **Done** button calls `markDone` — sets `stage: 'Done'` and stamps `completedAt`. The item disappears from active lanes and shows up in Completed.

### Table vs. Archive vs. Delete

These three are distinct actions, all available on every card:

| Action | What happens | Reversible? |
|--------|--------------|-------------|
| **Table** | Sets `lane: 'tabled-items'`. Item stays visible in the Tabled Items lane. | Yes — Reactivate button restores to Needs Placement. |
| **Archive** | Sets `archived: true`. Item disappears from all active views; only visible in the Archived lane (which itself is hidden if empty). | Yes — Unarchive returns it to Needs Placement. |
| **Delete** | Removes from `state.items` entirely. Confirms first. | No. |

Table = "set aside for later." Archive = "I don't want to see this but might want a record." Delete = "this never happened."

### Drag-and-drop reorder

- Any card is `draggable="true"`. Drag from anywhere on it; the drag handle (`⠇`) is a visual cue.
- Drop on another card: drops in the **top half** → before; **bottom half** → after.
- Cross-lane drop: the dragged item adopts the target's lane (and Blocked stage if landing in Waiting).
- Reorder is persisted in `state.items` array order; no separate sort field needed.

---

## Modals & Popovers

There are two `<dialog>` elements and two `position: fixed` popovers:

| Element | Purpose |
|---------|---------|
| `#capture-modal` (`<dialog>`) | Create / edit item form |
| `#initiative-detail-modal` (`<dialog>`) | All items grouped by lane + done list for a given initiative |
| `#move-popover` | Lane-picker shown next to a card's Move button |
| `#initiative-action-popover` | View / Table / Complete / Reopen / Delete actions for a sidebar initiative |

**Important CSS rules:** `dialog:not([open]) { display: none !important; }` is set globally to prevent dialogs (which can have custom `display: flex` rules) from leaking visible content when closed.

`[hidden] { display: none !important; }` is set for the same reason. Author rules
like `.new-initiative-row { display: flex }` silently outrank the UA stylesheet's
`[hidden] { display: none }`, which had left the inline "+ Add Initiative" row and
the empty "Linked:" chip permanently visible inside the capture modal even though
the JS believed both were hidden. Any element toggled via `el.hidden` depends on
this rule.

**Card-action click delegation lives on `document.body`**, not `#main-content`, so clicks inside the initiative detail modal correctly fire Edit / Done / Table / Archive / Delete.

`render()` proactively calls `closeMovePopover()` and `closeInitiativeActionPopover()` before re-rendering so orphaned popovers can't get stuck after a state change.

---

## Storage Architecture

Three layers, in order of priority:

1. **localStorage** (`triage_board_v4`)
   - Written immediately on every state change.
   - Read first on page load so the UI renders without waiting for the network.

2. **Supabase** (`triage_state` table, single row `id='main'`)
   - Debounced 600ms after each `saveState()`.
   - Authoritative on load — if it returns data, it overrides localStorage.
   - **Realtime subscription** watches for updates from other devices and re-renders. Updates are skipped if a `<dialog>` is open (don't clobber active editing).

3. **JSON export / import**
   - Manual backup via the sidebar buttons.
   - Import replaces all in-memory state and pushes to Supabase.

The sync indicator (bottom-right) shows "Syncing…" briefly during a Supabase push, then "Saved" for 2s.

### Deletion tombstones

`state.deletedItems` holds `{ id, deletedAt }` entries and **is** part of the
synced payload.

The bug this fixes: `shouldBlockFetchOverwrite` compares the newest
`updatedAt` on each side. A deletion *lowers* the local maximum, so deleting
the newest item made local look stale — the guard then applied the remote copy
that still contained the item, and **the deletion undid itself**. Reproduced
against live data on 2026-09-08 with the item "Test", which was the newest item
on the board by ~23 hours.

Three things were wrong together:

1. No record of the deletion existed, so nothing could distinguish "remote is
   newer" from "local deleted the newest thing."
2. All three remote-apply paths cached the **raw remote payload**
   (`localStorage.setItem(STORAGE_KEY, JSON.stringify(data.data))`), which would
   have reintroduced deleted items and discarded tombstones. They now cache
   `buildStateData()` — the state actually applied.
3. Nothing pushed the repair back up, so the stale remote stayed stale.

How it works now:

- `deleteItem` records a tombstone alongside removing the item.
- `restoreStateFromData` unions local and incoming tombstones **first** (a
  deletion this device knows about must not be forgotten just because the
  payload predates it), then filters incoming items through `isTombstoned`.
  It returns the number suppressed.
- A tombstone suppresses an item only while `deletedAt >= item.updatedAt`, so a
  genuine later edit from the other device still wins and the item legitimately
  returns.
- When anything was suppressed, the remote-apply paths `scheduleSupabasePush`
  to repair the stale remote.
- Tombstones prune after `TOMBSTONE_TTL_MS` (90 days), bounding growth.
- A JSON import replaces tombstones outright rather than merging — an import is
  authoritative by intent, and merging would silently re-delete restored items.

### Fresh-install safety guard

`loadState` will seed `getInitialData()` defaults **only if `localStorage.getItem(STORAGE_KEY)` is null AND the Supabase fetch returned nothing.** Bytes in localStorage are treated as opaque evidence of user data, even when they fail to parse. The previous logic (`!hasLocalData && !loadedFromSupabase`) could silently overwrite a corrupt localStorage entry with seed defaults when Supabase was unreachable — a hidden destructive path. The current logic surfaces the parse failure in the diagnostic panel and the sync indicator goes to `error` state instead.

### Schema migrations on load

`applyMigrations()` runs after **every** load path (initial localStorage hydrate, Supabase fetch, realtime push, and visibility-change refresh). It is idempotent and only re-maps deprecated values:

```js
if (item.lane === 'open-loops')                          item.lane = 'needs-placement';
if (['communicate','move-forward'].includes(workMode))   item.workMode = null;
if (item.stage === 'Waiting')                            item.stage = 'Blocked';
if (item.stage === 'Ready')                              item.stage = 'Pending';
if (!Array.isArray(item.checklist))                      item.checklist = [];
if (item.context !== 'personal')                         item.context = 'work';
```

A v1→v2 migration also exists (`migrateItem`) for items captured under the original schema with `status`, `mentalWeight`, `executionType` fields.

### Visibility-based refresh

`setupVisibilityRefresh()` registers `visibilitychange` + `focus` listeners that call `refreshFromSupabase()` whenever the tab returns to the foreground. This guards against the realtime WebSocket being silently killed during mobile-Safari tab suspension. The refresh respects the dialog-open guard and short-circuits if remote state is byte-identical to local cache.

## Distractions (separate subsystem from items)

A lightweight log of unplanned asks, fire drills, and interruptions that displaced planned work. **Not a lane.** Distractions live in their own top-level state array, render in their own section, have their own modal, and never mix with item triage. The point is to make unplanned load visible without dragging it into the task system.

### State

```js
state.distractions = [
  {
    id, date, weekKey,                 // weekKey = Monday of the week, derived from date
    title, summary, sourcePerson,
    category, initiativeImpacted,      // soft string reference (no FK)
    plannedWorkDisplaced,
    estimatedMinutes, delegable,        // 'yes' | 'maybe' | 'no' | null
    rootCause, notes,
    createdAt, updatedAt,
  }
]
```

### Persistence

- `buildStateData` and `restoreStateFromData` include `distractions`.
- `handleJSONImport` reads `data.distractions || []`.
- No migration needed for existing saves — missing `distractions` loads as `[]`.

### Trust guards

`_stateSummary` and `computeLocalLatestUpdatedAt` scan both `state.items` and `state.distractions` for the latest `updatedAt`. The fetch-direction trust guard (`shouldBlockFetchOverwrite`) therefore protects distraction edits the same way it protects item edits.

### UI

- `<section id="distractions">` is placed between Completed Items and Weekly Review in `index.html`. Sidebar nav entry "Distractions" between Completed and Weekly Review.
- Cards group by week via `<details>`; current week is open by default.
- Add/edit handled by `<dialog id="distraction-modal">` with a focused form (title, date, source, category, initiative impacted, planned work displaced, estimated minutes, delegable, root cause, summary, notes). Free-text fields with optional datalist suggestions — nothing enforced.
- Each card shows title, date, and a compact metadata row (person · category · initiative · time · delegable). Optional detail block for displaced/root-cause/summary/notes.

### Weekly Review

One additional stat card: "Distractions This Week" with the count. The Distractions section also shows its own inline header: `N this week · Yh logged`. The text report (`generateWeeklyReport`) is unchanged in Phase 1.

### What's intentionally not built (Phase 2 candidates)

- Distraction lines in the generated text weekly report
- Filters by person / category / delegable / root cause
- CSV export
- Synthesis around recurring process breakdowns / delegation opportunities

### Fetch-direction trust guard (paired with the push guard)

`shouldBlockFetchOverwrite(remoteData)` refuses to apply a Supabase payload (from `loadState`, `refreshFromSupabase`, or a realtime UPDATE event) when the local state has a `latestUpdatedAt` more than 60 seconds newer than the remote's. When blocked, the guard schedules a push to Supabase so the stale remote gets repaired. Prevents the canonical "Supabase paused, resumed serving an old snapshot, page refresh clobbered fresher local" failure mode that bit this project in June 2026. Surfaced in the diagnostic panel as `LAST FETCH > Overwrite blocked`.

### Sync state, push retry, and the diagnostic panel

All sync facts are captured in a single `_sync` object — sync state, last fetch/push outcomes, realtime channel status, event counters, and snapshots of local + remote state.

- **Persistent sync indicator** (bottom-right) shows current state: `Synced · 2m ago`, `Syncing…`, `Local only · tap`, or `Sync error · tap`. Color-coded dot. Tappable.
- **Push retry** — `pushToSupabase` now retries up to 3 attempts with 250ms→500ms backoff. Surfaces failure as the `error` state on the indicator instead of falsely saying "Saved."
- **Diagnostic panel** — tap the sync indicator (or load with `#diag` hash). Shows real numbers: supabase-js CDN load state, client init error if any, local item count + latest `updatedAt`, last fetch result + count + bytes, last push result + retry count, realtime channel status, and event counters. Includes "Fetch now" / "Push now" / "Copy" buttons. Designed to make a phone-side diagnosis possible without devtools.
- **Cache-bust query strings** — `app.js?v=…` and `styles.css?v=…` in `index.html`. Bumped on each deploy to force browsers (notably Safari) to re-validate cached copies.

### Sync-related logging

All sync logs use the `[triage]` prefix:
- `local snapshot at boot: { items, latestUpdatedAt, bytes }`
- `Loaded state from Supabase: { items, latestUpdatedAt, bytes }`
- `Refreshed from Supabase: { … fromVisibility: true/false }`
- `Supabase push ok (attempt N)` / `Supabase push attempt N failed: <err>`
- `realtime status: <SUBSCRIBED | CLOSED | CHANNEL_ERROR | TIMED_OUT>`
- `realtime applied: { items, latestUpdatedAt }` / `realtime event skipped: <reason>`

---

## Password Gate

- The page loads with `<body class="app-locked">` and a full-screen `#password-gate` overlay.
- `sha256(typed)` is compared client-side to a hardcoded `AUTH_HASH`.
- Success sets `sessionStorage['triage_authed_v1'] = '1'`, fades the overlay, calls `init()`.
- The password gates UI access only — it is not encryption. Anyone with the JS file can read the hash.

To change the password: compute `sha256("newpassword")` and replace `AUTH_HASH` in `app.js`.

---

## ClickUp CSV Import

`handleCSVImport()` parses uploaded CSV files and maps rows to items:

- `CLICKUP_STATUS_MAP` translates ClickUp statuses (e.g. `doing`, `to do`, `blocked`) to a `{lane, displayGroup, itemStage}` shape.
- `matchInitiative()` does fuzzy word matching against the `INITIATIVES` list using `Task Name`, `Folder`, `List` columns.
- `parseClickUpDate()` handles both `MM/DD/YYYY` and long-form (`Friday, May 15th 2026`) date formats.
- Imported items get `source: 'clickup'` and a breadcrumb of `space › folder › list` shown in the expanded card.

The Import button is wired in HTML (`#import-json-btn`) but exposes JSON import; CSV import is internal — drop into `handleCSVImport(file)` from devtools if needed.

---

## Weekly Review

Two parts on the `#weekly-review` lane:

### Live summary (`renderWeeklyReview`)

Five stat cards:

- Completed This Week
- Active Items
- Blocked
- Overdue
- Needs Placement

Tabled and completed-initiative items are excluded from all counts.

### Text report (`generateWeeklyReport`)

Generated on demand. Plain text, monospace, dark-on-light. Sections:

```
COMPLETED THIS WEEK (n)
  ✓ <title>

ACTIVE BY INITIATIVE
  <INITIATIVE>
    · <title> [<lane> · <stage>]
       → <nextStep>

BLOCKED (n)
  ⊘ <title>  ← <waitingOn>

OVERDUE (n)
  !  <title>  [due: YYYY-MM-DD]

TABLED (n), COMPLETED INITIATIVES (n)

WHAT NEEDS ATTENTION THIS WEEK
  <synthesis based on overdue + blocked + week load>
```

Copy button uses `navigator.clipboard`.

---

## Rendering Flow

`render()` is the single entry point. Called after every state mutation:

1. Close any open popovers (move, initiative-action).
2. Re-render the sidebar (active inits, tabled, completed, week label).
3. Re-render each lane via `renderLane(laneId)` — which delegates to specialized renderers for `strategic-radar`, `needs-placement`, `this-week`.
4. Re-render Overdue (virtual aggregator), Tabled Items, Archived.
5. Re-render Tabled Initiatives + Completed Initiatives sections.
6. Re-render Completed Items (respecting filter chips).
7. Re-render Weekly Review stats.
8. If the initiative detail modal is open, re-render its body in place so card-action clicks reflect immediately.

`updateLaneMeta(laneId, count)` syncs the badge in the sidebar with the per-lane count.

`getItemsForLane(laneId)` is the common filter: `lane match` + `isActiveVisible` (not archived, not Done, not in a tabled/completed initiative) + the user's initiative filter (if set).

---

## Event System

All event handlers wire up once in `setupEvents()`:

- **`document.body`** — card actions (move, edit, done, table, reactivate, archive, unarchive, delete), dep-link clicks, card expand/collapse, add-to-lane buttons, initiative reopen/activate buttons.
- **`.initiative-panel`** — initiative chip click → detail modal; `···` button → action popover.
- **`#initiative-action-popover`** — routes action buttons through `handleInitiativeAction`.
- **`#move-popover-options`** — routes lane selection through `moveItem`.
- **`#quick-capture-input` / `#quick-capture-submit`** — Inbox quick capture.
- **`#capture-form` + close / cancel / outside-click** — capture modal.
- **`#init-detail-close-btn` + outside-click** — initiative detail modal.
- **`#completed-period-chips` / `#completed-initiative-filter`** — completed view filters.
- **`#export-json-btn` / `#import-json-btn` / `#json-file-input`** — JSON backup.
- **`#generate-report-btn` / `#copy-report-btn`** — weekly report.
- **`#reset-data-btn`** — clear-all-data (confirms first).
- **`#add-initiative-btn` + `#new-initiative-confirm` + `#new-initiative-cancel`** — inline initiative add.
- **document `keydown`** — `Cmd/Ctrl+K` or `n` open capture; `Escape` closes the top-most overlay.
- **document drag/drop events** — handled in `setupDragAndDrop()`.

A `setupScrollSpy()` uses `IntersectionObserver` to highlight the active sidebar link as the user scrolls.

---

## Constants Worth Knowing

```js
STORAGE_KEY      = 'triage_board_v4'
AUTH_SESSION_KEY = 'triage_authed_v1'
SUPABASE_URL     = '...'   // hardcoded in app.js
SUPABASE_ANON_KEY = '...'  // hardcoded in app.js
AUTH_HASH        = '...'   // SHA-256 of access password
DEFAULT_TABLED   = ['Better Websites']  // initiatives tabled by default on fresh install
```

---

## Hosting & Deploy

- Repo: `meaglewellyn-blip/triage` on GitHub (transferred from `meagan-design` on 2026-09-02).
- Branch `main` is served as the live site by GitHub Pages.
- No CI — push to `main` and Pages rebuilds in ~30–60s.
- Local preview can be served from any static file server (`python3 -m http.server 8081` from this directory).

---

## Quick Reference — Common Tasks

| Want to... | Edit |
|------------|------|
| Add a new lane | `LANES` array + add `<section>` markup in `index.html` + add a renderer if it needs grouping |
| Add a new stage value | `STAGES` array + form `<option>` in `index.html` + `stagePillHtml` mapping + CSS class |
| Add a new work mode | DON'T — the system is capped at four. If you must: `WORK_MODES`, `WORK_MODE_ICONS`, form `<option>`, CSS `.wm--<id>` |
| Add a new initiative permanently | Add to `INITIATIVES` array (the seed). For user-added ones, just use the `+` in the capture modal. |
| Add a new item-listing view | Filter through `inContext(item)` as well as `isActiveVisible`, or the work/personal toggle will ignore it |
| Change the password | Compute `sha256("newpassword")` (browser devtools), replace `AUTH_HASH` |
| Disable Supabase sync | Set `SUPABASE_URL` to `'REPLACE_WITH_YOUR_SUPABASE_URL'` — `initSupabase` will skip wiring |
| Reset Supabase state | Run `delete from triage_state where id = 'main';` in the Supabase SQL editor |
