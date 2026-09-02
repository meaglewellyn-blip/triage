/* ============================================================
   Strategic Triage Board — app.js
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     1. CONSTANTS & CONFIG
  ========================================================== */

  const STORAGE_KEY = 'triage_board_v4';
  const APP_VERSION = '20260902a';

  /* ----------------------------------------------------------
     SUPABASE CONFIG
     Fill these in after creating your Supabase project.
     See setup instructions in the README.
  ---------------------------------------------------------- */
  const SUPABASE_URL      = 'https://dasmczehszbimiserntk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhc21jemVoc3piaW1pc2VybnRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTEyNTUsImV4cCI6MjA5Mjg4NzI1NX0.DBjEeN0Yt0OeJ144r5Wp3QMWliX2aG4n8H8yGa7Q-8I';

  /* ----------------------------------------------------------
     PASSWORD GATE
     SHA-256 hash of the access password.
  ---------------------------------------------------------- */
  const AUTH_HASH = '73ab4fd8b55a6812e78948471eda2885fe63e351553f2ba7fa8c8881ce23e3f9';
  const AUTH_SESSION_KEY = 'triage_authed_v1';

  const LANES = [
    { id: 'inbox',           label: 'Inbox' },
    { id: 'needs-placement', label: 'Needs Placement' },
    { id: 'today',           label: 'Today' },
    { id: 'this-week',       label: 'This Week' },
    { id: 'this-month',      label: 'This Month' },
    { id: 'strategic-radar', label: 'Strategic Radar' },
    { id: 'delegate',        label: 'Delegate' },
    { id: 'waiting',         label: 'Waiting / Blocked' },
    { id: 'tabled-items',    label: 'Tabled Items' },
  ];

  const INITIATIVES = [
    'BF Commercial Relationship',
    'Sales Team',
    'Installation Sales Framework',
    'International Distributors',
    'US Distribution / Master Halco',
    'Legal / Web',
    'Meta / CRM Lead Optimization',
    'Distribution Pivot',
    'Picket',
    'Better Websites',
    'Commercial Ops Platform',
  ];

  // Initiatives tabled by default on first run
  const DEFAULT_TABLED = ['Better Websites'];

  const WORK_MODES = [
    { id: 'figure-out',      label: 'Figure Out',      abbr: 'FO',
      desc: 'Unclear ask or path — dive in and make sense of it' },
    { id: 'collaborate',     label: 'Collaborate',     abbr: 'CL',
      desc: 'Working through something with others — alignment or shared progress' },
    { id: 'review',          label: 'Review',          abbr: 'RV',
      desc: 'Read, assess, redline, QA, validate, or pressure-test' },
    { id: 'ready-to-launch', label: 'Ready to Launch', abbr: 'RL',
      desc: 'Finalized — ready to send, present, publish, or hand off' },
  ];

  const STAGES = ['Unclear', 'In progress', 'Pending', 'Blocked', 'Done'];

  /* ----------------------------------------------------------
     CLICKUP STATUS MAP
     Keys are lowercase (matching is case-insensitive).
  ---------------------------------------------------------- */
  const CLICKUP_STATUS_MAP = {
    'doing':        { lane: 'this-week',       displayGroup: 'Imported — In Progress', itemStage: 'In progress' },
    'in progress':  { lane: 'this-week',       displayGroup: 'Imported — In Progress', itemStage: 'In progress' },
    'in-progress':  { lane: 'this-week',       displayGroup: 'Imported — In Progress', itemStage: 'In progress' },
    'to do':        { lane: 'needs-placement', displayGroup: 'Imported — To Do',       itemStage: 'Unclear'     },
    'todo':         { lane: 'needs-placement', displayGroup: 'Imported — To Do',       itemStage: 'Unclear'     },
    'open':         { lane: 'needs-placement', displayGroup: 'Imported — To Do',       itemStage: 'Unclear'     },
    'not started':  { lane: 'needs-placement', displayGroup: 'Imported — To Do',       itemStage: 'Unclear'     },
    'blocked':      { lane: 'waiting',         displayGroup: 'Imported — Blocked',     itemStage: 'Blocked'     },
    'on hold':      { lane: 'waiting',         displayGroup: 'Imported — Blocked',     itemStage: 'Blocked'     },
    'complete':     { lane: 'needs-placement', displayGroup: null,                     itemStage: 'Done'        },
    'completed':    { lane: 'needs-placement', displayGroup: null,                     itemStage: 'Done'        },
    'done':         { lane: 'needs-placement', displayGroup: null,                     itemStage: 'Done'        },
    'closed':       { lane: 'needs-placement', displayGroup: null,                     itemStage: 'Done'        },
    'review':       { lane: 'this-week',       displayGroup: 'Imported — In Progress', itemStage: 'In progress' },
  };

  const CLICKUP_STATUS_DEFAULT = {
    lane: 'needs-placement', displayGroup: 'Imported — To Do', itemStage: 'Unclear',
  };

  /* ==========================================================
     2. STATE
  ========================================================== */

  let state = {
    items:                [],
    tabledInitiatives:    [],
    completedInitiatives: [],
    deletedInitiatives:   [],
    customInitiatives:    [],
    distractions:         [],
    filter:               { initiative: null },
    completedFilter:      { initiative: null, period: 'all' },
    activeItemId:         null,
    ui:                   { editingItemId: null, editingDistractionId: null },
  };

  /* ==========================================================
     3. SUPABASE CLIENT
  ========================================================== */

  // Initialised once, after DOMContentLoaded. null if config not yet set.
  let supabaseClient = null;
  let _supabaseSaveTimer = null;

  // Single source of truth for everything sync-related. Drives the persistent
  // indicator and the in-page diagnostic panel. Captured here so we don't need
  // devtools open on phone to see what is actually happening.
  const _sync = {
    state:             'init',           // init | syncing | synced | error | local-only | offline
    sdkLoaded:         null,             // window.supabase present?
    clientReady:       false,            // createClient succeeded
    initError:         null,
    lastFetchAt:       null,             // ms epoch
    lastFetchOk:       null,             // true | false | null
    lastFetchError:    null,             // human message
    lastFetchErrorName:null,             // e.name (TypeError | etc.)
    lastFetchErrorClass:null,            // e.constructor.name
    lastFetchUrl:      null,             // exact URL attempted
    lastFetchSummary:  null,             // { items, latestUpdatedAt, bytes, fromVisibility }
    lastPushAt:        null,
    lastPushOk:        null,
    lastPushError:     null,
    lastPushErrorName: null,
    pushAttempts:      0,
    pushRetries:       0,
    pushBlocked:       false,            // true when guard refused an auto-push
    pushBlockedReason: null,
    realtimeStatus:    null,
    realtimeEvents:    0,
    realtimeApplied:   0,
    realtimeSkipped:   0,
    localSnapshot:     null,             // captured at boot
    localParseError:   null,
    connectivity:      null,             // last connectivity-probe result
  };

  // The exact URL Supabase REST hits — used for connectivity probes and diag.
  const _restUrl = SUPABASE_URL + '/rest/v1/triage_state?select=data&id=eq.main';
  const _restRoot = SUPABASE_URL + '/rest/v1/';

  function _captureError(e) {
    if (!e) return { name: null, cls: null, msg: 'null' };
    return {
      name: (e.name || null),
      cls:  (e.constructor && e.constructor.name) || null,
      msg:  String(e && e.message || e),
    };
  }

  // Symmetric guard for the FETCH direction: refuse to overwrite local state
  // with a Supabase payload that is older than what we already have. The
  // canonical failure mode this prevents: paused-and-resumed Supabase project
  // serves a stale snapshot, and a casual page refresh clobbers a newer
  // localStorage with the stale snapshot. Returns null if the fetch is safe to
  // apply, otherwise returns a human-readable reason.
  const FETCH_OVERWRITE_GRACE_MS = 60_000;
  function shouldBlockFetchOverwrite(remoteData) {
    const remoteLatest = (_stateSummary(remoteData) || {}).latestUpdatedAt || 0;
    const localLatest  = computeLocalLatestUpdatedAt();
    if (!localLatest) return null;                       // no local data → safe to apply
    if (localLatest <= remoteLatest + FETCH_OVERWRITE_GRACE_MS) return null;
    const ageDays = Math.round((localLatest - remoteLatest) / 86400000);
    return `Remote is ${ageDays}d older than local — refusing to overwrite. Pushing local up instead.`;
  }

  function computeLocalLatestUpdatedAt() {
    let latest = 0;
    for (const it of (state.items || [])) {
      if (it && typeof it.updatedAt === 'number' && it.updatedAt > latest) latest = it.updatedAt;
    }
    for (const d of (state.distractions || [])) {
      if (d && typeof d.updatedAt === 'number' && d.updatedAt > latest) latest = d.updatedAt;
    }
    return latest;
  }

  function shouldBlockAutoPush() {
    if (_sync.lastFetchOk === true) return null;                  // fetched OK → trust local
    if (_sync.lastPushOk === true)  return null;                  // already pushed OK this session
    const snap = _sync.localSnapshot;
    if (!snap || !snap.latestUpdatedAt) {
      return 'No verified Supabase fetch this session and local has no timestamp — refusing auto-push.';
    }
    const ageDays = (Date.now() - snap.latestUpdatedAt) / 86400000;
    if (ageDays > 7) {
      return 'Local state is ' + Math.round(ageDays) + 'd old and no successful Supabase fetch this session — refusing auto-push.';
    }
    return null;
  }

  function _stateSummary(data) {
    if (!data || !Array.isArray(data.items)) return { items: 0, latestUpdatedAt: null, bytes: 0 };
    let latest = 0;
    for (const it of data.items) {
      if (it && typeof it.updatedAt === 'number' && it.updatedAt > latest) latest = it.updatedAt;
    }
    const distractions = Array.isArray(data.distractions) ? data.distractions : [];
    for (const d of distractions) {
      if (d && typeof d.updatedAt === 'number' && d.updatedAt > latest) latest = d.updatedAt;
    }
    let bytes = 0;
    try { bytes = JSON.stringify(data).length; } catch (e) {}
    return { items: data.items.length, latestUpdatedAt: latest || null, bytes };
  }

  function initSupabase() {
    _sync.sdkLoaded = !!(window.supabase && typeof window.supabase.createClient === 'function');
    if (!_sync.sdkLoaded) {
      _sync.state = 'local-only';
      _sync.initError = 'supabase-js SDK did not load (CDN blocked or network issue)';
      console.warn('[triage]', _sync.initError);
      return;
    }
    if (
      SUPABASE_URL  === 'REPLACE_WITH_YOUR_SUPABASE_URL' ||
      SUPABASE_ANON_KEY === 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY'
    ) {
      _sync.state = 'local-only';
      _sync.initError = 'Supabase not configured';
      console.info('[triage]', _sync.initError);
      return;
    }
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      _sync.clientReady = true;
      console.info('[triage] Supabase client created.');
    } catch (e) {
      _sync.state = 'local-only';
      _sync.initError = String(e && e.message || e);
      console.warn('[triage] Supabase init failed:', e);
    }
  }

  function renderSyncIndicator() {
    const el  = document.getElementById('sync-indicator');
    const dot = document.getElementById('sync-dot');
    const lbl = document.getElementById('sync-label');
    if (!el || !dot || !lbl) return;

    el.classList.add('visible');
    el.dataset.state = _sync.state;
    dot.className = 'sync-dot sync-dot--' + _sync.state;

    let txt;
    switch (_sync.state) {
      case 'syncing':    txt = 'Syncing…'; break;
      case 'synced':     txt = 'Synced' + (_sync.lastFetchAt ? ' · ' + _agoText(_sync.lastFetchAt) : ''); break;
      case 'error':      txt = 'Sync error · tap'; break;
      case 'local-only': txt = 'Local only · tap'; break;
      case 'offline':    txt = 'Offline · tap'; break;
      default:           txt = 'Loading…';
    }
    lbl.textContent = txt;
  }

  function _agoText(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const s = Math.floor(diff / 1000);
    if (s < 60)    return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60)    return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24)    return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  // Re-render the indicator every 15s so the "Xm ago" text stays fresh.
  setInterval(() => { if (_sync.state === 'synced') renderSyncIndicator(); }, 15000);

  async function pushToSupabase(data, { manual = false } = {}) {
    if (!supabaseClient) {
      _sync.state = 'local-only';
      renderSyncIndicator();
      return false;
    }

    // Trust guard — never auto-push state that we can't prove is current.
    if (!manual) {
      const blocked = shouldBlockAutoPush();
      if (blocked) {
        _sync.pushBlocked       = true;
        _sync.pushBlockedReason = blocked;
        _sync.state             = 'error';
        renderSyncIndicator();
        console.warn('[triage] Auto-push blocked:', blocked);
        return false;
      }
    }
    _sync.pushBlocked       = false;
    _sync.pushBlockedReason = null;

    _sync.state = 'syncing';
    renderSyncIndicator();

    const maxAttempts = 3;
    _sync.pushAttempts = 0;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      _sync.pushAttempts = attempt;
      if (attempt > 1) _sync.pushRetries++;
      try {
        const { error } = await supabaseClient
          .from('triage_state')
          .upsert({ id: 'main', data, updated_at: new Date().toISOString() });
        if (error) throw error;
        _sync.lastPushAt      = Date.now();
        _sync.lastPushOk      = true;
        _sync.lastPushError   = null;
        _sync.lastPushErrorName = null;
        _sync.state           = 'synced';
        _sync.lastFetchAt     = _sync.lastFetchAt || Date.now();
        renderSyncIndicator();
        console.info('[triage] Supabase push ok (attempt ' + attempt + ').');
        return true;
      } catch (e) {
        lastErr = e;
        console.warn('[triage] Supabase push attempt ' + attempt + ' failed:', e);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt - 1))); // 250, 500
        }
      }
    }
    const cap = _captureError(lastErr);
    _sync.lastPushAt        = Date.now();
    _sync.lastPushOk        = false;
    _sync.lastPushError     = cap.msg;
    _sync.lastPushErrorName = cap.name + (cap.cls && cap.cls !== cap.name ? ' / ' + cap.cls : '');
    _sync.state             = 'error';
    renderSyncIndicator();
    if (manual) showToast('Push failed — see Diagnostics for details', 3500);
    return false;
  }

  function scheduleSupabasePush(data) {
    clearTimeout(_supabaseSaveTimer);
    _supabaseSaveTimer = setTimeout(() => pushToSupabase(data), 600);
  }

  function setupRealtimeSync() {
    if (!supabaseClient) return;
    supabaseClient
      .channel('triage_realtime')
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'triage_state',
        filter: 'id=eq.main',
      }, payload => {
        _sync.realtimeEvents++;
        if (!payload.new?.data) {
          _sync.realtimeSkipped++;
          console.info('[triage] realtime event missing data, skipped.');
          renderSyncIndicator();
          return;
        }
        if (document.querySelector('dialog[open]')) {
          _sync.realtimeSkipped++;
          console.info('[triage] realtime event skipped: dialog open.');
          renderSyncIndicator();
          return;
        }
        // Trust guard for the FETCH/realtime direction.
        const blocked = shouldBlockFetchOverwrite(payload.new.data);
        if (blocked) {
          _sync.realtimeSkipped++;
          _sync.fetchOverwriteBlocked = blocked;
          console.warn('[triage] realtime event ignored:', blocked);
          renderSyncIndicator();
          scheduleSupabasePush(buildStateData());
          return;
        }
        _sync.fetchOverwriteBlocked = null;
        restoreStateFromData(payload.new.data);
        applyMigrations();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.new.data)); } catch(e) {}
        _sync.realtimeApplied++;
        _sync.lastFetchAt      = Date.now();
        _sync.lastFetchOk      = true;
        _sync.lastFetchSummary = _stateSummary(payload.new.data);
        _sync.state            = 'synced';
        renderSyncIndicator();
        render();
        showToast('Board updated from another device', 2000);
        console.info('[triage] realtime applied:', _sync.lastFetchSummary);
      })
      .subscribe(status => {
        _sync.realtimeStatus = status;
        console.info('[triage] realtime status:', status);
        renderSyncIndicator();
      });
  }

  function setupVisibilityRefresh() {
    // Mobile Safari (and any background-suspended tab) can lose the realtime
    // WebSocket. Re-fetch from Supabase when the tab returns to foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshFromSupabase({ fromVisibility: true });
    });
    // Also refresh on focus, as a belt-and-suspenders for desktop window switches.
    window.addEventListener('focus', () => refreshFromSupabase({ fromVisibility: true }));
  }

  /* ==========================================================
     3a. DIAGNOSTIC PANEL
     ----------------------------------------------------------
     A visible, on-device diagnostic. Tap the sync indicator to open it.
     Shows real numbers (not console hopes) so phone users without devtools
     can see exactly why sync isn't behaving.
  ========================================================== */

  function buildDiagSnapshot() {
    let storedBytes = 0;
    try { storedBytes = (localStorage.getItem(STORAGE_KEY) || '').length; } catch (e) {}
    return {
      now:              new Date().toISOString(),
      appVersion:       APP_VERSION,
      userAgent:        navigator.userAgent,
      online:           navigator.onLine,
      visibility:       document.visibilityState,
      supabase: {
        sdkLoaded:      _sync.sdkLoaded,
        clientReady:    _sync.clientReady,
        initError:      _sync.initError,
        url:            SUPABASE_URL.replace(/(https?:\/\/)([^.]{6}).*?(\.supabase\.co)/, '$1$2…$3'),
        anonKeyLen:     SUPABASE_ANON_KEY.length,
      },
      local: {
        items:          _sync.localSnapshot ? _sync.localSnapshot.items : null,
        latestUpdated:  _sync.localSnapshot && _sync.localSnapshot.latestUpdatedAt
                          ? new Date(_sync.localSnapshot.latestUpdatedAt).toISOString() : null,
        storedBytes,
        currentItems:   state.items.length,
        parseError:     _sync.localParseError || null,
      },
      fetch: {
        url:                 _sync.lastFetchUrl,
        lastAt:              _sync.lastFetchAt ? new Date(_sync.lastFetchAt).toISOString() : null,
        ok:                  _sync.lastFetchOk,
        error:               _sync.lastFetchError,
        errorType:           _sync.lastFetchErrorName,
        items:               _sync.lastFetchSummary ? _sync.lastFetchSummary.items : null,
        latestUpdated:       _sync.lastFetchSummary && _sync.lastFetchSummary.latestUpdatedAt
                               ? new Date(_sync.lastFetchSummary.latestUpdatedAt).toISOString() : null,
        bytes:               _sync.lastFetchSummary ? _sync.lastFetchSummary.bytes : null,
        overwriteBlocked:    _sync.fetchOverwriteBlocked || null,
      },
      push: {
        lastAt:         _sync.lastPushAt ? new Date(_sync.lastPushAt).toISOString() : null,
        ok:             _sync.lastPushOk,
        error:          _sync.lastPushError,
        errorType:      _sync.lastPushErrorName,
        attempts:       _sync.pushAttempts,
        retries:        _sync.pushRetries,
        blocked:        _sync.pushBlocked,
        blockedReason:  _sync.pushBlockedReason,
      },
      connectivity:     _sync.connectivity,
      realtime: {
        status:         _sync.realtimeStatus,
        eventsReceived: _sync.realtimeEvents,
        applied:        _sync.realtimeApplied,
        skipped:        _sync.realtimeSkipped,
      },
      state: _sync.state,
    };
  }

  function openDiagPanel() {
    const panel = document.getElementById('diag-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.classList.add('visible');
    renderDiagPanel();
  }

  function closeDiagPanel() {
    const panel = document.getElementById('diag-panel');
    if (!panel) return;
    panel.classList.remove('visible');
    panel.hidden = true;
  }

  function renderDiagPanel() {
    const out = document.getElementById('diag-content');
    if (!out) return;
    const d = buildDiagSnapshot();

    const row = (k, v) => `<div class="diag-row"><span class="diag-key">${escapeHtml(k)}</span><span class="diag-val">${escapeHtml(String(v == null ? '—' : v))}</span></div>`;
    const section = (title, rows) => `<div class="diag-section"><h4>${escapeHtml(title)}</h4>${rows.join('')}</div>`;

    let connHtml = '';
    if (d.connectivity && d.connectivity.results) {
      const r = d.connectivity.results;
      const probeRow = (name, p) => {
        if (!p) return row(name, '—');
        if (p.ok) return row(name, `${p.status} · ${p.ms}ms`);
        const tag = p.instantFail ? 'INSTANT-FAIL' : 'FAIL';
        return row(name, `${tag} · ${p.ms}ms · ${p.errorName || '?'} · ${p.error || ''}`);
      };
      connHtml = section('CONNECTIVITY PROBE ' + (d.connectivity.at ? '(' + d.connectivity.at + ')' : ''), [
        probeRow('cloudflare 1.1.1.1',          r.cloudflareTrace),
        probeRow('httpbin.org JSON',            r.httpbin),
        probeRow('api.github.com JSON',         r.githubApi),
        probeRow('supabase.com (home)',         r.supabaseHome),
        probeRow('jsdelivr SDK origin',         r.jsdelivr),
        probeRow('your supabase REST root',     r.supabaseRoot),
        probeRow('your supabase authed',        r.supabaseAuthed),
        probeRow('your supabase realtime',      r.supabaseRealtime),
        probeRow('your supabase via <img>',     r.supabaseImage),
        probeRow('your supabase via WebSocket', r.supabaseSocket),
      ]);
    }

    out.innerHTML = `
      ${section('STATUS', [
        row('Sync state',   d.state),
        row('App version',  d.appVersion),
        row('Online',       d.online),
        row('Visibility',   d.visibility),
        row('Time',         d.now),
      ])}
      ${section('SUPABASE CLIENT', [
        row('SDK loaded',   d.supabase.sdkLoaded === true ? 'yes' : d.supabase.sdkLoaded === false ? 'NO (CDN blocked?)' : '—'),
        row('Client ready', d.supabase.clientReady ? 'yes' : 'no'),
        row('Init error',   d.supabase.initError),
        row('URL',          d.supabase.url),
        row('Anon key len', d.supabase.anonKeyLen),
      ])}
      ${section('LOCAL (localStorage)', [
        row('Items at boot',      d.local.items),
        row('Latest updatedAt',   d.local.latestUpdated),
        row('Stored bytes',       d.local.storedBytes),
        row('Items in memory',    d.local.currentItems),
        row('Parse error',        d.local.parseError),
      ])}
      ${section('LAST FETCH FROM SUPABASE', [
        row('URL',                d.fetch.url),
        row('At',                 d.fetch.lastAt),
        row('OK',                 d.fetch.ok == null ? '—' : (d.fetch.ok ? 'yes' : 'NO')),
        row('Error',              d.fetch.error),
        row('Error type',         d.fetch.errorType),
        row('Items',              d.fetch.items),
        row('Latest updatedAt',   d.fetch.latestUpdated),
        row('Bytes',              d.fetch.bytes),
        row('Overwrite blocked',  d.fetch.overwriteBlocked),
      ])}
      ${section('LAST PUSH TO SUPABASE', [
        row('At',          d.push.lastAt),
        row('OK',          d.push.ok == null ? '—' : (d.push.ok ? 'yes' : 'NO')),
        row('Error',       d.push.error),
        row('Error type',  d.push.errorType),
        row('Attempts',    d.push.attempts),
        row('Retries',     d.push.retries),
        row('Auto-blocked',d.push.blocked ? 'YES' : 'no'),
        row('Block reason',d.push.blockedReason),
      ])}
      ${connHtml}
      ${section('REALTIME', [
        row('Channel status', d.realtime.status),
        row('Events received',d.realtime.eventsReceived),
        row('Applied',        d.realtime.applied),
        row('Skipped',        d.realtime.skipped),
      ])}
    `;
    // Stash a copy for the Copy button
    out._lastSnapshot = d;
  }

  async function forcePushNow() {
    clearTimeout(_supabaseSaveTimer);
    const ok = await pushToSupabase(buildStateData(), { manual: true });
    if (ok) showToast('Pushed to Supabase ✓', 1800);
    renderDiagPanel();
  }

  async function _probe(url, opts) {
    const start = Date.now();
    try {
      const r = await fetch(url, opts || {});
      const ms = Date.now() - start;
      return { url, ok: true, status: r.status, ms, instantFail: false };
    } catch (e) {
      const ms = Date.now() - start;
      const cap = _captureError(e);
      // ms < 10 strongly suggests local rule / cached negative / refused immediately,
      // not a real network attempt. Surface this so it's obvious in the panel.
      return { url, ok: false, status: null, ms, instantFail: ms < 10, errorName: cap.name, errorClass: cap.cls, error: cap.msg };
    }
  }

  // Image element bypasses the fetch() API. If the network layer is fine but
  // fetch is being blocked by something like cross-site tracker prevention,
  // img loads can still succeed.
  function _probeImage(url) {
    return new Promise(resolve => {
      const t = Date.now();
      const img = new Image();
      const timer = setTimeout(() => {
        img.onload = img.onerror = null;
        resolve({ url, ok: false, ms: Date.now() - t, instantFail: false, error: 'timeout' });
      }, 5000);
      img.onload = () => { clearTimeout(timer); resolve({ url, ok: true, ms: Date.now() - t, instantFail: false }); };
      img.onerror = () => {
        clearTimeout(timer);
        const ms = Date.now() - t;
        resolve({ url, ok: false, ms, instantFail: ms < 10, error: 'error event' });
      };
      img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    });
  }

  // Direct WebSocket constructor uses a different code path than fetch.
  function _probeWebSocket(url) {
    return new Promise(resolve => {
      const t = Date.now();
      let ws;
      try { ws = new WebSocket(url); }
      catch (e) {
        const ms = Date.now() - t;
        const cap = _captureError(e);
        return resolve({ url, ok: false, ms, instantFail: ms < 10, errorName: cap.name, error: cap.msg });
      }
      const timer = setTimeout(() => {
        try { ws.close(); } catch (e) {}
        resolve({ url, ok: false, ms: Date.now() - t, instantFail: false, error: 'timeout' });
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        const ms = Date.now() - t;
        try { ws.close(); } catch (e) {}
        resolve({ url, ok: true, ms, instantFail: false });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        const ms = Date.now() - t;
        resolve({ url, ok: false, ms, instantFail: ms < 10, error: 'error event' });
      };
    });
  }

  // Probe a deliberately broad set so we can localize the failure layer:
  //   - mainstream JSON APIs (httpbin, github)             → general HTTPS health
  //   - cloudflare 1.1.1.1 trace                           → generic network round trip
  //   - supabase.com marketing site                        → tests *.supabase.com hostname/IP class
  //   - SDK origin (jsdelivr)                              → CDN we already use
  //   - Supabase REST root, REST authed, Realtime health   → the actual failing endpoints
  async function testConnectivity() {
    showToast('Probing endpoints…', 1500);
    const results = {};
    results.cloudflareTrace = await _probe('https://1.1.1.1/cdn-cgi/trace', { cache: 'no-store' });
    results.httpbin         = await _probe('https://httpbin.org/get', { cache: 'no-store' });
    results.githubApi       = await _probe('https://api.github.com/zen', { cache: 'no-store' });
    results.supabaseHome    = await _probe('https://supabase.com/favicon.ico', { cache: 'no-store' });
    results.jsdelivr        = await _probe('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/package.json', { cache: 'no-store' });
    results.supabaseRoot    = await _probe(SUPABASE_URL + '/rest/v1/', { cache: 'no-store' });
    results.supabaseAuthed  = await _probe(_restUrl, {
      cache: 'no-store',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    });
    results.supabaseRealtime = await _probe(SUPABASE_URL + '/realtime/v1/api/tenants/health', { cache: 'no-store' });

    // Non-fetch paths to the same hostname — distinguish fetch-layer vs
    // hostname-layer blocking.
    results.supabaseImage  = await _probeImage(SUPABASE_URL + '/favicon.ico');
    results.supabaseSocket = await _probeWebSocket(
      SUPABASE_URL.replace(/^https/, 'wss') + '/realtime/v1/websocket?apikey=' + SUPABASE_ANON_KEY + '&vsn=1.0.0'
    );

    _sync.connectivity = { at: new Date().toISOString(), results };
    console.info('[triage] connectivity probe:', _sync.connectivity);
    renderDiagPanel();
    showToast('Probe complete — see Connectivity', 2000);
  }

  async function forceFetchNow() {
    await refreshFromSupabase({ manual: true });
    renderDiagPanel();
  }

  function copyDiagToClipboard() {
    const out = document.getElementById('diag-content');
    const snap = out && out._lastSnapshot ? out._lastSnapshot : buildDiagSnapshot();
    const text = JSON.stringify(snap, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Diagnostics copied', 1800))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Diagnostics copied', 1800); }
    catch (e) { showToast('Copy failed — long-press to copy from panel', 2500); }
    document.body.removeChild(ta);
  }

  /* ==========================================================
     4. STORAGE
  ========================================================== */

  function buildStateData() {
    return {
      version:              2,
      items:                state.items,
      tabledInitiatives:    state.tabledInitiatives,
      completedInitiatives: state.completedInitiatives,
      deletedInitiatives:   state.deletedInitiatives,
      customInitiatives:    state.customInitiatives,
      distractions:         state.distractions,
    };
  }

  function restoreStateFromData(data) {
    state.items                = data.items                || [];
    state.tabledInitiatives    = data.tabledInitiatives    || [];
    state.completedInitiatives = data.completedInitiatives || [];
    state.deletedInitiatives   = data.deletedInitiatives   || [];
    state.customInitiatives    = data.customInitiatives    || [];
    state.distractions         = data.distractions         || [];
  }

  function saveState() {
    const data = buildStateData();
    // 1. Write to localStorage immediately (keeps UI snappy)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    // 2. Debounced push to Supabase (background, non-blocking)
    scheduleSupabasePush(data);
  }

  function applyMigrations() {
    // Idempotent — safe to run every load. Maps deprecated values forward.
    state.items.forEach(item => {
      if (item.lane === 'open-loops') item.lane = 'needs-placement';
      if (['communicate', 'move-forward'].includes(item.workMode)) item.workMode = null;
      if (item.stage === 'Waiting') item.stage = 'Blocked';
      if (item.stage === 'Ready')   item.stage = 'Pending';
      // Checklist is additive and optional — normalise shape without ever
      // discarding existing entries. Older items simply have none.
      if (!Array.isArray(item.checklist)) {
        item.checklist = [];
      } else {
        item.checklist = item.checklist
          .filter(c => c && typeof c === 'object')
          .map(c => ({
            id:   c.id || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
            text: typeof c.text === 'string' ? c.text : String(c.text || ''),
            done: !!c.done,
          }));
      }
    });
  }

  async function loadState() {
    // 1. Restore from localStorage first so UI can render immediately
    const cached = localStorage.getItem(STORAGE_KEY);
    let hasLocalData = false;
    let localParsed  = null;
    let localParseError = null;
    if (cached) {
      try {
        localParsed = JSON.parse(cached);
        if (localParsed && typeof localParsed === 'object' && Array.isArray(localParsed.items)) {
          restoreStateFromData(localParsed);
          hasLocalData = true;
        } else {
          // Parsed but wrong shape — treat as opaque; do NOT overwrite.
          localParseError = 'Parsed but no items array (shape: ' +
            (localParsed === null ? 'null' : Array.isArray(localParsed) ? 'array' : typeof localParsed) + ')';
        }
      } catch (e) {
        localParseError = 'JSON.parse threw: ' + String(e && e.message || e);
      }
    }
    _sync.localParseError = localParseError;
    _sync.localSnapshot = hasLocalData
      ? _stateSummary(localParsed)
      : { items: 0, latestUpdatedAt: null, bytes: cached ? cached.length : 0, parseError: localParseError };
    console.info('[triage] local snapshot at boot:', _sync.localSnapshot);

    // 2. Fetch from Supabase (authoritative, most recent across devices)
    let loadedFromSupabase = false;
    if (supabaseClient) {
      _sync.state = 'syncing';
      _sync.lastFetchUrl = _restUrl;
      renderSyncIndicator();
      try {
        const { data, error } = await supabaseClient
          .from('triage_state')
          .select('data')
          .eq('id', 'main')
          .single();
        _sync.lastFetchAt = Date.now();
        if (error) {
          const cap = _captureError(error);
          _sync.lastFetchOk        = false;
          _sync.lastFetchError     = cap.msg;
          _sync.lastFetchErrorName = cap.name + (cap.cls && cap.cls !== cap.name ? ' / ' + cap.cls : '');
          _sync.state              = 'error';
          console.warn('[triage] Supabase load returned error:', error);
        } else if (data?.data) {
          _sync.lastFetchSummary = _stateSummary(data.data);
          const blocked = shouldBlockFetchOverwrite(data.data);
          if (blocked) {
            _sync.lastFetchOk             = true;
            _sync.lastFetchError          = null;
            _sync.lastFetchErrorName      = null;
            _sync.fetchOverwriteBlocked   = blocked;
            _sync.state                   = 'synced';
            console.warn('[triage] Fetch ignored:', blocked);
            // Push local up to Supabase to repair the stale remote.
            scheduleSupabasePush(buildStateData());
          } else {
            restoreStateFromData(data.data);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data.data)); } catch(e) {}
            loadedFromSupabase = true;
            _sync.lastFetchOk             = true;
            _sync.lastFetchError          = null;
            _sync.lastFetchErrorName      = null;
            _sync.fetchOverwriteBlocked   = null;
            _sync.state                   = 'synced';
            console.info('[triage] Loaded state from Supabase:', _sync.lastFetchSummary);
          }
        } else {
          _sync.lastFetchOk        = false;
          _sync.lastFetchError     = 'Supabase returned no row for id=main';
          console.warn('[triage]', _sync.lastFetchError);
        }
      } catch (e) {
        const cap = _captureError(e);
        _sync.lastFetchAt        = Date.now();
        _sync.lastFetchOk        = false;
        _sync.lastFetchError     = cap.msg;
        _sync.lastFetchErrorName = cap.name + (cap.cls && cap.cls !== cap.name ? ' / ' + cap.cls : '');
        _sync.state              = 'error';
        console.warn('[triage] Supabase load threw:', e);
      }
      renderSyncIndicator();
    } else {
      _sync.state = 'local-only';
      renderSyncIndicator();
    }

    // 3. Fresh install — ONLY when localStorage is truly empty AND Supabase
    //    didn't yield anything. If localStorage has ANY bytes (even unparseable),
    //    we treat that as "user has data" and refuse to overwrite with seed
    //    defaults — even when we can't read them. This prevents silent data
    //    contamination when a corrupt localStorage value combines with a failed
    //    Supabase fetch.
    if (!cached && !loadedFromSupabase) {
      state.items             = getInitialData();
      state.tabledInitiatives = DEFAULT_TABLED.slice();
      saveState();
      console.info('[triage] Seeded defaults (no local data, no remote).');
    } else if (!hasLocalData && !loadedFromSupabase) {
      // localStorage had bytes but they were unparseable AND Supabase failed.
      // Refuse to seed — leave state empty and surface a sticky error so the
      // user knows their data is unreachable, not gone.
      console.warn('[triage] localStorage unparseable AND Supabase unreachable — NOT seeding defaults.');
      _sync.state = 'error';
      renderSyncIndicator();
    }

    // 4. Always apply migrations
    applyMigrations();
  }

  async function refreshFromSupabase({ manual = false, fromVisibility = false } = {}) {
    if (!supabaseClient) {
      if (manual) showToast('Supabase unavailable — see Diagnostics', 2500);
      return false;
    }
    if (document.querySelector('dialog[open]') && !manual) {
      console.info('[triage] refresh skipped: dialog open.');
      return false;
    }
    _sync.state = 'syncing';
    renderSyncIndicator();
    try {
      const { data, error } = await supabaseClient
        .from('triage_state')
        .select('data')
        .eq('id', 'main')
        .single();
      _sync.lastFetchAt = Date.now();
      if (error) {
        _sync.lastFetchOk    = false;
        _sync.lastFetchError = String(error.message || error);
        _sync.state          = 'error';
        renderSyncIndicator();
        console.warn('[triage] refresh error:', error);
        if (manual) showToast('Fetch failed — see Diagnostics', 2500);
        return false;
      }
      if (!data?.data) {
        _sync.lastFetchOk    = false;
        _sync.lastFetchError = 'No row at id=main';
        _sync.state          = 'error';
        renderSyncIndicator();
        return false;
      }
      _sync.lastFetchOk      = true;
      _sync.lastFetchError   = null;
      _sync.lastFetchSummary = Object.assign(_stateSummary(data.data), { fromVisibility });
      _sync.state            = 'synced';

      const remoteJson = JSON.stringify(data.data);
      const localJson  = localStorage.getItem(STORAGE_KEY);
      if (remoteJson === localJson) {
        renderSyncIndicator();
        console.info('[triage] refresh: remote === local, no change.');
        if (manual) showToast('Already up to date', 1800);
        return true;
      }
      // Trust guard for the FETCH direction.
      const blocked = shouldBlockFetchOverwrite(data.data);
      if (blocked) {
        _sync.fetchOverwriteBlocked = blocked;
        renderSyncIndicator();
        console.warn('[triage] Refresh ignored:', blocked);
        scheduleSupabasePush(buildStateData());
        if (manual) showToast('Local is newer — pushing up instead', 2500);
        return false;
      }
      _sync.fetchOverwriteBlocked = null;
      restoreStateFromData(data.data);
      try { localStorage.setItem(STORAGE_KEY, remoteJson); } catch(e) {}
      applyMigrations();
      render();
      renderSyncIndicator();
      console.info('[triage] Refreshed from Supabase:', _sync.lastFetchSummary);
      if (manual) showToast('Refreshed from Supabase', 1800);
      return true;
    } catch (e) {
      _sync.lastFetchAt    = Date.now();
      _sync.lastFetchOk    = false;
      _sync.lastFetchError = String(e && e.message || e);
      _sync.state          = 'error';
      renderSyncIndicator();
      console.warn('[triage] refresh threw:', e);
      if (manual) showToast('Fetch threw — see Diagnostics', 2500);
      return false;
    }
  }

  // Migrate a v1 item to v2 schema
  function migrateItem(old) {
    const stageMap = {
      active:  'In progress',
      waiting: 'Waiting',
      parked:  'Unclear',
      done:    'Done',
    };
    const workModeMap = {
      thinking:      'figure-out',
      decision:      'figure-out',
      communication: 'communicate',
      admin:         'move-forward',
      'follow-up':   'communicate',
    };
    const item = createItem({
      ...old,
      stage:           stageMap[old.status]          || 'Unclear',
      workMode:        workModeMap[old.executionType] || null,
      waitingOnItemId: old.waitingOnItemId            || null,
      // Remap any stale PICID references
      initiative:      old.initiative === 'PICID' ? 'Picket' : old.initiative,
    });
    delete item.status;
    delete item.mentalWeight;
    delete item.executionType;
    return item;
  }

  /* --- JSON Export / Import --- */

  function exportJSON() {
    const data = {
      ...buildStateData(),
      exportedAt:  new Date().toISOString(),
      description: 'Strategic Triage Board — export this file to move your data between devices.',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const ts   = new Date().toISOString().slice(0,10);
    a.href     = url;
    a.download = `triage-board-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported — save this file to Google Drive or iCloud to restore on another device', 5000);
  }

  function handleJSONImport(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.items || !Array.isArray(data.items)) {
          showToast('Invalid file — not a Triage Board export'); return;
        }
        const dCount = Array.isArray(data.distractions) ? data.distractions.length : 0;
        const dText = dCount ? ` and ${dCount} distractions` : '';
        if (!confirm(`Import ${data.items.length} items${dText} from ${data.exportedAt || 'this file'}?\n\nThis will replace your current data.`)) return;
        state.items                = data.items;
        state.tabledInitiatives    = data.tabledInitiatives    || [];
        state.completedInitiatives = data.completedInitiatives || [];
        state.deletedInitiatives   = data.deletedInitiatives   || [];
        state.customInitiatives    = data.customInitiatives    || [];
        state.distractions         = data.distractions         || [];
        state.filter.initiative    = null;
        state.activeItemId         = null;
        saveState();
        render();
        showToast(`Imported ${data.items.length} items${dText} ✓`, 3500);
      } catch (err) {
        showToast('Could not read file — make sure it is a valid Triage Board JSON export');
        console.error('JSON import error:', err);
      }
    };
    reader.readAsText(file);
  }

  /* ==========================================================
     4. DATA LAYER
  ========================================================== */

  function createItem(overrides = {}) {
    return {
      id:              crypto.randomUUID(),
      title:           '',
      initiative:      null,
      source:          'native',
      clickupStatus:   null,
      clickupSpace:    null,
      clickupFolder:   null,
      clickupList:     null,
      displayGroup:    null,
      lane:            'inbox',
      workMode:        null,
      stage:           'Unclear',
      dueDate:         null,
      notes:           '',
      nextStep:        '',
      waitingOn:       '',
      waitingOnItemId: null,
      checklist:       [],
      completedAt:     null,
      createdAt:       Date.now(),
      updatedAt:       Date.now(),
      ...overrides,
    };
  }

  function getAllInitiatives() {
    const base   = INITIATIVES.filter(i => !state.deletedInitiatives.includes(i));
    const custom = (state.customInitiatives || []).filter(i =>
      !INITIATIVES.includes(i) && !state.deletedInitiatives.includes(i)
    );
    return [...base, ...custom.sort()];
  }

  function getActiveInitiatives() {
    return getAllInitiatives().filter(i =>
      !state.tabledInitiatives.includes(i) &&
      !state.completedInitiatives.includes(i)
    );
  }

  function toggleChecklistItem(itemId, entryId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item || !Array.isArray(item.checklist)) return;
    const entry = item.checklist.find(c => c.id === entryId);
    if (!entry) return;
    entry.done = !entry.done;
    // Route through updateItem so updatedAt is stamped and the sync
    // trust guards see this as a genuine local edit.
    updateItem(itemId, { checklist: item.checklist });
  }

  function updateItem(id, changes) {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    state.items[idx] = { ...state.items[idx], ...changes, updatedAt: Date.now() };
    saveState();
    render();
  }

  function moveItem(id, targetLane) {
    const changes = { lane: targetLane };
    if (targetLane === 'waiting') changes.stage = 'Blocked';
    updateItem(id, changes);
  }

  function tableItem(id) {
    updateItem(id, { lane: 'tabled-items' });
    showToast('Item tabled');
  }

  function reactivateItem(id) {
    updateItem(id, { lane: 'needs-placement' });
    showToast('Item moved to Needs Placement');
  }

  function deleteItem(id) {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    state.items = state.items.filter(i => i.id !== id);
    if (state.activeItemId === id) state.activeItemId = null;
    saveState();
    render();
    showToast('Item deleted');
  }

  function archiveItem(id) {
    updateItem(id, { archived: true, lane: 'archived' });
    showToast('Item archived');
  }

  function unarchiveItem(id) {
    updateItem(id, { archived: false, lane: 'needs-placement' });
    showToast('Item moved to Needs Placement');
  }

  function addCustomInitiative(name) {
    if (!state.customInitiatives.includes(name) && !INITIATIVES.includes(name)) {
      state.customInitiatives.push(name);
      saveState();
    }
  }

  function markDone(id) {
    updateItem(id, { stage: 'Done', completedAt: Date.now() });
    showToast('Marked done');
  }

  function addItem(item) {
    state.items.unshift(item);
    saveState();
    render();
  }

  /* --- Distractions (lightweight unplanned-load log) --- */

  function getWeekKey(dateStr) {
    // Returns 'YYYY-MM-DD' of Monday of the week containing dateStr.
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    if (isNaN(d.getTime())) return '';
    const monday = getWeekStart(d);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, '0');
    const day = String(monday.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function createDistraction(overrides = {}) {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const base = {
      id:                   crypto.randomUUID(),
      date:                 ymd,
      title:                '',
      summary:              '',
      sourcePerson:         '',
      category:             '',
      initiativeImpacted:   null,
      plannedWorkDisplaced: '',
      estimatedMinutes:     null,
      delegable:            null,
      rootCause:            '',
      notes:                '',
      createdAt:            Date.now(),
      updatedAt:            Date.now(),
      ...overrides,
    };
    base.weekKey = getWeekKey(base.date);
    return base;
  }

  function addDistraction(d) {
    state.distractions.unshift(d);
    saveState();
    render();
  }

  function updateDistraction(id, changes) {
    const idx = state.distractions.findIndex(d => d.id === id);
    if (idx === -1) return;
    const merged = { ...state.distractions[idx], ...changes, updatedAt: Date.now() };
    // Re-derive weekKey if date changed
    if (changes.date) merged.weekKey = getWeekKey(merged.date);
    state.distractions[idx] = merged;
    saveState();
    render();
  }

  function deleteDistraction(id) {
    if (!confirm('Delete this distraction log entry? This cannot be undone.')) return;
    state.distractions = state.distractions.filter(d => d.id !== id);
    saveState();
    render();
    showToast('Distraction deleted');
  }

  /* --- Initiative Lifecycle --- */

  function tableInitiative(name) {
    if (!state.tabledInitiatives.includes(name)) {
      state.tabledInitiatives.push(name);
      saveState();
      render();
      showToast(`"${name}" tabled`);
    }
  }

  function activateInitiative(name) {
    state.tabledInitiatives    = state.tabledInitiatives.filter(n => n !== name);
    state.completedInitiatives = state.completedInitiatives.filter(n => n !== name);
    saveState();
    render();
    showToast(`"${name}" reactivated`);
  }

  function completeInitiative(name) {
    state.tabledInitiatives = state.tabledInitiatives.filter(n => n !== name);
    if (!state.completedInitiatives.includes(name)) {
      state.completedInitiatives.push(name);
    }
    saveState();
    render();
    showToast(`"${name}" marked complete`);
  }

  function reopenInitiative(name) {
    state.completedInitiatives = state.completedInitiatives.filter(n => n !== name);
    saveState();
    render();
    showToast(`"${name}" reopened`);
  }

  function deleteInitiative(name) {
    state.tabledInitiatives    = state.tabledInitiatives.filter(n => n !== name);
    state.completedInitiatives = state.completedInitiatives.filter(n => n !== name);
    if (!state.deletedInitiatives.includes(name)) {
      state.deletedInitiatives.push(name);
    }
    // Detach initiative from all items — they stay in their lanes, just unassigned
    state.items = state.items.map(i =>
      i.initiative === name ? { ...i, initiative: null, updatedAt: Date.now() } : i
    );
    saveState();
    render();
    showToast(`"${name}" deleted — its items are now unassigned`);
  }

  /* Active visibility: items that should appear in regular lanes */
  function isActiveVisible(item) {
    if (item.archived) return false;
    if (item.stage === 'Done') return false;
    if (item.initiative) {
      if (state.tabledInitiatives.includes(item.initiative))    return false;
      if (state.completedInitiatives.includes(item.initiative)) return false;
    }
    return true;
  }

  function getItemsForLane(laneId) {
    return state.items.filter(item => {
      if (item.lane !== laneId) return false;
      if (!isActiveVisible(item)) return false;
      if (state.filter.initiative && item.initiative !== state.filter.initiative) return false;
      return true;
    });
  }

  function updateLaneMeta(laneId, count) {
    const countEl = document.getElementById('count-' + laneId);
    const badge   = document.getElementById('badge-' + laneId);
    if (countEl) countEl.textContent = count > 0 ? count : '';
    if (badge)   badge.textContent   = count > 0 ? count : '';
  }

  /* ==========================================================
     5. INITIAL DATA  (real ClickUp import — 2026-04-27)
        "Buckley Fence — Sales Department — Meagan Open Items"
        47 tasks: 8 "doing" → this-week, 39 "to do" → needs-placement
        Order: URGENT first, then HIGH, then NORMAL within each lane.
  ========================================================== */

  function getInitialData() {
    const d = s => new Date(s).getTime();
    const CU_BASE = {
      source: 'clickup',
      clickupSpace:  'Sales Department',
      clickupFolder: 'Meagan — Open Items',
    };

    return [

      /* ── THIS WEEK — URGENT ─────────────────────────────── */
      createItem({ ...CU_BASE,
        title: 'Rutjes — Container order: submit this week, email Elke re: mid-June ETA + buffer',
        initiative: 'International Distributors',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'move-forward', clickupList: 'International Distributors',
        createdAt: d('2026-03-23'), updatedAt: d('2026-04-20'),
      }),
      createItem({ ...CU_BASE,
        title: 'Jo Eller — Create distributor accessory fulfillment SOP for container orders',
        initiative: 'International Distributors',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'collaborate', clickupList: 'International Distributors',
        createdAt: d('2026-04-09'), updatedAt: d('2026-04-22'),
      }),
      createItem({ ...CU_BASE,
        title: 'EU Retail Price Sheet — Run ex-VAT calculations + send to Marketing',
        initiative: 'International Distributors',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'move-forward', clickupList: 'International Distributors',
        createdAt: d('2026-03-08'), updatedAt: d('2026-04-27'),
      }),
      createItem({ ...CU_BASE,
        title: 'Follow up with Jo Eller — dual-invoice process (Picket + BF) and CSR briefing',
        initiative: 'Picket',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'communicate', clickupList: 'Picket',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-11'),
      }),
      createItem({ ...CU_BASE,
        title: 'Verify Picket Stripe account setup and connection to Buckley Fence',
        initiative: 'Picket',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'review', clickupList: 'Picket',
        createdAt: d('2026-03-23'), updatedAt: d('2026-03-25'),
      }),

      /* ── THIS WEEK — HIGH ───────────────────────────────── */
      createItem({ ...CU_BASE,
        title: 'AG exemption compliance + tariff compliance inquiry',
        initiative: 'BF Commercial Relationship',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'figure-out', clickupList: 'BF Commercial Relationship',
        createdAt: d('2026-04-09'), updatedAt: d('2026-04-22'),
      }),
      createItem({ ...CU_BASE,
        title: 'Texas A&M visit — schedule prep meeting with Mike, Jaime, and Lindsey',
        initiative: 'Sales Team',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'collaborate', clickupList: 'Sales Team',
        dueDate: '2026-05-15',
        createdAt: d('2026-04-20'), updatedAt: d('2026-04-27'),
      }),
      createItem({ ...CU_BASE,
        title: "Plan Mike's paternity leave coverage — divide and conquer with Lindsey",
        initiative: 'Sales Team',
        lane: 'this-week', clickupStatus: 'doing', displayGroup: 'Imported — In Progress',
        stage: 'In progress', weekRelevance: 'this-week',
        workMode: 'collaborate', clickupList: 'Sales Team',
        dueDate: '2026-05-01',
        createdAt: d('2026-04-20'), updatedAt: d('2026-04-27'),
      }),

      /* ── NEEDS PLACEMENT — URGENT ────────────────────────── */
      createItem({ ...CU_BASE,
        title: 'Finish prep for Jim conversation — finalize graphic + talking points',
        initiative: 'BF Commercial Relationship',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'BF Commercial Relationship',
        createdAt: d('2026-04-20'), updatedAt: d('2026-04-20'),
      }),
      createItem({ ...CU_BASE,
        title: 'Negotiate buyback price with Master Halco SLC',
        initiative: 'US Distribution / Master Halco',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'US Distribution / Master Halco',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Follow up with Anna (tech) on BF Stripe account setup',
        initiative: 'Picket',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Picket',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: Sales Team ─────────────── */
      createItem({ ...CU_BASE,
        title: 'Finalize and launch CRM hygiene / account ownership rules with sales team',
        initiative: 'Sales Team',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Sales Team',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Container order sales strategy — transition reps to factory-direct / LCL selling',
        initiative: 'Sales Team',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Sales Team',
        createdAt: d('2026-04-20'), updatedAt: d('2026-04-27'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: International Distributors */
      createItem({ ...CU_BASE,
        title: 'Rutjes — Correct invoice INV-012687 ($440 → $240)',
        initiative: 'International Distributors',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'International Distributors',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Rutjes post-mortem — review email thread and build international distributor order SOP',
        initiative: 'International Distributors',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'review', clickupList: 'International Distributors',
        createdAt: d('2026-04-09'), updatedAt: d('2026-04-27'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: Installation Sales Framework */
      createItem({ ...CU_BASE,
        title: 'Spend time with Sherie & Mike on updated installation collateral',
        initiative: 'Installation Sales Framework',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Installation Sales Framework',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Negotiate shared pricing matrix with SAL (preferred CO installer)',
        initiative: 'Installation Sales Framework',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Installation Sales Framework',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Define minimum job size for offering installation + Zmaps installer guidelines',
        initiative: 'Installation Sales Framework',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Installation Sales Framework',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Draft change order SOP for installation projects',
        initiative: 'Installation Sales Framework',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'Installation Sales Framework',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Draft generic installer agreement + per-job bid form (follow up with Anna)',
        initiative: 'Installation Sales Framework',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'Installation Sales Framework',
        createdAt: d('2026-03-08'), updatedAt: d('2026-04-27'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: US Distribution / Master Halco */
      createItem({ ...CU_BASE,
        title: 'Brief CSRs (via Jo) on Master Halco SLC fulfillment workflow',
        initiative: 'US Distribution / Master Halco',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'US Distribution / Master Halco',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: Legal / Web ────────────── */
      createItem({ ...CU_BASE,
        title: 'Nick — US Distribution Agreement (BF + Master Halco SLC)',
        initiative: 'Legal / Web',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Legal / Web',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Nick — Picket Lead Referral Agreement (framework TBD)',
        initiative: 'Legal / Web',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Legal / Web',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Write installation terms for BF invoice line items (Buckley-Backed + Standard)',
        initiative: 'Legal / Web',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'Legal / Web',
        createdAt: d('2026-03-08'), updatedAt: d('2026-04-27'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: Meta / CRM ─────────────── */
      createItem({ ...CU_BASE,
        title: 'Dig into Klaviyo — understand available fields, segments, and lead-level data',
        initiative: 'Meta / CRM Lead Optimization',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Meta / CRM Lead Optimization',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Match Klaviyo lead records to Zoho closed-won deals',
        initiative: 'Meta / CRM Lead Optimization',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Meta / CRM Lead Optimization',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'Build expected value formula by lead type + define Meta event values',
        initiative: 'Meta / CRM Lead Optimization',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Meta / CRM Lead Optimization',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: Distribution Pivot ──────── */
      createItem({ ...CU_BASE,
        title: 'Define criteria for qualifying distribution partners',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Distribution Pivot',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Build financial model / pro forma for distribution pivot',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Distribution Pivot',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Debrief with Jerrod after SLC visit — capture fulfillment gap insights',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Distribution Pivot',
        dueDate: '2026-03-21', openLoop: true,
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Boise / RMF Idaho — Stay looped in + develop fulfillment agreement',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'Distribution Pivot',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Research and identify Texas distribution partner candidates',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Distribution Pivot',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Research and identify East Coast / Eastern US distribution partner candidates',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Distribution Pivot',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),

      /* ── NEEDS PLACEMENT — HIGH: Better Websites (tabled) ── */
      createItem({ ...CU_BASE,
        title: 'Decide: trade name + Stripe account structure for Better.Website',
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Better Websites',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: "Negotiate Johnny shares: 10% of sale price + 1% revenue (vs. traditional ownership)",
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Better Websites',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: 'Discuss Better.Website Stripe account structure with Jo Eller',
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Better Websites',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: International Distributors */
      createItem({ ...CU_BASE,
        title: 'Design EU crate return / recycling incentive program',
        initiative: 'International Distributors',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'International Distributors',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: 'EU Lead Tracking — Verify Sjoerd using survey consistently + set up Zoho report',
        initiative: 'International Distributors',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'review', clickupList: 'International Distributors',
        createdAt: d('2026-03-08'), updatedAt: d('2026-04-27'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: Installation Sales Framework */
      createItem({ ...CU_BASE,
        title: 'Follow up with Johnny on trusted installer list — what did he do with it?',
        initiative: 'Installation Sales Framework',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Installation Sales Framework',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: Legal / Web ──────────── */
      createItem({ ...CU_BASE,
        title: 'Draft Terms of Use page for Buckley Fence website',
        initiative: 'Legal / Web',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'Legal / Web',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: Meta / CRM ───────────── */
      createItem({ ...CU_BASE,
        title: 'Hand off event values to tech team for Zoho↔Meta backend integration',
        initiative: 'Meta / CRM Lead Optimization',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'communicate', clickupList: 'Meta / CRM Lead Optimization',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: Distribution Pivot ────── */
      createItem({ ...CU_BASE,
        title: 'Clarify regional territory boundaries between Master Halco SLC and RMF Idaho',
        initiative: 'Distribution Pivot',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Distribution Pivot',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: Picket ───────────────── */
      createItem({ ...CU_BASE,
        title: 'Define Picket lead bucket framework formally',
        initiative: 'Picket',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Picket',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),

      /* ── NEEDS PLACEMENT — NORMAL: Better Websites (tabled) */
      createItem({ ...CU_BASE,
        title: 'Determine customer-facing terms of service for Better.Website clients',
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Better Websites',
        createdAt: d('2026-03-08'), updatedAt: d('2026-03-08'),
      }),
      createItem({ ...CU_BASE,
        title: "Set up Rewardful affiliate program (50% first 1,000 / then 30%)",
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'move-forward', clickupList: 'Better Websites',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: "Explore packaging Johnny's drawing tool into BetterFenceWebsite.com",
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'figure-out', clickupList: 'Better Websites',
        createdAt: d('2026-03-09'), updatedAt: d('2026-03-09'),
      }),
      createItem({ ...CU_BASE,
        title: "Read and digest Kyle's Fract business plan + Better.Website sales manual",
        initiative: 'Better Websites',
        lane: 'needs-placement', clickupStatus: 'to do', displayGroup: 'Imported — To Do',
        stage: 'Unclear', weekRelevance: 'unclear',
        workMode: 'review', clickupList: 'Better Websites',
        createdAt: d('2026-03-23'), updatedAt: d('2026-03-23'),
      }),

    ];
  }

  /* ==========================================================
     6. UTILITIES
  ========================================================== */

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function formatWeekLabel(date) {
    const monday = getWeekStart(date);
    return 'Week of ' + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(monday);
  }

  function getWeekStart(date) {
    const d   = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function formatDueDate(dateStr) {
    if (!dateStr) return '';
    const due   = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff  = Math.round((due - today) / 86400000);
    if (diff < 0)   return 'Overdue ' + Math.abs(diff) + 'd';
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    if (diff <= 7)  return 'Due in ' + diff + 'd';
    return 'Due ' + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(due);
  }

  function dueDateClass(dateStr) {
    if (!dateStr) return '';
    const due   = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff  = Math.round((due - today) / 86400000);
    if (diff < 0)  return 'overdue';
    if (diff <= 2) return 'soon';
    return 'normal';
  }

  // Inline SVG icons for the due-date chip. Calendar for normal/soon,
  // alert-circle for overdue so the urgency reads at a glance.
  function dueChipIcon(cls) {
    if (cls === 'overdue') {
      return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><line x1="8" y1="4.8" x2="8" y2="8.6"/><circle cx="8" cy="11.4" r="0.5" fill="currentColor" stroke="none"/></svg>`;
    }
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3.8" width="11" height="9.7" rx="1.3"/><line x1="2.5" y1="6.8" x2="13.5" y2="6.8"/><line x1="5.5" y1="2.2" x2="5.5" y2="4.8"/><line x1="10.5" y1="2.2" x2="10.5" y2="4.8"/></svg>`;
  }

  function groupBy(arr, key) {
    return arr.reduce((acc, item) => {
      const val = item[key] || 'Unassigned';
      (acc[val] = acc[val] || []).push(item);
      return acc;
    }, {});
  }

  function showToast(msg, ms = 2600) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.remove('hiding');
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.classList.add('hiding');
      setTimeout(() => { el.hidden = true; }, 300);
    }, ms);
  }

  const WORK_MODE_ICONS = {
    'figure-out': `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4"/><line x1="9.5" y1="9.5" x2="13.8" y2="13.8"/></svg>`,
    'collaborate': `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="5" r="2"/><circle cx="10.5" cy="5" r="2"/><path d="M2 13.5 C2 10.8, 3.5 9.2, 5.5 9.2 C 7.5 9.2, 9 10.8, 9 13.5"/><path d="M7 13.5 C7 10.8, 8.5 9.2, 10.5 9.2 C 12.5 9.2, 14 10.8, 14 13.5"/></svg>`,
    'review': `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8 C3 4.5, 5.5 2.5, 8 2.5 C10.5 2.5, 13 4.5, 14.5 8 C13 11.5, 10.5 13.5, 8 13.5 C5.5 13.5, 3 11.5, 1.5 8 Z"/><circle cx="8" cy="8" r="2"/></svg>`,
    'ready-to-launch': `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 1.5 L 1.5 7 L 7 9 L 9 14.5 Z"/><line x1="14.5" y1="1.5" x2="7" y2="9"/></svg>`,
  };

  function workModeBadge(mode) {
    if (!mode) return '';
    const wm = WORK_MODES.find(w => w.id === mode);
    if (!wm) return '';
    const icon = WORK_MODE_ICONS[mode] || '';
    return `<span class="work-mode-badge wm--${escapeHtml(mode)}" title="${escapeHtml(wm.desc || wm.label)}">${icon}<span class="work-mode-label">${escapeHtml(wm.label)}</span></span>`;
  }

  function stagePillHtml(stage) {
    if (!stage || stage === 'Unclear') return '';
    const cls = {
      'In progress': 'stage--in-progress',
      'Pending':     'stage--pending',
      'Blocked':     'stage--blocked',
      'Done':        'stage--done',
    }[stage] || '';
    return cls ? `<span class="stage-pill ${cls}">${escapeHtml(stage)}</span>` : '';
  }

  function formatCompletedDate(ts) {
    if (!ts) return '';
    const d    = new Date(ts);
    const now  = new Date();
    const diff = Math.round((now - d) / 86400000);
    if (diff === 0) return 'Completed today';
    if (diff === 1) return 'Completed yesterday';
    if (diff <= 7)  return `Completed ${diff}d ago`;
    return 'Completed ' + new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  }

  /* ==========================================================
     7. CARD RENDERER
  ========================================================== */

  /* Compact checklist progress chip for the collapsed card. Renders
     nothing when the item has no checklist, so uncluttered items stay clean. */
  function checklistChipHtml(item) {
    const list = item.checklist || [];
    if (!list.length) return '';
    const done     = list.filter(c => c.done).length;
    const complete = done === list.length;
    return `<span class="checklist-chip ${complete ? 'checklist-chip--complete' : ''}"
                  title="Checklist: ${done} of ${list.length} done">${complete ? '&#x2611;' : '&#x2610;'} ${done}/${list.length}</span>`;
  }

  /* Checklist block for the expanded card detail.
     Active items render expanded; a fully-done list collapses to a summary. */
  function checklistDetailHtml(item) {
    const list = item.checklist || [];
    if (!list.length) return '';

    const row = c => `
      <li class="card-checklist-item ${c.done ? 'card-checklist-item--done' : ''}">
        <input type="checkbox" ${c.done ? 'checked' : ''}
               data-action="toggle-check"
               data-id="${escapeHtml(item.id)}" data-cid="${escapeHtml(c.id)}"
               aria-label="${escapeHtml(c.text)}">
        <span>${escapeHtml(c.text)}</span>
      </li>`;

    const active = list.filter(c => !c.done);
    const done   = list.filter(c => c.done);

    // Nothing active — keep it out of the way behind a collapsed summary
    if (!active.length) {
      return `<details class="card-checklist-done-wrap">
          <summary>All ${list.length} checklist item${list.length === 1 ? '' : 's'} done</summary>
          <ul class="card-checklist">${done.map(row).join('')}</ul>
        </details>`;
    }

    return `<ul class="card-checklist">${active.map(row).join('')}</ul>
      ${done.length ? `
        <details class="card-checklist-done-wrap">
          <summary>${done.length} done</summary>
          <ul class="card-checklist">${done.map(row).join('')}</ul>
        </details>` : ''}`;
  }

  function renderCard(item, { tabled = false, completed = false, showCompletedDate = false } = {}) {
    const isExpanded  = state.activeItemId === item.id;
    const dueDateStr  = formatDueDate(item.dueDate);
    const dueCls      = dueDateClass(item.dueDate);

    const isInProgress = item.source === 'clickup' && item.displayGroup === 'Imported — In Progress';
    const isDone       = item.stage === 'Done';
    const cardCls = [
      'card',
      tabled                              ? 'card--tabled'      : '',
      completed                           ? 'card--completed'   : '',
      !tabled && !completed && item.stage === 'Blocked' && !isDone ? 'card--blocked'     : '',
      !tabled && !completed && isInProgress && !isDone  ? 'card--in-progress' : '',
      isDone                              ? 'card--done'        : '',
    ].filter(Boolean).join(' ');

    const completedDateStr = (showCompletedDate || completed) && isDone
      ? formatCompletedDate(item.completedAt || item.updatedAt)
      : '';

    const dueChipHtml = dueDateStr
      ? `<span class="due-chip due-chip--${dueCls || 'normal'}" title="${escapeHtml(dueDateStr)}">${dueChipIcon(dueCls)}<span class="due-chip-label">${escapeHtml(dueDateStr)}</span></span>`
      : '';

    return `
      <article class="${cardCls}" data-id="${escapeHtml(item.id)}" draggable="true">
        <div class="card-main" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <div class="card-header-row">
            <span class="drag-handle" title="Drag to reorder">&#x2807;</span>
            ${item.source === 'clickup' ? '<span class="source-badge">CU</span>' : ''}
            <h4 class="card-title">${escapeHtml(item.title)}</h4>
            ${dueChipHtml}
          </div>
          ${item.nextStep ? `<div class="card-next-step" title="Next step">${escapeHtml(item.nextStep)}</div>` : ''}
          <div class="card-meta">
            ${item.initiative
              ? `<span class="initiative-tag" title="${escapeHtml(item.initiative)}">${escapeHtml(item.initiative)}</span>`
              : ''}
            ${workModeBadge(item.workMode)}
            ${stagePillHtml(item.stage)}
            ${checklistChipHtml(item)}
            ${completedDateStr ? `<span class="completed-date-badge">${escapeHtml(completedDateStr)}</span>` : ''}
            ${item.clickupStatus ? `<span class="clickup-status-badge">${escapeHtml(item.clickupStatus)}</span>` : ''}
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-move" data-id="${escapeHtml(item.id)}" data-action="move">Move</button>
          <button class="btn-edit" data-id="${escapeHtml(item.id)}" data-action="edit">Edit</button>
          ${!isDone
            ? `<button class="btn-done" data-id="${escapeHtml(item.id)}" data-action="done">Done</button>`
            : ''}
          ${item.archived
            ? `<button class="btn-reactivate" data-id="${escapeHtml(item.id)}" data-action="unarchive">Unarchive</button>`
            : item.lane === 'tabled-items'
              ? `<button class="btn-reactivate" data-id="${escapeHtml(item.id)}" data-action="reactivate">Reactivate</button>`
              : `<button class="btn-table" data-id="${escapeHtml(item.id)}" data-action="table">Table</button>`}
        </div>
        ${isExpanded ? renderCardDetail(item) : ''}
      </article>`;
  }

  function renderCardDetail(item) {
    const fields = [];

    // ClickUp source breadcrumb
    const crumbParts = [item.clickupSpace, item.clickupFolder, item.clickupList].filter(Boolean);
    if (crumbParts.length) {
      fields.push({
        label:     'Source',
        valueHtml: `<span class="card-detail-breadcrumb">${crumbParts.map(escapeHtml).join(' › ')}</span>`,
      });
    }

    if (item.notes)    fields.push({ label: 'Notes',     valueHtml: escapeHtml(item.notes) });
    if (item.nextStep) fields.push({ label: 'Next Step', valueHtml: escapeHtml(item.nextStep) });

    if ((item.checklist || []).length) {
      fields.push({ label: 'Checklist', valueHtml: checklistDetailHtml(item) });
    }

    // Waiting On — plain text or linked item
    if (item.waitingOn || item.waitingOnItemId) {
      let waitHtml = '';
      if (item.waitingOnItemId) {
        const linked = state.items.find(i => i.id === item.waitingOnItemId);
        if (linked) {
          waitHtml = `
            <span class="dep-item-link" data-id="${escapeHtml(linked.id)}" role="button" tabindex="0"
                  title="Open linked item">
              <span class="dep-item-link-arrow">→</span>
              ${escapeHtml(linked.title)}
              ${stagePillHtml(linked.stage)}
            </span>`;
        } else {
          waitHtml = escapeHtml(item.waitingOn || '[Linked item removed]');
        }
      } else {
        waitHtml = escapeHtml(item.waitingOn);
      }
      fields.push({ label: 'Waiting On', valueHtml: waitHtml });
    }

    const dangerHtml = `
      <div class="card-danger-actions">
        ${item.archived
          ? `<button class="btn-archive" data-id="${escapeHtml(item.id)}" data-action="unarchive">Unarchive</button>`
          : `<button class="btn-archive" data-id="${escapeHtml(item.id)}" data-action="archive">Archive</button>`}
        <button class="btn-delete" data-id="${escapeHtml(item.id)}" data-action="delete">Delete</button>
      </div>`;

    if (!fields.length) {
      return `<div class="card-detail">${dangerHtml}</div>`;
    }

    return `
      <div class="card-detail">
        ${fields.map(f => `
          <div class="card-detail-field">
            <div class="card-detail-label">${escapeHtml(f.label)}</div>
            <div class="card-detail-value">${f.valueHtml}</div>
          </div>`).join('')}
        ${dangerHtml}
      </div>`;
  }

  /* ==========================================================
     8. LANE RENDERERS
  ========================================================== */

  function render() {
    closeMovePopover();
    closeInitiativeActionPopover();
    renderSidebar();
    LANES.forEach(lane => renderLane(lane.id));
    renderOverdueLane();
    renderTabledItemsLane();
    renderArchivedLane();
    renderTabledInitiatives();
    renderCompletedInitiatives();
    renderCompletedItems();
    renderDistractions();
    renderWeeklyReview();
    // Keep detail modal live if it's open
    const detailModal = document.getElementById('initiative-detail-modal');
    if (detailModal && detailModal.open) {
      const name = document.getElementById('init-detail-name').textContent;
      if (name) renderInitiativeDetailBody(name);
    }
  }

  function renderLane(laneId) {
    if (laneId === 'strategic-radar') { renderStrategicRadar(); return; }
    if (laneId === 'needs-placement') { renderNeedsPlacementLane(); return; }
    if (laneId === 'this-week')       { renderThisWeekLane(); return; }

    const container = document.getElementById('cards-' + laneId);
    if (!container) return;

    const items = getItemsForLane(laneId);

    updateLaneMeta(laneId, items.length);

    container.innerHTML = items.length
      ? items.map(i => renderCard(i)).join('')
      : '<p class="lane-empty">Nothing here</p>';
  }

  /* Needs Placement — groups ClickUp "To Do" and native items */
  function renderNeedsPlacementLane() {
    const container = document.getElementById('cards-needs-placement');
    if (!container) return;

    const items = getItemsForLane('needs-placement');
    updateLaneMeta('needs-placement', items.length);

    if (!items.length) {
      container.innerHTML = '<p class="lane-empty">Nothing here</p>';
      return;
    }

    const imported = items.filter(i => i.source === 'clickup');
    const native   = items.filter(i => i.source !== 'clickup');
    let html = '';

    if (imported.length) html += renderCardGroup('Imported — To Do', 'to-do', imported);
    if (native.length)   html += renderCardGroup(imported.length ? 'Unplaced Captures' : null, 'native', native);

    container.innerHTML = html;
  }

  /* This Week — groups ClickUp "Doing" (In Progress) separately */
  function renderThisWeekLane() {
    const container = document.getElementById('cards-this-week');
    if (!container) return;

    const items = getItemsForLane('this-week');
    updateLaneMeta('this-week', items.length);

    if (!items.length) {
      container.innerHTML = '<p class="lane-empty">Nothing here</p>';
      return;
    }

    const inProgress = items.filter(i => i.source === 'clickup' && i.displayGroup === 'Imported — In Progress');
    const other      = items.filter(i => !(i.source === 'clickup' && i.displayGroup === 'Imported — In Progress'));
    let html = '';

    if (inProgress.length) html += renderCardGroup('Imported — In Progress', 'in-progress', inProgress);
    if (other.length)      html += renderCardGroup(inProgress.length ? 'Other This Week' : null, 'native', other);

    container.innerHTML = html;
  }

  function renderCardGroup(label, styleKey, items) {
    const labelHtml = label
      ? `<div class="card-group-label card-group-label--${styleKey}">
           ${escapeHtml(label)} <span class="card-group-count">${items.length}</span>
         </div>`
      : '';
    return `
      <div class="card-group">
        ${labelHtml}
        <div class="card-list">${items.map(i => renderCard(i)).join('')}</div>
      </div>`;
  }

  function renderOverdueLane() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const items = state.items.filter(i =>
      i.dueDate &&
      new Date(i.dueDate + 'T00:00:00') < today &&
      i.stage !== 'Done' &&
      !i.archived &&
      i.lane !== 'tabled-items'
    );
    updateLaneMeta('overdue', items.length);
    const container = document.getElementById('cards-overdue');
    if (!container) return;
    container.innerHTML = items.length
      ? items.map(i => renderCard(i)).join('')
      : '<p class="lane-empty">No overdue items</p>';
  }

  function renderTabledItemsLane() {
    const container = document.getElementById('cards-tabled-items');
    if (!container) return;
    const items = state.items.filter(i => i.lane === 'tabled-items' && !i.archived);
    updateLaneMeta('tabled-items', items.length);
    container.innerHTML = items.length
      ? items.map(i => renderCard(i)).join('')
      : '<p class="lane-empty">No tabled items</p>';
  }

  function renderArchivedLane() {
    const section   = document.getElementById('archived-items');
    const container = document.getElementById('cards-archived-items');
    const countEl   = document.getElementById('count-archived-items');
    if (!container) return;
    const items = state.items.filter(i => i.archived);
    if (section) section.hidden = items.length === 0;
    if (countEl) countEl.textContent = items.length > 0 ? items.length : '';
    container.innerHTML = items.length
      ? items.map(i => renderCard(i)).join('')
      : '<p class="lane-empty">No archived items</p>';
  }

  function renderStrategicRadar() {
    const container = document.getElementById('cards-strategic-radar');
    if (!container) return;

    // Only show non-tabled, non-completed initiatives in radar
    const activeInits = getActiveInitiatives();
    const items   = getItemsForLane('strategic-radar');
    updateLaneMeta('strategic-radar', items.length);

    const byInit = groupBy(items, 'initiative');

    container.innerHTML = activeInits.map(init => {
      const initItems = byInit[init] || [];
      return `
        <div class="initiative-block ${initItems.length === 0 ? 'initiative-block--empty' : ''}">
          <div class="initiative-label">${escapeHtml(init)}</div>
          <div class="initiative-cards">
            ${initItems.length
              ? initItems.map(i => renderCard(i)).join('')
              : '<p class="no-items-placeholder">No items in radar</p>'}
          </div>
        </div>`;
    }).join('');
  }

  function renderTabledInitiatives() {
    const section   = document.getElementById('tabled-initiatives');
    const container = document.getElementById('cards-tabled-initiatives');
    const navLink   = document.getElementById('nav-tabled');
    const badge     = document.getElementById('badge-tabled');
    const countEl   = document.getElementById('count-tabled');

    if (!container) return;

    const hasTabled = state.tabledInitiatives.length > 0;
    if (section)  section.hidden  = !hasTabled;
    if (navLink)  navLink.hidden  = !hasTabled;
    if (!hasTabled) {
      if (badge)   badge.textContent   = '';
      if (countEl) countEl.textContent = '';
      return;
    }

    const tabledItems = state.items.filter(i =>
      i.initiative && state.tabledInitiatives.includes(i.initiative) && i.stage !== 'Done'
    );
    const total = tabledItems.length;

    if (badge)   badge.textContent   = total > 0 ? total : '';
    if (countEl) countEl.textContent = total > 0 ? total : '';

    container.innerHTML = state.tabledInitiatives.map(initName => {
      const items = tabledItems.filter(i => i.initiative === initName);
      return `
        <div class="tabled-block">
          <div class="tabled-block-header">
            <span class="tabled-block-name">${escapeHtml(initName)}</span>
            <button class="btn-activate" data-initiative="${escapeHtml(initName)}" data-action="activate">
              Activate
            </button>
          </div>
          ${items.length
            ? `<div class="card-list">${items.map(i => renderCard(i, { tabled: true })).join('')}</div>`
            : '<p class="tabled-empty">No open items</p>'}
        </div>`;
    }).join('');
  }

  function renderCompletedInitiatives() {
    const section   = document.getElementById('completed-initiatives');
    const container = document.getElementById('cards-completed-initiatives');
    const navLink   = document.getElementById('nav-completed-init');
    const badge     = document.getElementById('badge-completed-init');
    const countEl   = document.getElementById('count-completed-init');

    if (!container) return;

    const hasCompleted = state.completedInitiatives.length > 0;
    if (section)  section.hidden  = !hasCompleted;
    if (navLink)  navLink.hidden  = !hasCompleted;
    if (!hasCompleted) {
      if (badge)   badge.textContent   = '';
      if (countEl) countEl.textContent = '';
      return;
    }

    const allCompletedItems = state.items.filter(i =>
      i.initiative && state.completedInitiatives.includes(i.initiative)
    );
    const total = allCompletedItems.length;
    if (badge)   badge.textContent   = total > 0 ? total : '';
    if (countEl) countEl.textContent = total > 0 ? total : '';

    container.innerHTML = state.completedInitiatives.map(initName => {
      const items      = allCompletedItems.filter(i => i.initiative === initName);
      const doneCount  = items.filter(i => i.stage === 'Done').length;
      const activeCount = items.filter(i => i.stage !== 'Done').length;
      return `
        <div class="completed-init-block">
          <div class="completed-init-block-header">
            <div class="completed-init-block-meta">
              <span class="completed-init-block-name">${escapeHtml(initName)}</span>
              <span class="completed-init-block-stats">${doneCount} done${activeCount > 0 ? ` · ${activeCount} open` : ''}</span>
            </div>
            <button class="btn-reopen-init" data-initiative="${escapeHtml(initName)}" data-action="reopen-completed">
              Reopen
            </button>
          </div>
          ${items.length
            ? `<div class="card-list">${items.map(i => renderCard(i, { completed: true, showCompletedDate: true })).join('')}</div>`
            : '<p class="completed-init-empty">No items</p>'}
        </div>`;
    }).join('');
  }

  function renderCompletedItems() {
    const container = document.getElementById('cards-completed-items');
    if (!container) return;

    const now        = Date.now();
    const weekStart  = getWeekStart(new Date()).getTime();
    const monthStart = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); })();
    const past3m     = now - 90 * 86400000;

    // All done items, excluding items that belong to completed initiatives
    // (those are shown in the Completed Initiatives section)
    let items = state.items.filter(i =>
      i.stage === 'Done' &&
      (!i.initiative || !state.completedInitiatives.includes(i.initiative))
    );

    // Period filter
    const period = state.completedFilter.period;
    if (period === 'this-week') {
      items = items.filter(i => (i.completedAt || i.updatedAt) >= weekStart);
    } else if (period === 'this-month') {
      items = items.filter(i => (i.completedAt || i.updatedAt) >= monthStart);
    } else if (period === 'past-3m') {
      items = items.filter(i => (i.completedAt || i.updatedAt) >= past3m);
    }

    // Initiative filter
    if (state.completedFilter.initiative) {
      items = items.filter(i => i.initiative === state.completedFilter.initiative);
    }

    // Sort newest first
    items.sort((a, b) => (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt));

    updateLaneMeta('completed-items', items.length);

    // Populate initiative dropdown with all initiatives that have done items
    const allDone    = state.items.filter(i =>
      i.stage === 'Done' && (!i.initiative || !state.completedInitiatives.includes(i.initiative))
    );
    const initOptions = [...new Set(allDone.map(i => i.initiative).filter(Boolean))].sort();
    const initSel = document.getElementById('completed-initiative-filter');
    if (initSel) {
      const currentVal = state.completedFilter.initiative || '';
      initSel.innerHTML = `<option value="">All initiatives</option>` +
        initOptions.map(i =>
          `<option value="${escapeHtml(i)}"${i === currentVal ? ' selected' : ''}>${escapeHtml(i)}</option>`
        ).join('');
    }

    container.innerHTML = items.length
      ? items.map(i => renderCard(i, { showCompletedDate: true })).join('')
      : '<p class="lane-empty">No completed items match the current filter</p>';
  }

  /* ==========================================================
     8b. DISTRACTIONS RENDERER
  ========================================================== */

  function formatMinutesAsHours(mins) {
    if (!mins || mins <= 0) return '0h';
    const h = mins / 60;
    return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  function formatDelegable(v) {
    if (v === 'yes')   return 'Delegable: yes';
    if (v === 'maybe') return 'Delegable: maybe';
    if (v === 'no')    return 'Delegable: no';
    return '';
  }

  function formatWeekRange(weekKey) {
    if (!weekKey) return '';
    const monday = new Date(weekKey + 'T00:00:00');
    if (isNaN(monday.getTime())) return weekKey;
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const fmt = d => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
    return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
  }

  function renderDistractionCard(d) {
    const meta = [];
    if (d.sourcePerson)         meta.push(`<span class="distraction-meta-pill distraction-meta-pill--person">${escapeHtml(d.sourcePerson)}</span>`);
    if (d.category)             meta.push(`<span class="distraction-meta-pill">${escapeHtml(d.category)}</span>`);
    if (d.initiativeImpacted)   meta.push(`<span class="distraction-meta-pill distraction-meta-pill--initiative">${escapeHtml(d.initiativeImpacted)}</span>`);
    if (d.estimatedMinutes)     meta.push(`<span class="distraction-meta-pill distraction-meta-pill--time">${escapeHtml(formatMinutesAsHours(d.estimatedMinutes))}</span>`);
    const delegableLabel = formatDelegable(d.delegable);
    if (delegableLabel)         meta.push(`<span class="distraction-meta-pill distraction-meta-pill--${d.delegable}">${escapeHtml(delegableLabel)}</span>`);

    const detail = [];
    if (d.plannedWorkDisplaced) detail.push(`<div class="distraction-detail-row"><span class="distraction-detail-label">Displaced</span> ${escapeHtml(d.plannedWorkDisplaced)}</div>`);
    if (d.rootCause)            detail.push(`<div class="distraction-detail-row"><span class="distraction-detail-label">Root cause</span> ${escapeHtml(d.rootCause)}</div>`);
    if (d.summary)              detail.push(`<div class="distraction-detail-row"><span class="distraction-detail-label">Summary</span> ${escapeHtml(d.summary)}</div>`);
    if (d.notes)                detail.push(`<div class="distraction-detail-row"><span class="distraction-detail-label">Notes</span> ${escapeHtml(d.notes)}</div>`);

    return `
      <article class="distraction-card" data-distraction-id="${escapeHtml(d.id)}">
        <header class="distraction-card-header">
          <div class="distraction-card-title-row">
            <span class="distraction-card-date">${escapeHtml(d.date || '')}</span>
            <h4 class="distraction-card-title">${escapeHtml(d.title || '(untitled)')}</h4>
          </div>
          <div class="distraction-card-actions">
            <button type="button" class="distraction-edit-btn"   data-distraction-id="${escapeHtml(d.id)}" data-action="edit-distraction">Edit</button>
            <button type="button" class="distraction-delete-btn" data-distraction-id="${escapeHtml(d.id)}" data-action="delete-distraction">Delete</button>
          </div>
        </header>
        ${meta.length ? `<div class="distraction-card-meta">${meta.join('')}</div>` : ''}
        ${detail.length ? `<div class="distraction-card-detail">${detail.join('')}</div>` : ''}
      </article>`;
  }

  function renderDistractions() {
    const container = document.getElementById('cards-distractions');
    const statsEl   = document.getElementById('distraction-stats');
    const countEl   = document.getElementById('count-distractions');
    const navBadge  = document.getElementById('badge-distractions');
    if (!container) return;

    const all = (state.distractions || []).slice().sort((a, b) => {
      // sort by date desc, then createdAt desc
      const da = a.date || ''; const db = b.date || '';
      if (da !== db) return db.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const thisWeekKey = getWeekKey(new Date().toISOString().slice(0,10));
    const thisWeek = all.filter(d => d.weekKey === thisWeekKey);
    const minsThisWeek = thisWeek.reduce((sum, d) => sum + (Number(d.estimatedMinutes) || 0), 0);

    if (countEl)  countEl.textContent  = thisWeek.length > 0 ? thisWeek.length : '';
    if (navBadge) navBadge.textContent = thisWeek.length > 0 ? thisWeek.length : '';

    if (statsEl) {
      statsEl.innerHTML = `
        <span class="distraction-stat"><span class="distraction-stat-value">${thisWeek.length}</span> this week</span>
        <span class="distraction-stat-divider">·</span>
        <span class="distraction-stat"><span class="distraction-stat-value">${formatMinutesAsHours(minsThisWeek)}</span> logged</span>
      `;
    }

    if (!all.length) {
      container.innerHTML = '<p class="lane-empty">Nothing logged yet. Use "+ Log distraction" when something unplanned absorbs your time.</p>';
      return;
    }

    // Group by weekKey, preserving date-desc order
    const groups = [];
    const seen = new Map();
    for (const d of all) {
      const key = d.weekKey || 'unknown';
      let g = seen.get(key);
      if (!g) { g = { key, items: [] }; seen.set(key, g); groups.push(g); }
      g.items.push(d);
    }

    container.innerHTML = groups.map(g => {
      const isCurrent = g.key === thisWeekKey;
      const groupMins = g.items.reduce((s, d) => s + (Number(d.estimatedMinutes) || 0), 0);
      const headerLabel = `${formatWeekRange(g.key)} · ${g.items.length} · ${formatMinutesAsHours(groupMins)}`;
      return `
        <details class="distraction-week-group" ${isCurrent ? 'open' : ''}>
          <summary class="distraction-week-header">${escapeHtml(headerLabel)}${isCurrent ? ' <span class="distraction-week-tag">this week</span>' : ''}</summary>
          <div class="distraction-week-items">${g.items.map(renderDistractionCard).join('')}</div>
        </details>`;
    }).join('');
  }

  function countDistractionsThisWeek() {
    const thisWeekKey = getWeekKey(new Date().toISOString().slice(0,10));
    return (state.distractions || []).filter(d => d.weekKey === thisWeekKey).length;
  }

  /* ==========================================================
     8c. DISTRACTION MODAL
  ========================================================== */

  function openDistractionModal(prefill = {}) {
    const dialog = document.getElementById('distraction-modal');
    const form   = document.getElementById('distraction-form');
    const title  = document.getElementById('distraction-modal-title');
    const submit = document.getElementById('distraction-submit-btn');
    if (!dialog || !form) return;

    populateDistractionInitiatives();
    form.reset();

    if (prefill.id) {
      const d = state.distractions.find(x => x.id === prefill.id);
      if (!d) return;
      state.ui.editingDistractionId = d.id;
      if (title) title.textContent  = 'Edit distraction';
      if (submit) submit.textContent = 'Save changes';

      document.getElementById('distraction-id').value                  = d.id;
      document.getElementById('distraction-date').value                = d.date || '';
      document.getElementById('distraction-title').value               = d.title || '';
      document.getElementById('distraction-source-person').value       = d.sourcePerson || '';
      document.getElementById('distraction-category').value            = d.category || '';
      document.getElementById('distraction-initiative').value          = d.initiativeImpacted || '';
      document.getElementById('distraction-displaced').value           = d.plannedWorkDisplaced || '';
      document.getElementById('distraction-minutes').value             = (d.estimatedMinutes != null ? d.estimatedMinutes : '');
      document.getElementById('distraction-delegable').value           = d.delegable || '';
      document.getElementById('distraction-root-cause').value          = d.rootCause || '';
      document.getElementById('distraction-summary').value             = d.summary || '';
      document.getElementById('distraction-notes').value               = d.notes || '';
    } else {
      state.ui.editingDistractionId = null;
      if (title) title.textContent  = 'Log a distraction';
      if (submit) submit.textContent = 'Log it';
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      document.getElementById('distraction-date').value = ymd;
    }

    dialog.showModal();
    setTimeout(() => document.getElementById('distraction-title').focus(), 60);
  }

  function closeDistractionModal() {
    const dialog = document.getElementById('distraction-modal');
    if (dialog && dialog.open) dialog.close();
    state.ui.editingDistractionId = null;
  }

  function populateDistractionInitiatives() {
    const dl = document.getElementById('distraction-initiatives-list');
    if (!dl) return;
    dl.innerHTML = getAllInitiatives()
      .map(i => `<option value="${escapeHtml(i)}"></option>`).join('');
  }

  function handleDistractionSubmit(e) {
    e.preventDefault();
    const data = new FormData(e.target);
    const title = (data.get('title') || '').trim();
    if (!title) { document.getElementById('distraction-title').focus(); return; }

    const minutesRaw = (data.get('estimatedMinutes') || '').toString().trim();
    const minutes = minutesRaw === '' ? null : Math.max(0, Math.round(Number(minutesRaw))) || null;

    const values = {
      date:                 data.get('date') || '',
      title,
      sourcePerson:         (data.get('sourcePerson')         || '').trim(),
      category:             (data.get('category')             || '').trim(),
      initiativeImpacted:   ((data.get('initiativeImpacted')  || '').trim()) || null,
      plannedWorkDisplaced: (data.get('plannedWorkDisplaced') || '').trim(),
      estimatedMinutes:     minutes,
      delegable:            (data.get('delegable') || '') || null,
      rootCause:            (data.get('rootCause')  || '').trim(),
      summary:              (data.get('summary')    || '').trim(),
      notes:                (data.get('notes')      || '').trim(),
    };

    if (state.ui.editingDistractionId) {
      updateDistraction(state.ui.editingDistractionId, values);
      showToast('Distraction updated');
    } else {
      addDistraction(createDistraction(values));
      showToast('Distraction logged');
    }
    closeDistractionModal();
  }

  function renderSidebar() {
    const wl = document.getElementById('week-label');
    if (wl) wl.textContent = formatWeekLabel(new Date());

    // Active initiatives
    const list = document.getElementById('initiative-list');
    if (list) {
      const activeInits = getActiveInitiatives();
      list.innerHTML = activeInits.map(init => {
        const count  = state.items.filter(i => i.initiative === init && isActiveVisible(i)).length;
        const active = state.filter.initiative === init;
        return `<li>
          <div class="initiative-chip-row">
            <button class="initiative-chip ${active ? 'active' : ''}"
                    data-initiative="${escapeHtml(init)}"
                    title="${escapeHtml(init)}">
              ${escapeHtml(init)}${count ? `<span class="initiative-chip-count">(${count})</span>` : ''}
            </button>
            <button class="btn-init-action" data-initiative="${escapeHtml(init)}" data-category="active"
                    title="Initiative actions" aria-label="Actions for ${escapeHtml(init)}">···</button>
          </div>
        </li>`;
      }).join('');
    }

    // Tabled panel
    const tabledPanel = document.getElementById('tabled-init-panel');
    const tabledList  = document.getElementById('tabled-initiative-list');
    const hasTabled   = state.tabledInitiatives.length > 0;
    if (tabledPanel) tabledPanel.hidden = !hasTabled;
    if (tabledList && hasTabled) {
      tabledList.innerHTML = state.tabledInitiatives.map(init => `
        <li>
          <div class="initiative-chip-row">
            <button class="initiative-chip initiative-chip--secondary"
                    data-initiative="${escapeHtml(init)}" title="${escapeHtml(init)}">
              ${escapeHtml(init)}
            </button>
            <button class="btn-init-action" data-initiative="${escapeHtml(init)}" data-category="tabled"
                    title="Initiative actions" aria-label="Actions for ${escapeHtml(init)}">···</button>
          </div>
        </li>`).join('');
    }

    // Completed panel
    const completedPanel = document.getElementById('completed-init-panel');
    const completedList  = document.getElementById('completed-initiative-list');
    const hasCompleted   = state.completedInitiatives.length > 0;
    if (completedPanel) completedPanel.hidden = !hasCompleted;
    if (completedList && hasCompleted) {
      completedList.innerHTML = state.completedInitiatives.map(init => `
        <li>
          <div class="initiative-chip-row">
            <button class="initiative-chip initiative-chip--completed"
                    data-initiative="${escapeHtml(init)}" title="${escapeHtml(init)}">
              ${escapeHtml(init)}
            </button>
            <button class="btn-init-action" data-initiative="${escapeHtml(init)}" data-category="completed"
                    title="Initiative actions" aria-label="Actions for ${escapeHtml(init)}">···</button>
          </div>
        </li>`).join('');
    }

    const clearBtn = document.getElementById('clear-filter-btn');
    if (clearBtn) clearBtn.hidden = !state.filter.initiative;
  }

  function renderWeeklyReview() {
    const summaryEl = document.getElementById('review-summary');
    if (!summaryEl) return;

    const weekStart = getWeekStart(new Date()).getTime();

    // Exclude tabled AND completed initiative items from weekly review
    const isReviewable = i =>
      !i.initiative ||
      (!state.tabledInitiatives.includes(i.initiative) &&
       !state.completedInitiatives.includes(i.initiative));

    const all            = state.items.filter(isReviewable);
    const completedWeek  = all.filter(i => i.stage === 'Done' && (i.completedAt || i.updatedAt) >= weekStart);
    const active         = all.filter(i => isActiveVisible(i));
    const blocked        = all.filter(i => i.stage === 'Blocked');
    const today          = new Date(); today.setHours(0,0,0,0);
    const overdue        = active.filter(i =>
      i.dueDate && new Date(i.dueDate + 'T00:00:00') < today
    );
    const needsPlacement = all.filter(i => i.lane === 'needs-placement' && i.stage !== 'Done');

    summaryEl.innerHTML = `
      <div class="review-stat-card">
        <div class="review-stat-label">Completed This Week</div>
        <div class="review-stat-value done">${completedWeek.length}</div>
      </div>
      <div class="review-stat-card">
        <div class="review-stat-label">Active Items</div>
        <div class="review-stat-value">${active.length}</div>
      </div>
      <div class="review-stat-card">
        <div class="review-stat-label">Blocked</div>
        <div class="review-stat-value waiting">${blocked.length}</div>
      </div>
      <div class="review-stat-card">
        <div class="review-stat-label">Overdue</div>
        <div class="review-stat-value waiting">${overdue.length}</div>
      </div>
      <div class="review-stat-card">
        <div class="review-stat-label">Needs Placement</div>
        <div class="review-stat-value">${needsPlacement.length}</div>
      </div>
      <div class="review-stat-card">
        <div class="review-stat-label">Distractions This Week</div>
        <div class="review-stat-value">${countDistractionsThisWeek()}</div>
      </div>`;
  }

  /* ==========================================================
     9. MODAL HANDLERS
  ========================================================== */

  function populateFormSelects() {
    const initSel = document.getElementById('form-initiative');
    if (initSel) {
      const prevValue = initSel.value;
      initSel.innerHTML = `<option value="">— Unassigned —</option>` +
        getAllInitiatives()
          .map(i => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');
      if (prevValue) initSel.value = prevValue;
    }
    const laneSel = document.getElementById('form-lane');
    if (laneSel) {
      laneSel.innerHTML = LANES.map(l =>
        `<option value="${escapeHtml(l.id)}">${escapeHtml(l.label)}</option>`).join('');
    }
  }

  /* --- Checklist editor (capture/edit modal) ---------------------
     Held in a module-level array while the modal is open rather than as
     form fields, so rows can be added/removed/reordered without fighting
     FormData. Written back to the item on submit. -------------------- */

  let _formChecklist = [];

  function newChecklistEntry(text = '') {
    return {
      id:   crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
      text,
      done: false,
    };
  }

  function renderChecklistEditor() {
    const wrap = document.getElementById('checklist-editor');
    const prog = document.getElementById('checklist-progress');
    if (!wrap) return;

    wrap.innerHTML = _formChecklist.map(c => `
      <div class="checklist-row ${c.done ? 'checklist-row--done' : ''}" data-cid="${escapeHtml(c.id)}">
        <input type="checkbox" ${c.done ? 'checked' : ''} data-cid="${escapeHtml(c.id)}"
               aria-label="Mark done">
        <input type="text" class="checklist-text" value="${escapeHtml(c.text)}"
               data-cid="${escapeHtml(c.id)}" placeholder="What needs doing?">
        <button type="button" class="checklist-remove" data-cid="${escapeHtml(c.id)}"
                aria-label="Remove checklist item">&times;</button>
      </div>`).join('');

    if (prog) {
      const total = _formChecklist.length;
      const done  = _formChecklist.filter(c => c.done).length;
      prog.hidden      = total === 0;
      prog.textContent = total ? `${done}/${total} done` : '';
    }
  }

  function setupChecklistEditor() {
    const wrap   = document.getElementById('checklist-editor');
    const addBtn = document.getElementById('checklist-add-btn');

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        _formChecklist.push(newChecklistEntry());
        renderChecklistEditor();
        const rows = document.querySelectorAll('#checklist-editor .checklist-text');
        if (rows.length) rows[rows.length - 1].focus();
      });
    }

    if (!wrap) return;

    // Text edits — keep the array in sync without a re-render (preserves caret)
    wrap.addEventListener('input', e => {
      const txt = e.target.closest('.checklist-text');
      if (!txt) return;
      const entry = _formChecklist.find(c => c.id === txt.dataset.cid);
      if (entry) entry.text = txt.value;
    });

    // Checkbox toggles
    wrap.addEventListener('change', e => {
      const box = e.target.closest('input[type="checkbox"]');
      if (!box) return;
      const entry = _formChecklist.find(c => c.id === box.dataset.cid);
      if (entry) { entry.done = box.checked; renderChecklistEditor(); }
    });

    // Remove a row
    wrap.addEventListener('click', e => {
      const rm = e.target.closest('.checklist-remove');
      if (!rm) return;
      e.preventDefault();
      _formChecklist = _formChecklist.filter(c => c.id !== rm.dataset.cid);
      renderChecklistEditor();
    });

    // Enter inside a checklist row adds the next one instead of submitting
    wrap.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const txt = e.target.closest('.checklist-text');
      if (!txt) return;
      e.preventDefault();
      _formChecklist.push(newChecklistEntry());
      renderChecklistEditor();
      const rows = document.querySelectorAll('#checklist-editor .checklist-text');
      if (rows.length) rows[rows.length - 1].focus();
    });
  }

  function openCaptureModal(prefill = {}) {
    const dialog    = document.getElementById('capture-modal');
    const form      = document.getElementById('capture-form');
    const titleEl   = document.getElementById('modal-title');
    const submitBtn = document.getElementById('form-submit-btn');

    populateFormSelects();
    form.reset();
    resetDepField();

    if (prefill.id) {
      const item = state.items.find(i => i.id === prefill.id);
      if (!item) return;
      state.ui.editingItemId = prefill.id;
      titleEl.textContent    = 'Edit Item';
      submitBtn.textContent  = 'Save Changes';

      document.getElementById('form-id').value         = item.id;
      document.getElementById('form-title').value      = item.title;
      document.getElementById('form-initiative').value = item.initiative || '';
      document.getElementById('form-lane').value       = item.lane;
      document.getElementById('form-work-mode').value  = item.workMode || '';
      document.getElementById('form-stage').value      = item.stage || 'Unclear';
      document.getElementById('form-due-date').value   = item.dueDate || '';
      document.getElementById('form-notes').value      = item.notes || '';
      document.getElementById('form-next-step').value  = item.nextStep || '';

      _formChecklist = (item.checklist || []).map(c => ({ ...c }));
      renderChecklistEditor();

      if (item.waitingOnItemId) {
        const linked = state.items.find(i => i.id === item.waitingOnItemId);
        if (linked) {
          setDepLink(linked);
          document.getElementById('form-waiting-on').value = item.waitingOn || linked.title;
        } else {
          document.getElementById('form-waiting-on').value = item.waitingOn || '';
        }
      } else {
        document.getElementById('form-waiting-on').value = item.waitingOn || '';
      }
    } else {
      state.ui.editingItemId = null;
      titleEl.textContent    = 'Capture Item';
      submitBtn.textContent  = 'Save Item';
      _formChecklist = [];
      renderChecklistEditor();
      if (prefill.lane)       document.getElementById('form-lane').value       = prefill.lane;
      if (prefill.initiative) document.getElementById('form-initiative').value = prefill.initiative;
    }

    dialog.showModal();
    updateVagueHelper();
    setTimeout(() => document.getElementById('form-title').focus(), 60);
  }

  function closeCaptureModal() {
    const dialog = document.getElementById('capture-modal');
    if (dialog && dialog.open) dialog.close();
    const dropdown = document.getElementById('dep-dropdown');
    if (dropdown) dropdown.hidden = true;
    const newRow = document.getElementById('new-initiative-row');
    if (newRow) newRow.hidden = true;
    const newInput = document.getElementById('new-initiative-input');
    if (newInput) newInput.value = '';
    const vague = document.getElementById('form-next-step-vague');
    if (vague) { vague.hidden = true; vague.textContent = ''; }
    const prompts = document.querySelector('.triage-prompts');
    if (prompts) prompts.open = false;
    _formChecklist = [];
    renderChecklistEditor();
    state.ui.editingItemId = null;
  }

  function handleCaptureSubmit(e) {
    e.preventDefault();
    const data  = new FormData(e.target);
    const title = (data.get('title') || '').trim();
    if (!title) { document.getElementById('form-title').focus(); return; }

    const values = {
      title,
      initiative:      data.get('initiative')      || null,
      lane:            data.get('lane')            || 'inbox',
      workMode:        data.get('workMode')        || null,
      stage:           data.get('stage')           || 'Unclear',
      dueDate:         data.get('dueDate')         || null,
      notes:           (data.get('notes')          || '').trim(),
      nextStep:        (data.get('nextStep')       || '').trim(),
      waitingOn:       (data.get('waitingOn')      || '').trim(),
      waitingOnItemId: data.get('waitingOnItemId') || null,
      // Blank rows are discarded so an accidental "+ Add" never persists
      checklist:       _formChecklist
                         .map(c => ({ id: c.id, text: (c.text || '').trim(), done: !!c.done }))
                         .filter(c => c.text),
    };

    if (values.lane === 'waiting' && values.stage !== 'Done') {
      values.stage = 'Blocked';
    }

    if (state.ui.editingItemId) {
      updateItem(state.ui.editingItemId, values);
      showToast('Item updated');
    } else {
      addItem(createItem(values));
      showToast('Item added');
    }
    closeCaptureModal();
  }

  function handleQuickCapture() {
    const input = document.getElementById('quick-capture-input');
    const title = input.value.trim();
    if (!title) return;
    addItem(createItem({ title, lane: 'inbox' }));
    input.value = '';
    showToast('Added to Inbox');
  }

  /* --- Dependency Field --- */

  function resetDepField() {
    const chip   = document.getElementById('dep-linked-chip');
    const hidden = document.getElementById('form-waiting-on-item-id');
    const input  = document.getElementById('form-waiting-on');
    const dd     = document.getElementById('dep-dropdown');
    if (chip)   chip.hidden  = true;
    if (hidden) hidden.value = '';
    if (input)  input.value  = '';
    if (dd)     dd.hidden    = true;
  }

  function setDepLink(item) {
    const chip      = document.getElementById('dep-linked-chip');
    const chipTitle = document.getElementById('dep-linked-title');
    const hidden    = document.getElementById('form-waiting-on-item-id');
    if (!chip || !chipTitle || !hidden) return;
    hidden.value          = item.id;
    chipTitle.textContent = item.title;
    chip.hidden           = false;
  }

  function setupDependencySearch() {
    const input    = document.getElementById('form-waiting-on');
    const dropdown = document.getElementById('dep-dropdown');
    const hiddenId = document.getElementById('form-waiting-on-item-id');
    const chip     = document.getElementById('dep-linked-chip');
    const clearBtn = document.getElementById('dep-clear-btn');

    if (!input) return;

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();

      if (hiddenId.value) {
        const linked = state.items.find(i => i.id === hiddenId.value);
        if (input.value !== (linked ? linked.title : '')) {
          hiddenId.value = '';
          if (chip) chip.hidden = true;
        }
      }

      if (q.length < 2) { dropdown.hidden = true; return; }

      const editingId = state.ui.editingItemId;
      const results   = state.items
        .filter(i => i.id !== editingId && i.stage !== 'Done' && i.title.toLowerCase().includes(q))
        .slice(0, 7);

      if (!results.length) { dropdown.hidden = true; return; }

      dropdown.innerHTML = results.map(item => {
        const laneLabel = LANES.find(l => l.id === item.lane)?.label || item.lane;
        const meta      = [item.initiative, laneLabel].filter(Boolean).join(' · ');
        return `
          <button type="button" class="dep-option" data-id="${escapeHtml(item.id)}">
            <span class="dep-option-title">${escapeHtml(item.title)}</span>
            ${meta ? `<span class="dep-option-meta">${escapeHtml(meta)}</span>` : ''}
          </button>`;
      }).join('');
      dropdown.hidden = false;
    });

    dropdown.addEventListener('click', e => {
      const btn = e.target.closest('.dep-option');
      if (!btn) return;
      const item = state.items.find(i => i.id === btn.dataset.id);
      if (!item) return;
      setDepLink(item);
      input.value     = item.title;
      dropdown.hidden = true;
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        hiddenId.value  = '';
        input.value     = '';
        if (chip) chip.hidden = true;
        dropdown.hidden = true;
        input.focus();
      });
    }

    document.addEventListener('click', e => {
      if (!e.target.closest('.dependency-field')) dropdown.hidden = true;
    });
  }

  /* ==========================================================
     10. MOVE POPOVER
  ========================================================== */

  let _popoverId    = null;
  let _popoverClose = null;

  function openMovePopover(itemId, triggerEl) {
    _popoverId = itemId;
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    const popover = document.getElementById('move-popover');
    const opts    = document.getElementById('move-popover-options');

    opts.innerHTML = LANES.map(lane =>
      `<button class="move-option ${item.lane === lane.id ? 'current-lane' : ''}"
               data-lane="${escapeHtml(lane.id)}">${escapeHtml(lane.label)}</button>`).join('');

    const rect = triggerEl.getBoundingClientRect();
    popover.style.top  = rect.bottom + 6 + 'px';
    popover.style.left = rect.left + 'px';
    popover.hidden = false;

    if (_popoverClose) document.removeEventListener('click', _popoverClose);
    _popoverClose = e => { if (!popover.contains(e.target)) closeMovePopover(); };
    setTimeout(() => document.addEventListener('click', _popoverClose), 0);
  }

  function closeMovePopover() {
    document.getElementById('move-popover').hidden = true;
    _popoverId = null;
    if (_popoverClose) { document.removeEventListener('click', _popoverClose); _popoverClose = null; }
  }

  /* ==========================================================
     11. INITIATIVE ACTION POPOVER
  ========================================================== */

  let _initPopover = { initiative: null, category: null, closeHandler: null };

  function openInitiativeActionPopover(initName, category, triggerEl) {
    closeInitiativeActionPopover();

    _initPopover.initiative = initName;
    _initPopover.category   = category;

    const popover   = document.getElementById('initiative-action-popover');
    const nameEl    = document.getElementById('init-action-name');
    const optionsEl = document.getElementById('init-action-options');

    nameEl.textContent = initName;

    const options = [];
    options.push({ action: 'view', label: 'View all tasks', cls: 'init-action--view' });
    if (category === 'active') {
      options.push({ action: 'table',    label: 'Table',    cls: '' });
      options.push({ action: 'complete', label: 'Complete', cls: 'init-action--complete' });
      options.push({ action: 'delete',   label: 'Delete',   cls: 'init-action--delete' });
    } else if (category === 'tabled') {
      options.push({ action: 'activate', label: 'Activate', cls: 'init-action--activate' });
      options.push({ action: 'complete', label: 'Complete', cls: 'init-action--complete' });
      options.push({ action: 'delete',   label: 'Delete',   cls: 'init-action--delete' });
    } else if (category === 'completed') {
      options.push({ action: 'reopen',   label: 'Reopen',   cls: 'init-action--activate' });
      options.push({ action: 'delete',   label: 'Delete',   cls: 'init-action--delete' });
    }

    optionsEl.innerHTML = options.map(o =>
      `<button class="init-action-btn ${o.cls}" data-action="${o.action}">${o.label}</button>`
    ).join('');

    // Position: below the trigger, right-aligned
    const rect    = triggerEl.getBoundingClientRect();
    const popW    = 180;
    const rawLeft = rect.right - popW;
    const left    = Math.max(8, Math.min(rawLeft, window.innerWidth - popW - 8));
    popover.style.top  = (rect.bottom + 4) + 'px';
    popover.style.left = left + 'px';
    popover.hidden = false;

    _initPopover.closeHandler = e => {
      if (!popover.contains(e.target) && e.target !== triggerEl) {
        closeInitiativeActionPopover();
      }
    };
    setTimeout(() => document.addEventListener('click', _initPopover.closeHandler), 0);
  }

  function closeInitiativeActionPopover() {
    const popover = document.getElementById('initiative-action-popover');
    if (popover) popover.hidden = true;
    if (_initPopover.closeHandler) {
      document.removeEventListener('click', _initPopover.closeHandler);
      _initPopover.closeHandler = null;
    }
    _initPopover.initiative = null;
    _initPopover.category   = null;
  }

  function handleInitiativeAction(action) {
    const name = _initPopover.initiative;
    closeInitiativeActionPopover();
    if (!name) return;

    if (action === 'view') {
      openInitiativeDetail(name);
      return;
    }

    if (action === 'table') {
      if (confirm(`Table "${name}"?\n\nIts open items will be preserved in the Tabled section until reactivated.`)) {
        tableInitiative(name);
      }
    } else if (action === 'activate') {
      activateInitiative(name);
    } else if (action === 'complete') {
      if (confirm(`Mark "${name}" as Complete?\n\nIts items will move to the Completed Initiatives section.`)) {
        completeInitiative(name);
      }
    } else if (action === 'reopen') {
      reopenInitiative(name);
    } else if (action === 'delete') {
      if (confirm(`Delete "${name}"?\n\nAll its items will remain in their current lanes but become unassigned. This cannot be undone.`)) {
        deleteInitiative(name);
      }
    }
  }

  /* ==========================================================
     12. INITIATIVE DETAIL MODAL
  ========================================================== */

  function openInitiativeDetail(name) {
    const dialog = document.getElementById('initiative-detail-modal');
    document.getElementById('init-detail-name').textContent = name;
    renderInitiativeDetailBody(name);
    dialog.showModal();
  }

  function renderInitiativeDetailBody(name) {
    const body      = document.getElementById('init-detail-body');
    const summaryEl = document.getElementById('init-detail-summary');
    if (!body || !summaryEl) return;

    const allItems = state.items.filter(i => i.initiative === name);
    const active   = allItems.filter(i => i.stage !== 'Done');
    const done     = allItems.filter(i => i.stage === 'Done')
      .sort((a, b) => (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt));

    const blockedCount = active.filter(i => i.stage === 'Blocked').length;
    const parts = [`${active.length} active`, `${done.length} done`];
    if (blockedCount) parts.push(`${blockedCount} blocked`);
    summaryEl.textContent = parts.join(' · ');

    if (!allItems.length) {
      body.innerHTML = '<p class="init-detail-empty">No items for this initiative yet.</p>';
      return;
    }

    let html = '';

    // Active items grouped by lane
    LANES.forEach(lane => {
      const laneItems = active.filter(i => i.lane === lane.id);
      if (!laneItems.length) return;
      html += `
        <div class="init-detail-group">
          <div class="init-detail-group-label">
            ${escapeHtml(lane.label)}
            <span class="card-group-count">${laneItems.length}</span>
          </div>
          <div class="card-list">${laneItems.map(i => renderCard(i)).join('')}</div>
        </div>`;
    });

    // Done items
    if (done.length) {
      html += `
        <div class="init-detail-group init-detail-group--done">
          <div class="init-detail-group-label init-detail-group-label--done">
            Done
            <span class="card-group-count">${done.length}</span>
          </div>
          <div class="card-list">${done.map(i => renderCard(i, { showCompletedDate: true })).join('')}</div>
        </div>`;
    }

    body.innerHTML = html;
  }

  function closeInitiativeDetail() {
    document.getElementById('initiative-detail-modal').close();
  }

  /* ==========================================================
     13. CSV IMPORT (internal — not exposed in UI)
  ========================================================== */

  function parseCSV(text) {
    const lines = [];
    let row = [], field = '', inQ = false, i = 0;

    while (i < text.length) {
      const ch = text[i], nx = text[i + 1];
      if (inQ) {
        if (ch === '"' && nx === '"') { field += '"'; i += 2; continue; }
        if (ch === '"') { inQ = false; i++; continue; }
        field += ch;
      } else {
        if (ch === '"')         { inQ = true; i++; continue; }
        if (ch === ',')         { row.push(field); field = ''; i++; continue; }
        if (ch === '\r' && nx === '\n') { row.push(field); lines.push(row); row = []; field = ''; i += 2; continue; }
        if (ch === '\n' || ch === '\r') { row.push(field); lines.push(row); row = []; field = ''; i++; continue; }
        field += ch;
      }
      i++;
    }
    if (field || row.length) { row.push(field); lines.push(row); }

    if (lines.length < 2) return [];
    const headers = lines[0].map(h => h.trim());
    return lines.slice(1)
      .filter(r => r.some(c => c.trim()))
      .map(r => {
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
        return obj;
      });
  }

  function parseClickUpDate(s) {
    if (!s) return null;
    const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6,
                     july:7, august:8, september:9, october:10, november:11, december:12 };
    // "Friday, May 15th 2026" or "May 15th 2026"
    const longFmt = s.match(/(?:\w+,\s+)?(\w+)\s+(\d{1,2})(?:st|nd|rd|th)\s+(\d{4})/i);
    if (longFmt) {
      const mo = MONTHS[longFmt[1].toLowerCase()];
      if (mo) return `${longFmt[3]}-${String(mo).padStart(2,'0')}-${String(longFmt[2]).padStart(2,'0')}`;
    }
    // MM/DD/YYYY
    const mmdd = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mmdd) return `${mmdd[3]}-${mmdd[1].padStart(2,'0')}-${mmdd[2].padStart(2,'0')}`;
    // ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }

  function matchInitiative(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    return INITIATIVES.find(init =>
      init.toLowerCase().split(' ').filter(w => w.length > 3).some(w => lower.includes(w))
    ) || null;
  }

  function resolveClickUpStatus(rawStatus) {
    const key = (rawStatus || '').toLowerCase().trim();
    return CLICKUP_STATUS_MAP[key] || CLICKUP_STATUS_DEFAULT;
  }

  function mapClickUpRow(row) {
    const title = (row['Task Name'] || row['Name'] || row['title'] || '').trim();
    if (!title) return null;

    const rawStatus  = row['Status'] || '';
    const mapping    = resolveClickUpStatus(rawStatus);
    const space      = (row['Space']  || '').trim() || null;
    const folder     = (row['Folder'] || '').trim() || null;
    const list       = (row['List']   || row['List Name'] || '').trim() || null;
    const initiative = matchInitiative(list) || matchInitiative(folder) || matchInitiative(title);

    const noteParts = [];
    const assignee  = row['Assignee'] || row['Assignees'] || '';
    if (assignee && assignee !== '[]') noteParts.push('Assigned: ' + assignee);
    if (list && list !== folder)       noteParts.push('List: ' + list);
    const desc = row['Task Content'] || row['Description'] || row['Notes'] || '';
    if (desc.trim()) noteParts.push(desc.trim());

    return createItem({
      title,
      source:        'clickup',
      clickupStatus: rawStatus || null,
      clickupSpace:  space,
      clickupFolder: folder,
      clickupList:   list,
      displayGroup:  mapping.displayGroup,
      lane:          mapping.lane,
      stage:         mapping.itemStage,
      initiative,
      dueDate:       parseClickUpDate(row['Due Date'] || row['due_date'] || row['Due date'] || ''),
      notes:         noteParts.join('\n'),
    });
  }

  function handleCSVImport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows  = parseCSV(e.target.result);
        const items = rows.map(mapClickUpRow).filter(Boolean);
        if (!items.length) { showToast('No importable items found in CSV'); return; }

        items.forEach(item => state.items.push(item));
        saveState();
        render();

        const inProgress = items.filter(i => i.displayGroup === 'Imported — In Progress').length;
        const toDo       = items.filter(i => i.displayGroup === 'Imported — To Do').length;
        const parts      = [];
        if (inProgress) parts.push(inProgress + ' in progress → This Week');
        if (toDo)       parts.push(toDo + ' to do → Needs Placement');

        showToast('Imported ' + items.length + ' items' + (parts.length ? ': ' + parts.join(', ') : ''), 4000);
        setTimeout(() => {
          const target = inProgress
            ? document.getElementById('this-week')
            : document.getElementById('needs-placement');
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      } catch (err) {
        showToast('Error parsing CSV — check file format');
        console.error('CSV import error:', err);
      }
    };
    reader.readAsText(file);
  }

  /* ==========================================================
     13. WEEKLY REPORT GENERATOR
  ========================================================== */

  function generateAttentionSummary(active, blocked, overdue) {
    const lines = [];

    if (overdue.length) {
      const titles = overdue.slice(0, 2).map(i => '"' + i.title + '"').join(' and ');
      lines.push(`You have ${overdue.length} overdue item${overdue.length > 1 ? 's' : ''} requiring immediate attention: ${titles}.`);
    }

    if (blocked.length) {
      const withDeps = blocked.filter(i => i.waitingOn || i.waitingOnItemId);
      if (withDeps.length) {
        const names = [...new Set(withDeps.map(i => {
          if (i.waitingOnItemId) {
            const linked = state.items.find(x => x.id === i.waitingOnItemId);
            return linked ? linked.title : i.waitingOn;
          }
          return i.waitingOn;
        }))].filter(Boolean).slice(0, 2).join(' and ');
        lines.push(`${withDeps.length} item${withDeps.length > 1 ? 's are' : ' is'} blocked — follow up with ${names} if you haven't already.`);
      }
    }

    const weekItems = active.filter(i => i.lane === 'this-week' || i.lane === 'today');
    if (!lines.length && weekItems.length) {
      lines.push(`You have ${weekItems.length} active items in Today and This Week — a focused week ahead.`);
    }
    if (!lines.length) {
      lines.push('The board looks relatively clear. Use this week to make progress on strategic radar items.');
    }

    return lines.join('\n');
  }

  function generateWeeklyReport() {
    const now       = new Date();
    const weekStart = getWeekStart(now).getTime();
    const LINE      = '─'.repeat(52);

    // Exclude tabled and completed initiative items
    const isReviewable = i =>
      !i.initiative ||
      (!state.tabledInitiatives.includes(i.initiative) &&
       !state.completedInitiatives.includes(i.initiative));

    const all           = state.items.filter(isReviewable);
    const completedWeek = all.filter(i => i.stage === 'Done' && (i.completedAt || i.updatedAt) >= weekStart);
    const active        = all.filter(i => isActiveVisible(i));
    const blocked       = all.filter(i => i.stage === 'Blocked');
    const overdue       = active.filter(i => i.dueDate && new Date(i.dueDate + 'T00:00:00') < now);
    const byInit        = groupBy(active, 'initiative');

    let r = `STRATEGIC TRIAGE BOARD — WEEKLY REVIEW\n${formatDate(now)}\n${LINE}\n\n`;

    r += `COMPLETED THIS WEEK (${completedWeek.length})\n`;
    if (completedWeek.length) completedWeek.forEach(i => { r += `  ✓  ${i.title}\n`; });
    else r += `  None marked done yet this week.\n`;
    r += '\n';

    r += `ACTIVE BY INITIATIVE\n`;
    let hasAny = false;
    getActiveInitiatives()
      .forEach(init => {
        const items = byInit[init];
        if (!items?.length) return;
        hasAny = true;
        r += `\n  ${init.toUpperCase()}\n`;
        items.forEach(i => {
          const laneName = LANES.find(l => l.id === i.lane)?.label || i.lane;
          r += `  ·  ${i.title}  [${laneName}${i.stage && i.stage !== 'Unclear' ? ' · ' + i.stage : ''}]\n`;
          if (i.nextStep) r += `     → ${i.nextStep}\n`;
        });
      });
    if (!hasAny) r += `  No active items.\n`;
    r += '\n';

    if (blocked.length) {
      r += `BLOCKED (${blocked.length})\n`;
      blocked.forEach(i => {
        r += `  ⊘  ${i.title}`;
        if (i.waitingOnItemId) {
          const linked = state.items.find(x => x.id === i.waitingOnItemId);
          if (linked) r += `  ← ${linked.title}`;
        } else if (i.waitingOn) {
          r += `  ← ${i.waitingOn}`;
        }
        r += '\n';
      });
      r += '\n';
    }

    if (overdue.length) {
      r += `OVERDUE (${overdue.length})\n`;
      overdue.forEach(i => { r += `  !  ${i.title}  [due: ${i.dueDate}]\n`; });
      r += '\n';
    }

    if (state.tabledInitiatives.length) {
      r += `TABLED (${state.tabledInitiatives.length})\n`;
      state.tabledInitiatives.forEach(init => { r += `  ⊟  ${init}\n`; });
      r += '\n';
    }

    if (state.completedInitiatives.length) {
      r += `COMPLETED INITIATIVES (${state.completedInitiatives.length})\n`;
      state.completedInitiatives.forEach(init => { r += `  ✓  ${init}\n`; });
      r += '\n';
    }

    r += `${LINE}\nWHAT NEEDS ATTENTION THIS WEEK\n\n`;
    r += generateAttentionSummary(active, blocked, overdue);
    r += '\n';

    return r;
  }

  /* ==========================================================
     14. SCROLL SPY
  ========================================================== */

  function setupScrollSpy() {
    const sections = document.querySelectorAll('.lane[id]');
    const navItems = document.querySelectorAll('.nav-item');
    if (!('IntersectionObserver' in window)) return;

    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navItems.forEach(n => n.classList.remove('active'));
        const match = document.querySelector(`.nav-item[data-section="${entry.target.id}"]`);
        if (match) match.classList.add('active');
      });
    }, { threshold: 0.25, rootMargin: '-15% 0px -75% 0px' });

    sections.forEach(s => obs.observe(s));
  }

  /* ==========================================================
     15. EVENT DELEGATION
  ========================================================== */

  function setupEvents() {

    /* --- Card actions (delegated at body so clicks inside dialogs work too) --- */
    document.body.addEventListener('click', e => {
      // Reopen completed initiative (button in completed-initiatives section)
      const reopenBtn = e.target.closest('[data-action="reopen-completed"]');
      if (reopenBtn && reopenBtn.dataset.initiative) {
        e.stopPropagation();
        reopenInitiative(reopenBtn.dataset.initiative);
        return;
      }

      // Activate button (tabled section)
      const activateBtn = e.target.closest('[data-action="activate"]');
      if (activateBtn && activateBtn.dataset.initiative) {
        e.stopPropagation();
        activateInitiative(activateBtn.dataset.initiative);
        return;
      }

      // Card action buttons
      const moveBtn = e.target.closest('[data-action="move"]');
      if (moveBtn) { e.stopPropagation(); openMovePopover(moveBtn.dataset.id, moveBtn); return; }

      const editBtn = e.target.closest('[data-action="edit"]');
      if (editBtn) { e.stopPropagation(); openCaptureModal({ id: editBtn.dataset.id }); return; }

      const doneBtn = e.target.closest('[data-action="done"]');
      if (doneBtn) { e.stopPropagation(); markDone(doneBtn.dataset.id); return; }

      const tableBtn = e.target.closest('[data-action="table"]');
      if (tableBtn) { e.stopPropagation(); tableItem(tableBtn.dataset.id); return; }

      const reactBtn = e.target.closest('[data-action="reactivate"]');
      if (reactBtn) { e.stopPropagation(); reactivateItem(reactBtn.dataset.id); return; }

      const archiveBtn = e.target.closest('[data-action="archive"]');
      if (archiveBtn) { e.stopPropagation(); archiveItem(archiveBtn.dataset.id); return; }

      const unarchiveBtn = e.target.closest('[data-action="unarchive"]');
      if (unarchiveBtn) { e.stopPropagation(); unarchiveItem(unarchiveBtn.dataset.id); return; }

      const deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) { e.stopPropagation(); deleteItem(deleteBtn.dataset.id); return; }

      // Checklist checkbox on an expanded card — tick off without opening Edit
      const checkBox = e.target.closest('[data-action="toggle-check"]');
      if (checkBox) {
        e.stopPropagation();
        toggleChecklistItem(checkBox.dataset.id, checkBox.dataset.cid);
        return;
      }

      // Dependency link in card detail
      const depLink = e.target.closest('.dep-item-link');
      if (depLink && depLink.dataset.id) {
        e.stopPropagation();
        openCaptureModal({ id: depLink.dataset.id });
        return;
      }

      // Card expand/collapse
      const cardMain = e.target.closest('.card-main');
      if (cardMain) {
        const card = cardMain.closest('.card');
        if (!card) return;
        state.activeItemId = state.activeItemId === card.dataset.id ? null : card.dataset.id;
        render();
        return;
      }

      // Add to lane button
      const addBtn = e.target.closest('.add-to-lane-btn');
      if (addBtn) { openCaptureModal({ lane: addBtn.dataset.lane }); return; }
    });

    /* --- Sidebar: initiative list and sub-panels --- */
    const sidebarPanel = document.querySelector('.initiative-panel');
    if (sidebarPanel) {
      sidebarPanel.addEventListener('click', e => {
        // ··· initiative action button
        const actionBtn = e.target.closest('.btn-init-action');
        if (actionBtn) {
          e.stopPropagation();
          openInitiativeActionPopover(
            actionBtn.dataset.initiative,
            actionBtn.dataset.category,
            actionBtn
          );
          return;
        }

        // Initiative chip — open detail view
        const chip = e.target.closest('.initiative-chip');
        if (chip && chip.dataset.initiative) {
          openInitiativeDetail(chip.dataset.initiative);
          return;
        }
      });
    }

    /* --- Initiative action popover buttons --- */
    document.getElementById('initiative-action-popover').addEventListener('click', e => {
      const btn = e.target.closest('.init-action-btn');
      if (btn) handleInitiativeAction(btn.dataset.action);
    });

    /* --- Clear filter --- */
    document.getElementById('clear-filter-btn').addEventListener('click', () => {
      state.filter.initiative = null;
      render();
    });

    /* --- Move popover --- */
    document.getElementById('move-popover-options').addEventListener('click', e => {
      const opt = e.target.closest('.move-option');
      if (!opt || !_popoverId) return;
      const laneLabel = LANES.find(l => l.id === opt.dataset.lane)?.label || opt.dataset.lane;
      moveItem(_popoverId, opt.dataset.lane);
      closeMovePopover();
      showToast('Moved to ' + laneLabel);
    });

    /* --- Quick capture --- */
    document.getElementById('quick-capture-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleQuickCapture();
    });
    document.getElementById('quick-capture-submit').addEventListener('click', handleQuickCapture);

    /* --- Capture modal --- */
    document.getElementById('capture-form').addEventListener('submit', handleCaptureSubmit);
    document.getElementById('modal-close-btn').addEventListener('click', closeCaptureModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeCaptureModal);

    /* --- Distraction modal + section actions --- */
    const dForm = document.getElementById('distraction-form');
    if (dForm) dForm.addEventListener('submit', handleDistractionSubmit);
    const dCloseBtn = document.getElementById('distraction-close-btn');
    if (dCloseBtn) dCloseBtn.addEventListener('click', closeDistractionModal);
    const dCancelBtn = document.getElementById('distraction-cancel-btn');
    if (dCancelBtn) dCancelBtn.addEventListener('click', closeDistractionModal);
    const dDialog = document.getElementById('distraction-modal');
    if (dDialog) {
      dDialog.addEventListener('click', e => {
        const rect = dDialog.getBoundingClientRect();
        const outside = e.clientX < rect.left || e.clientX > rect.right ||
                        e.clientY < rect.top  || e.clientY > rect.bottom;
        if (outside) closeDistractionModal();
      });
    }
    document.body.addEventListener('click', e => {
      const addBtn = e.target.closest('[data-action="log-distraction"]');
      if (addBtn) { e.stopPropagation(); openDistractionModal(); return; }
      const editBtn = e.target.closest('[data-action="edit-distraction"]');
      if (editBtn && editBtn.dataset.distractionId) {
        e.stopPropagation(); openDistractionModal({ id: editBtn.dataset.distractionId }); return;
      }
      const delBtn = e.target.closest('[data-action="delete-distraction"]');
      if (delBtn && delBtn.dataset.distractionId) {
        e.stopPropagation(); deleteDistraction(delBtn.dataset.distractionId); return;
      }
    });

    /* --- Initiative detail modal --- */
    document.getElementById('init-detail-close-btn').addEventListener('click', closeInitiativeDetail);
    document.getElementById('initiative-detail-modal').addEventListener('click', e => {
      const d    = e.currentTarget;
      const rect = d.getBoundingClientRect();
      const outside = e.clientX < rect.left || e.clientX > rect.right ||
                      e.clientY < rect.top  || e.clientY > rect.bottom;
      if (outside) closeInitiativeDetail();
    });

    document.getElementById('capture-modal').addEventListener('click', e => {
      const d    = e.currentTarget;
      const rect = d.getBoundingClientRect();
      const outside = e.clientX < rect.left || e.clientX > rect.right ||
                      e.clientY < rect.top  || e.clientY > rect.bottom;
      if (outside) closeCaptureModal();
    });

    /* --- Completed items period filter chips --- */
    const periodChips = document.getElementById('completed-period-chips');
    if (periodChips) {
      periodChips.addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip[data-period]');
        if (!chip) return;
        state.completedFilter.period = chip.dataset.period;
        periodChips.querySelectorAll('.filter-chip').forEach(c =>
          c.classList.toggle('active', c.dataset.period === chip.dataset.period)
        );
        renderCompletedItems();
      });
    }

    /* --- Completed items initiative filter --- */
    const completedInitSel = document.getElementById('completed-initiative-filter');
    if (completedInitSel) {
      completedInitSel.addEventListener('change', () => {
        state.completedFilter.initiative = completedInitSel.value || null;
        renderCompletedItems();
      });
    }

    /* --- JSON export / import --- */
    document.getElementById('export-json-btn').addEventListener('click', exportJSON);
    document.getElementById('import-json-btn').addEventListener('click', () => {
      document.getElementById('json-file-input').click();
    });
    document.getElementById('json-file-input').addEventListener('change', e => {
      if (e.target.files[0]) { handleJSONImport(e.target.files[0]); e.target.value = ''; }
    });

    /* --- Weekly review --- */
    document.getElementById('generate-report-btn').addEventListener('click', () => {
      const report = generateWeeklyReport();
      document.getElementById('report-text').textContent = report;
      const out = document.getElementById('review-report-output');
      out.hidden = false;
      document.getElementById('copy-report-btn').hidden = false;
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    document.getElementById('copy-report-btn').addEventListener('click', () => {
      navigator.clipboard
        .writeText(document.getElementById('report-text').textContent)
        .then(() => showToast('Report copied to clipboard'))
        .catch(() => showToast('Copy failed — select and copy manually'));
    });

    /* --- Clear all data --- */
    document.getElementById('reset-data-btn').addEventListener('click', () => {
      if (!confirm('Clear all data? This cannot be undone.')) return;
      localStorage.removeItem(STORAGE_KEY);
      state.items                = [];
      state.tabledInitiatives    = DEFAULT_TABLED.slice();
      state.completedInitiatives = [];
      state.deletedInitiatives   = [];
      state.filter.initiative    = null;
      state.completedFilter      = { initiative: null, period: 'all' };
      state.activeItemId         = null;
      saveState();
      render();
      showToast('Board cleared');
    });

    /* --- Global keyboard shortcuts --- */
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault(); openCaptureModal(); return;
      }
      if (e.key === 'Escape') {
        const distractionDialog = document.getElementById('distraction-modal');
        if (distractionDialog && distractionDialog.open) { closeDistractionModal(); return; }
        const detail = document.getElementById('initiative-detail-modal');
        if (detail.open) { closeInitiativeDetail(); return; }
        const d = document.getElementById('capture-modal');
        if (d.open) { closeCaptureModal(); return; }
        if (!document.getElementById('move-popover').hidden) { closeMovePopover(); return; }
        const ip = document.getElementById('initiative-action-popover');
        if (!ip.hidden) { closeInitiativeActionPopover(); return; }
      }
      if (e.key === 'n' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        openCaptureModal();
      }
    });

    /* --- Inline "Add Initiative" inside the capture modal --- */
    const addInitBtn   = document.getElementById('add-initiative-btn');
    const newInitRow   = document.getElementById('new-initiative-row');
    const newInitInput = document.getElementById('new-initiative-input');
    const newInitOk    = document.getElementById('new-initiative-confirm');
    const newInitNo    = document.getElementById('new-initiative-cancel');

    if (addInitBtn && newInitRow) {
      addInitBtn.addEventListener('click', () => {
        newInitRow.hidden = false;
        if (newInitInput) { newInitInput.value = ''; newInitInput.focus(); }
      });
    }
    if (newInitNo && newInitRow) {
      newInitNo.addEventListener('click', () => {
        newInitRow.hidden = true;
        if (newInitInput) newInitInput.value = '';
      });
    }
    if (newInitOk && newInitInput) {
      const confirmAdd = () => {
        const name = newInitInput.value.trim();
        if (!name) return;
        if (getAllInitiatives().includes(name)) {
          showToast('Initiative already exists');
          document.getElementById('form-initiative').value = name;
          newInitRow.hidden = true;
          newInitInput.value = '';
          return;
        }
        addCustomInitiative(name);
        populateFormSelects();
        document.getElementById('form-initiative').value = name;
        newInitRow.hidden = true;
        newInitInput.value = '';
        showToast(`"${name}" added`);
      };
      newInitOk.addEventListener('click', confirmAdd);
      newInitInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); }
      });
    }

    /* --- Drag and drop reordering (within or across lanes) --- */
    setupDragAndDrop();

    /* --- Vague-next-step soft warning --- */
    const nextStepInput = document.getElementById('form-next-step');
    if (nextStepInput) {
      nextStepInput.addEventListener('input', updateVagueHelper);
    }

    /* --- Sync indicator → opens diagnostic panel --- */
    const syncIndicator = document.getElementById('sync-indicator');
    if (syncIndicator) {
      syncIndicator.addEventListener('click', e => {
        e.preventDefault();
        openDiagPanel();
      });
    }
    const diagClose = document.getElementById('diag-close-btn');
    if (diagClose) diagClose.addEventListener('click', closeDiagPanel);
    const diagRefresh = document.getElementById('diag-refresh-btn');
    if (diagRefresh) diagRefresh.addEventListener('click', forceFetchNow);
    const diagPush = document.getElementById('diag-push-btn');
    if (diagPush) diagPush.addEventListener('click', forcePushNow);
    const diagProbe = document.getElementById('diag-probe-btn');
    if (diagProbe) diagProbe.addEventListener('click', testConnectivity);
    const diagCopy = document.getElementById('diag-copy-btn');
    if (diagCopy) diagCopy.addEventListener('click', copyDiagToClipboard);
    const diagPanel = document.getElementById('diag-panel');
    if (diagPanel) {
      diagPanel.addEventListener('click', e => {
        if (e.target === diagPanel) closeDiagPanel();
      });
    }

    /* --- URL hash trigger for diagnostics (works on mobile without devtools) --- */
    if (location.hash === '#diag') {
      setTimeout(openDiagPanel, 400);
    }
  }

  /* ==========================================================
     15b. VAGUE NEXT-STEP HELPER
  ========================================================== */

  const VAGUE_PATTERNS = [
    /\bfigure\s+out\b/i,
    /\bwork\s+on\b/i,
    /\bdeal\s+with\b/i,
    /\bthink\s+about\b/i,
    /\bhandle\b/i,
    /\blook\s+at\b/i,
  ];

  function isVagueNextStep(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    return VAGUE_PATTERNS.some(p => p.test(trimmed));
  }

  function updateVagueHelper() {
    const input  = document.getElementById('form-next-step');
    const helper = document.getElementById('form-next-step-vague');
    if (!input || !helper) return;
    if (isVagueNextStep(input.value)) {
      helper.hidden = false;
      helper.textContent = 'A bit vague — try a concrete verb like "Email X", "Draft outline", or "Schedule block".';
    } else {
      helper.hidden = true;
      helper.textContent = '';
    }
  }

  /* ==========================================================
     15a. DRAG AND DROP REORDER
  ========================================================== */

  let _dragId = null;

  function clearDragMarkers() {
    document.querySelectorAll('.card--dragging, .card--drag-over')
      .forEach(c => c.classList.remove('card--dragging', 'card--drag-over'));
  }

  function reorderItem(draggedId, targetId, dropAfter) {
    const items = state.items;
    const dragIdx = items.findIndex(i => i.id === draggedId);
    if (dragIdx < 0) return;
    const dragged = items[dragIdx];

    const targetIdx = items.findIndex(i => i.id === targetId);
    if (targetIdx < 0) return;
    const target = items[targetIdx];

    // If different lane, also adopt the target's lane (with auto-blocked rule)
    if (dragged.lane !== target.lane) {
      dragged.lane = target.lane;
      if (target.lane === 'waiting' && dragged.stage !== 'Done') {
        dragged.stage = 'Blocked';
      }
    }
    dragged.updatedAt = Date.now();

    items.splice(dragIdx, 1);
    let newTargetIdx = items.findIndex(i => i.id === targetId);
    if (dropAfter) newTargetIdx += 1;
    items.splice(newTargetIdx, 0, dragged);

    saveState();
    render();
  }

  function setupDragAndDrop() {
    document.addEventListener('dragstart', e => {
      const card = e.target.closest('.card[draggable]');
      if (!card) return;
      _dragId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', _dragId); } catch (err) {}
      requestAnimationFrame(() => card.classList.add('card--dragging'));
    });

    document.addEventListener('dragend', () => {
      _dragId = null;
      clearDragMarkers();
    });

    document.addEventListener('dragover', e => {
      if (!_dragId) return;
      const card = e.target.closest('.card[draggable]');
      if (!card || card.dataset.id === _dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.card--drag-over')
        .forEach(c => { if (c !== card) c.classList.remove('card--drag-over'); });
      card.classList.add('card--drag-over');
    });

    document.addEventListener('dragleave', e => {
      const card = e.target.closest('.card[draggable]');
      if (card) card.classList.remove('card--drag-over');
    });

    document.addEventListener('drop', e => {
      if (!_dragId) return;
      const card = e.target.closest('.card[draggable]');
      if (!card) { clearDragMarkers(); _dragId = null; return; }
      e.preventDefault();
      const targetId = card.dataset.id;
      if (targetId === _dragId) { clearDragMarkers(); _dragId = null; return; }

      // Drop in the bottom half of the target = after; top half = before
      const rect = card.getBoundingClientRect();
      const dropAfter = (e.clientY - rect.top) > rect.height / 2;

      const draggedId = _dragId;
      _dragId = null;
      clearDragMarkers();
      reorderItem(draggedId, targetId, dropAfter);
    });
  }

  /* ==========================================================
     16. PASSWORD GATE
  ========================================================== */

  async function sha256(str) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function setupPasswordGate(onSuccess) {
    const gate  = document.getElementById('password-gate');
    const form  = document.getElementById('password-form');
    const input = document.getElementById('password-input');
    const err   = document.getElementById('password-error');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const hash = await sha256(input.value);
      if (hash === AUTH_HASH) {
        sessionStorage.setItem(AUTH_SESSION_KEY, '1');
        input.classList.remove('input-error');
        err.hidden = true;
        gate.classList.add('unlocking');
        setTimeout(() => {
          gate.hidden = true;
          document.body.classList.remove('app-locked');
          onSuccess();
        }, 260);
      } else {
        input.value = '';
        input.classList.add('input-error');
        err.hidden = false;
        setTimeout(() => input.classList.remove('input-error'), 500);
        input.focus();
      }
    });
  }

  /* ==========================================================
     17. INIT
  ========================================================== */

  async function init() {
    initSupabase();
    renderSyncIndicator();
    await loadState();
    populateFormSelects();
    render();
    setupScrollSpy();
    setupDependencySearch();
    setupChecklistEditor();
    setupEvents();
    setupRealtimeSync();
    setupVisibilityRefresh();
    renderSyncIndicator();

    setTimeout(() => {
      document.getElementById('today')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Already authenticated this session?
    if (sessionStorage.getItem(AUTH_SESSION_KEY) === '1') {
      document.getElementById('password-gate').hidden = true;
      document.body.classList.remove('app-locked');
      init();
      return;
    }
    // Show password gate; run init on success
    setupPasswordGate(init);
  });

})();
