// ============ State ============
const state = {
  user: null,
  boards: [],
  currentBoardId: null,
  board: null,
  lanes: [],
  notes: [],
  categories: [],
  editing: null,
  filter: { categoryId: '' },
  drawing: {
    strokes: [],
    currentStroke: null,
    tool: 'pen',
    size: 3,
    color: '#2b2a27'
  }
};

const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
const PEN_COLORS = [
  { name: 'black',  hex: '#2b2a27' },
  { name: 'red',    hex: '#dc2626' },
  { name: 'orange', hex: '#ea580c' },
  { name: 'yellow', hex: '#d4a017' },
  { name: 'green',  hex: '#16a34a' },
  { name: 'blue',   hex: '#2563eb' },
  { name: 'purple', hex: '#7c3aed' },
  { name: 'pink',   hex: '#db2777' },
  { name: 'white',  hex: '#fafafa' },
];
const CATEGORY_COLORS = ['red','orange','yellow','green','blue','purple','pink','teal','gray'];

// ============ API helpers ============
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('unauth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

// ============ Init ============
(async function init() {
  try {
    const me = await api('/api/me');
    if (!me.user) { location.href = '/login.html'; return; }
    state.user = me.user;
    document.getElementById('user-label').textContent = `@${me.user.username}`;
    if (me.user.is_admin) document.getElementById('admin-row').hidden = false;

    const bd = await api('/api/boards');
    state.boards = bd.boards;
    let initialId = null;
    try { initialId = parseInt(localStorage.getItem('currentBoard'), 10); } catch {}
    if (!state.boards.find(b => b.id === initialId)) initialId = state.boards[0]?.id || null;

    if (initialId) await loadBoard(initialId);
    wireGlobal();
  } catch (e) {
    console.error(e);
  }
})();

async function loadBoard(id) {
  const b = await api(`/api/board?id=${id}`);
  state.board = b.board;
  state.lanes = b.lanes;
  state.notes = b.notes;
  state.categories = b.categories;
  state.currentBoardId = b.board.id;
  try { localStorage.setItem('currentBoard', String(b.board.id)); } catch {}
  document.getElementById('board-name').textContent = b.board.name;
  updateCategoryFilter();
  renderBoard();
}

// ============ Preferences ============
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : '';
  document.body.classList.toggle('dark', dark);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = dark ? '☀' : '🌙';
}
function applyFont(font) {
  document.documentElement.dataset.font = font === 'sans' ? 'sans' : '';
  const btn = document.getElementById('font-btn');
  if (btn) btn.textContent = font === 'sans' ? 'Standard' : 'Handwritten';
}
function applyLaneWidth(mode) {
  const m = mode === 'wide' || mode === 'xwide' ? mode : '';
  document.documentElement.dataset.lane = m;
  const btn = document.getElementById('lane-width-btn');
  if (btn) btn.textContent = m === 'xwide' ? 'Extra wide' : m === 'wide' ? 'Wide' : 'Standard';
}
function applyStickyTheme(mode) {
  const dark = mode === 'dark';
  document.documentElement.dataset.sticky = dark ? 'dark' : '';
  const btn = document.getElementById('sticky-theme-btn');
  if (btn) btn.textContent = dark ? 'Muted' : 'Bright';
}

// ============ Global wiring ============
function wireGlobal() {
  // Preferences
  let theme = 'light', font = 'handwritten', stickyTheme = 'light';
  try {
    theme = localStorage.getItem('theme') || 'light';
    font = localStorage.getItem('font') || 'handwritten';
    stickyTheme = localStorage.getItem('stickyTheme') || 'light';
  } catch {}
  let laneWidth = 'standard';
  try { laneWidth = localStorage.getItem('laneWidth') || 'standard'; } catch {}
  applyTheme(theme);
  applyFont(font);
  applyStickyTheme(stickyTheme);
  applyLaneWidth(laneWidth);

  document.getElementById('theme-btn').addEventListener('click', () => {
    const next = document.body.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch {}
    applyTheme(next);
  });
  document.getElementById('font-btn').addEventListener('click', () => {
    const curr = document.documentElement.dataset.font === 'sans' ? 'sans' : 'handwritten';
    const next = curr === 'sans' ? 'handwritten' : 'sans';
    try { localStorage.setItem('font', next); } catch {}
    applyFont(next);
  });
  document.getElementById('lane-width-btn').addEventListener('click', () => {
    const curr = document.documentElement.dataset.lane || 'standard';
    const order = ['standard', 'wide', 'xwide'];
    const next = order[(order.indexOf(curr === 'standard' ? 'standard' : curr) + 1) % order.length];
    try { localStorage.setItem('laneWidth', next); } catch {}
    applyLaneWidth(next);
  });
  document.getElementById('sticky-theme-btn').addEventListener('click', () => {
    const curr = document.documentElement.dataset.sticky === 'dark' ? 'dark' : 'light';
    const next = curr === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('stickyTheme', next); } catch {}
    applyStickyTheme(next);
  });

  // Settings popover
  const settingsBtn = document.getElementById('settings-btn');
  const settingsMenu = document.getElementById('settings-menu');
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    positionPopover(settingsMenu, settingsBtn);
    settingsMenu.hidden = !settingsMenu.hidden;
  });

  // Boards popover
  const boardBtn = document.getElementById('board-btn');
  const boardsMenu = document.getElementById('boards-menu');
  boardBtn.addEventListener('click', e => {
    e.stopPropagation();
    renderBoardsMenu();
    positionPopover(boardsMenu, boardBtn);
    boardsMenu.hidden = !boardsMenu.hidden;
  });

  // Close popovers on outside click
  document.addEventListener('pointerdown', e => {
    [settingsMenu, boardsMenu].forEach(m => {
      if (!m.hidden && !m.contains(e.target) &&
          !e.target.closest('#settings-btn') && !e.target.closest('#board-btn')) {
        m.hidden = true;
      }
    });
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  // Add lane
  document.getElementById('add-lane-btn').addEventListener('click', async () => {
    if (!state.currentBoardId) return;
    const name = prompt('New lane name:');
    if (!name) return;
    const lane = await api('/api/lanes', { method: 'POST', body: { board_id: state.currentBoardId, name } });
    state.lanes.push(lane);
    renderBoard();
  });

  // Filter
  document.getElementById('filter-category').addEventListener('change', e => {
    state.filter.categoryId = e.target.value;
    applyFilter();
  });

  // Categories management
  document.getElementById('categories-btn').addEventListener('click', () => {
    settingsMenu.hidden = true;
    openCategoriesModal();
  });

  // Change password
  document.getElementById('password-btn').addEventListener('click', async () => {
    settingsMenu.hidden = true;
    const current = prompt('Current password:');
    if (current == null) return;
    const next = prompt('New password (min 6 chars):');
    if (next == null) return;
    const confirm2 = prompt('Confirm new password:');
    if (confirm2 == null) return;
    if (next !== confirm2) { alert('New passwords do not match.'); return; }
    try {
      await api('/api/password', { method: 'POST', body: { current_password: current, new_password: next } });
      alert('Password changed.');
    } catch (e) { alert(e.message); }
  });
  document.getElementById('cat-close').addEventListener('click', () => {
    document.getElementById('categories-modal').hidden = true;
  });
  document.getElementById('cat-new-btn').addEventListener('click', addCategory);
  document.getElementById('cat-new-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCategory();
  });

  // Populate cat-new-color
  const catNewColor = document.getElementById('cat-new-color');
  CATEGORY_COLORS.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    catNewColor.appendChild(opt);
  });

  // Editor color palette
  const cp = document.getElementById('color-picker');
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-dot';
    d.dataset.color = c;
    d.style.background = `var(--sticky-${c})`;
    d.addEventListener('click', () => setEditorColor(c));
    cp.appendChild(d);
  });

  // Pen color palette
  const pcp = document.getElementById('pen-color-picker');
  PEN_COLORS.forEach(pc => {
    const d = document.createElement('div');
    d.className = 'color-dot';
    d.dataset.penColor = pc.hex;
    d.title = pc.name;
    d.style.background = pc.hex;
    d.addEventListener('click', () => setPenColor(pc.hex));
    pcp.appendChild(d);
  });

  // Editor mode/tools
  document.querySelectorAll('.mode-group .tool').forEach(b =>
    b.addEventListener('click', () => setEditorMode(b.dataset.mode)));
  document.querySelectorAll('.draw-tools .tool[data-draw-tool]').forEach(b =>
    b.addEventListener('click', () => setDrawTool(b.dataset.drawTool)));
  document.getElementById('brush-size').addEventListener('input', e => {
    state.drawing.size = parseInt(e.target.value, 10);
  });
  document.getElementById('undo-btn').addEventListener('click', undoStroke);
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!confirm('Clear drawing?')) return;
    state.drawing.strokes = [];
    redrawCanvas();
  });
  document.getElementById('save-note-btn').addEventListener('click', saveEditor);
  document.getElementById('delete-note-btn').addEventListener('click', deleteFromEditor);
  document.getElementById('note-due-clear').addEventListener('click', () => {
    document.getElementById('note-due').value = '';
  });
  document.getElementById('editor').addEventListener('click', e => {
    if (e.target.id === 'editor') saveEditor();
  });

  setupCanvas();
}

function positionPopover(el, anchor) {
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 4}px`;
  el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  el.style.left = 'auto';
}

// ============ Boards menu ============
function renderBoardsMenu() {
  const menu = document.getElementById('boards-menu');
  menu.innerHTML = '';
  state.boards.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'popover-item' + (b.id === state.currentBoardId ? ' active' : '');
    btn.innerHTML = `<span>${escapeHtml(b.name)}</span>${b.id === state.currentBoardId ? '<span>✓</span>' : ''}`;
    btn.addEventListener('click', async () => {
      menu.hidden = true;
      if (b.id !== state.currentBoardId) await loadBoard(b.id);
    });
    menu.appendChild(btn);
  });
  const sep = document.createElement('div');
  sep.className = 'popover-sep';
  menu.appendChild(sep);

  const addNew = document.createElement('button');
  addNew.className = 'popover-item';
  addNew.textContent = '+ New board';
  addNew.addEventListener('click', async () => {
    menu.hidden = true;
    const name = prompt('New board name:');
    if (!name) return;
    const b = await api('/api/boards', { method: 'POST', body: { name: name.trim() } });
    state.boards.push(b);
    await loadBoard(b.id);
  });
  menu.appendChild(addNew);

  const rename = document.createElement('button');
  rename.className = 'popover-item';
  rename.textContent = 'Rename current';
  rename.addEventListener('click', async () => {
    menu.hidden = true;
    const curr = state.boards.find(b => b.id === state.currentBoardId);
    if (!curr) return;
    const name = prompt('Rename board:', curr.name);
    if (!name) return;
    await api(`/api/boards/${curr.id}`, { method: 'PATCH', body: { name: name.trim() } });
    curr.name = name.trim();
    document.getElementById('board-name').textContent = curr.name;
  });
  menu.appendChild(rename);

  const del = document.createElement('button');
  del.className = 'popover-item';
  del.textContent = 'Delete current';
  del.addEventListener('click', async () => {
    menu.hidden = true;
    const curr = state.boards.find(b => b.id === state.currentBoardId);
    if (!curr) return;
    if (state.boards.length <= 1) { alert('Cannot delete the last board.'); return; }
    if (!confirm(`Delete board "${curr.name}" and all its lanes/notes?`)) return;
    try { await api(`/api/boards/${curr.id}`, { method: 'DELETE' }); }
    catch (err) { alert(err.message); return; }
    state.boards = state.boards.filter(b => b.id !== curr.id);
    await loadBoard(state.boards[0].id);
  });
  menu.appendChild(del);
}

// ============ Category filter ============
function updateCategoryFilter() {
  const sel = document.getElementById('filter-category');
  const current = sel.value;
  sel.innerHTML = '<option value="">All categories</option>';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
  if (state.categories.find(c => String(c.id) === current)) sel.value = current;
  else { sel.value = ''; state.filter.categoryId = ''; }
}
function applyFilter() {
  const cid = state.filter.categoryId;
  document.querySelectorAll('.note').forEach(el => {
    const noteId = parseInt(el.dataset.noteId, 10);
    const n = state.notes.find(x => x.id === noteId);
    if (!n) return;
    const match = !cid || String(n.category_id) === String(cid);
    el.classList.toggle('filtered-out', !match);
  });
}

// ============ Render board ============
function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  state.lanes.sort((a, b) => a.position - b.position || a.id - b.id);
  state.lanes.forEach(lane => board.appendChild(renderLane(lane)));
  applyFilter();
}

function renderLane(lane) {
  const notes = state.notes
    .filter(n => n.lane_id === lane.id)
    .sort((a, b) => a.position - b.position || a.id - b.id);

  const el = document.createElement('section');
  el.className = 'lane';
  el.dataset.laneId = lane.id;
  el.innerHTML = `
    <header class="lane-header">
      <input class="lane-title" value="${escapeHtml(lane.name)}" maxlength="80" />
      <span class="lane-count">${notes.length}</span>
      <button class="lane-menu-btn" title="Lane options">⋯</button>
    </header>
    <div class="lane-body">
      <button class="add-note-btn">+ Add note</button>
    </div>
  `;

  const title = el.querySelector('.lane-title');
  title.addEventListener('change', async () => {
    const name = title.value.trim().slice(0, 80);
    if (!name) { title.value = lane.name; return; }
    await api(`/api/lanes/${lane.id}`, { method: 'PATCH', body: { name } });
    lane.name = name;
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') title.blur(); });

  el.querySelector('.lane-menu-btn').addEventListener('click', e => openLaneMenu(e, lane));
  el.querySelector('.add-note-btn').addEventListener('click', () => addNote(lane.id));

  const body = el.querySelector('.lane-body');
  const addBtn = body.querySelector('.add-note-btn');
  notes.forEach(n => body.insertBefore(renderNote(n), addBtn));
  return el;
}

function renderNote(note) {
  const el = document.createElement('article');
  el.className = 'note';
  el.dataset.noteId = note.id;
  el.dataset.color = note.color;
  el.style.setProperty('--rot', `${note.rotation}deg`);
  el.style.transform = `rotate(${note.rotation}deg)`;
  if (note.done) el.classList.add('is-done');

  // Header row: checkbox + title
  const header = document.createElement('div');
  header.className = 'note-header-row';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'note-check';
  check.checked = !!note.done;
  check.addEventListener('click', e => e.stopPropagation());
  check.addEventListener('change', async () => {
    note.done = check.checked ? 1 : 0;
    el.classList.toggle('is-done', !!note.done);
    try { await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { done: !!note.done } }); }
    catch (err) { console.error(err); }
  });
  // Swallow pointer events on the checkbox so the drag handler doesn't steal them
  check.addEventListener('pointerdown', e => e.stopPropagation());
  header.appendChild(check);

  if (note.title) {
    const t = document.createElement('div');
    t.className = 'note-title';
    t.textContent = note.title;
    header.appendChild(t);
  }
  el.appendChild(header);

  if (note.text) {
    const textEl = document.createElement('div');
    textEl.className = 'note-text';
    textEl.textContent = note.text;
    el.appendChild(textEl);
  }

  if (note.drawing) {
    const canvas = document.createElement('canvas');
    canvas.className = 'note-drawing';
    canvas.width = 260; canvas.height = 180;
    el.appendChild(canvas);
    try {
      const data = JSON.parse(note.drawing);
      drawStrokesOn(canvas, data.strokes || [], data.width || 520, data.height || 520);
    } catch {}
  }

  if (!note.title && !note.text && !note.drawing) {
    const ph = document.createElement('div');
    ph.className = 'note-text';
    ph.textContent = '(empty — tap to edit)';
    ph.style.color = 'rgba(0,0,0,0.35)';
    el.appendChild(ph);
  }

  // Meta row (category + due)
  const cat = state.categories.find(c => c.id === note.category_id);
  const dueStr = note.due_date ? formatDue(note.due_date) : null;
  if (cat || dueStr) {
    const meta = document.createElement('div');
    meta.className = 'note-meta-row';
    if (cat) {
      const p = document.createElement('span');
      p.className = `note-category-pill cat-${cat.color}`;
      p.textContent = cat.name;
      meta.appendChild(p);
    }
    if (dueStr) {
      const d = document.createElement('span');
      d.className = 'note-due' + (isOverdue(note) ? ' overdue' : '');
      d.textContent = (isOverdue(note) ? '⚑ ' : '') + dueStr;
      meta.appendChild(d);
    }
    el.appendChild(meta);
  }

  attachNoteInteractions(el, note);
  return el;
}

function formatDue(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  const diffDays = Math.round((dd - today) / 86400000);
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays === -1) return 'Due yesterday';
  if (diffDays > 1 && diffDays <= 6) return `Due ${d.toLocaleDateString(undefined, { weekday: 'short' })}`;
  return `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
function isOverdue(note) {
  if (!note.due_date || note.done) return false;
  const d = new Date(note.due_date); d.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return d < today;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ============ Lane menu ============
function openLaneMenu(e, lane) {
  closeLaneMenu();
  const menu = document.createElement('div');
  menu.className = 'lane-menu';
  menu.innerHTML = `
    <button data-act="rename">Rename</button>
    <button data-act="left">Move left</button>
    <button data-act="right">Move right</button>
    <button data-act="delete" class="danger">Delete</button>
  `;
  document.body.appendChild(menu);
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.right - 160}px`;
  menu.addEventListener('click', async ev => {
    const act = ev.target.dataset.act;
    if (!act) return;
    closeLaneMenu();
    if (act === 'rename') {
      const name = prompt('Rename lane:', lane.name);
      if (!name) return;
      await api(`/api/lanes/${lane.id}`, { method: 'PATCH', body: { name: name.trim() } });
      lane.name = name.trim();
      renderBoard();
    } else if (act === 'delete') {
      if (!confirm(`Delete lane "${lane.name}"? Notes in it will be removed.`)) return;
      try { await api(`/api/lanes/${lane.id}`, { method: 'DELETE' }); }
      catch (err) { alert(err.message); return; }
      state.lanes = state.lanes.filter(l => l.id !== lane.id);
      state.notes = state.notes.filter(n => n.lane_id !== lane.id);
      renderBoard();
    } else if (act === 'left' || act === 'right') {
      const ids = state.lanes.sort((a,b) => a.position - b.position).map(l => l.id);
      const idx = ids.indexOf(lane.id);
      const tgt = act === 'left' ? idx - 1 : idx + 1;
      if (tgt < 0 || tgt >= ids.length) return;
      [ids[idx], ids[tgt]] = [ids[tgt], ids[idx]];
      ids.forEach((id, i) => { const l = state.lanes.find(x => x.id === id); if (l) l.position = i; });
      await api('/api/lanes/reorder', { method: 'POST', body: { ids } });
      renderBoard();
    }
  });
  setTimeout(() => document.addEventListener('pointerdown', outsideLaneMenu, true), 0);
}
function outsideLaneMenu(e) {
  if (e.target.closest('.lane-menu')) return;
  closeLaneMenu();
}
function closeLaneMenu() {
  document.removeEventListener('pointerdown', outsideLaneMenu, true);
  document.querySelectorAll('.lane-menu').forEach(m => m.remove());
}

// ============ Drag and drop ============
function attachNoteInteractions(el, note) {
  let startX = 0, startY = 0, moved = false, dragging = false;
  let ghost = null, placeholder = null, pointerId = null;
  let rafPending = false, lastClientX = 0, lastClientY = 0;
  let longPressTimer = null, pointerType = 'mouse', cancelled = false;
  const LONG_PRESS_MS = 350;

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input','textarea','button','a','select'].includes(tag)) return;
    pointerId = e.pointerId;
    pointerType = e.pointerType || 'mouse';
    startX = e.clientX; startY = e.clientY;
    moved = false; dragging = false; cancelled = false;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    if (pointerType === 'touch') {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (moved || cancelled) return;
        try { el.setPointerCapture(pointerId); } catch {}
        dragging = true;
        beginDrag({ clientX: startX, clientY: startY });
        lastClientX = startX; lastClientY = startY;
        if (navigator.vibrate) try { navigator.vibrate(10); } catch {}
        document.addEventListener('touchmove', blockTouch, { passive: false });
      }, LONG_PRESS_MS);
    } else {
      try { el.setPointerCapture(pointerId); } catch {}
    }
  };
  const blockTouch = (e) => { if (dragging) e.preventDefault(); };

  const onPointerMove = (e) => {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 6) return;
      if (pointerType === 'touch') {
        moved = true;
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        return;
      }
      dragging = true;
      beginDrag(e);
    }
    lastClientX = e.clientX; lastClientY = e.clientY;
    moved = true;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (ghost) {
          ghost.style.left = `${lastClientX - ghost._offsetX}px`;
          ghost.style.top  = `${lastClientY - ghost._offsetY}px`;
          updateDropTarget(lastClientX, lastClientY);
        }
      });
    }
  };

  const beginDrag = (e) => {
    const rect = el.getBoundingClientRect();
    ghost = el.cloneNode(true);
    ghost.classList.add('dragging');
    ghost.style.position = 'fixed';
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top  = `${rect.top}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.setProperty('--drag-rot', `${(Math.random()*6-3).toFixed(2)}deg`);
    ghost._offsetX = e.clientX - rect.left;
    ghost._offsetY = e.clientY - rect.top;
    document.body.appendChild(ghost);
    placeholder = document.createElement('article');
    placeholder.className = 'note placeholder';
    placeholder.style.height = `${rect.height}px`;
    el.parentNode.insertBefore(placeholder, el);
    el.style.display = 'none';
  };

  const updateDropTarget = (x, y) => {
    const under = document.elementFromPoint(x, y);
    if (!under) return;
    const lane = under.closest('.lane');
    if (!lane) return;
    const body = lane.querySelector('.lane-body');
    document.querySelectorAll('.lane-body.drag-over').forEach(b => {
      if (b !== body) b.classList.remove('drag-over');
    });
    body.classList.add('drag-over');

    const children = [...body.querySelectorAll('.note:not(.placeholder)')].filter(n => n !== el);
    let inserted = false;
    for (const child of children) {
      if (child === placeholder) continue;
      const r = child.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        body.insertBefore(placeholder, child);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      const addBtn = body.querySelector('.add-note-btn');
      if (addBtn) body.insertBefore(placeholder, addBtn);
      else body.appendChild(placeholder);
    }
  };

  const onPointerUp = async (e) => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    document.removeEventListener('touchmove', blockTouch);
    try { el.releasePointerCapture(pointerId); } catch {}

    if (e.type === 'pointercancel') {
      cancelled = true;
      if (dragging) {
        if (placeholder?.parentNode) placeholder.parentNode.replaceChild(el, placeholder);
        el.style.display = '';
        ghost?.remove(); ghost = null; placeholder = null;
        document.querySelectorAll('.lane-body.drag-over').forEach(b => b.classList.remove('drag-over'));
      }
      return;
    }

    if (!dragging) {
      if (moved) return;
      openEditor(note);
      return;
    }

    if (placeholder?.parentNode) placeholder.parentNode.replaceChild(el, placeholder);
    el.style.display = '';
    ghost?.remove(); ghost = null; placeholder = null;
    document.querySelectorAll('.lane-body.drag-over').forEach(b => b.classList.remove('drag-over'));

    const lane = el.closest('.lane');
    if (!lane) return;
    const newLaneId = parseInt(lane.dataset.laneId, 10);
    const body = lane.querySelector('.lane-body');
    const ids = [...body.querySelectorAll('.note')].map(n => parseInt(n.dataset.noteId, 10));

    note.lane_id = newLaneId;
    ids.forEach((id, i) => {
      const n = state.notes.find(x => x.id === id);
      if (n) { n.position = i; n.lane_id = newLaneId; }
    });

    try { await api('/api/notes/reorder', { method: 'POST', body: { lane_id: newLaneId, ids } }); }
    catch (err) { console.error(err); }
    renderCounts();
  };

  el.addEventListener('pointerdown', onPointerDown);
}

function renderCounts() {
  document.querySelectorAll('.lane').forEach(lane => {
    const id = parseInt(lane.dataset.laneId, 10);
    const count = state.notes.filter(n => n.lane_id === id).length;
    lane.querySelector('.lane-count').textContent = count;
  });
}

// ============ Notes create ============
async function addNote(laneId) {
  const body = { lane_id: laneId };
  const filterId = parseInt(state.filter?.categoryId, 10);
  if (Number.isFinite(filterId) && state.categories.some(c => c.id === filterId)) {
    body.category_id = filterId;
  }
  const note = await api('/api/notes', { method: 'POST', body });
  state.notes.push(note);
  openEditor(note, true);
  renderBoard();
}

// ============ Editor ============
function openEditor(note, isNew = false) {
  state.editing = { note, isNew };
  const backdrop = document.getElementById('editor');
  backdrop.hidden = false;

  document.getElementById('note-title').value = note.title || '';
  document.getElementById('note-text').value = note.text || '';
  document.getElementById('note-done').checked = !!note.done;
  document.getElementById('note-due').value = note.due_date ? toDateInput(note.due_date) : '';

  // Populate categories dropdown
  const catSel = document.getElementById('note-category');
  catSel.innerHTML = '<option value="">— none —</option>';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    catSel.appendChild(o);
  });
  catSel.value = note.category_id || '';

  const editorNote = document.getElementById('editor-note');
  editorNote.dataset.color = note.color;

  let strokes = [];
  try {
    if (note.drawing) {
      const parsed = JSON.parse(note.drawing);
      strokes = parsed.strokes || [];
    }
  } catch {}
  state.drawing.strokes = strokes;
  state.drawing.tool = 'pen';
  state.drawing.size = 3;
  state.drawing.color = '#2b2a27';

  document.querySelectorAll('#color-picker .color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === note.color));
  document.querySelectorAll('#pen-color-picker .color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.penColor === state.drawing.color));
  document.querySelectorAll('.draw-tools .tool[data-draw-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.drawTool === 'pen'));
  document.getElementById('brush-size').value = '3';

  let savedMode = 'text';
  try { savedMode = localStorage.getItem('editorMode') === 'draw' ? 'draw' : 'text'; } catch {}
  setEditorMode(savedMode);
  requestAnimationFrame(() => {
    resizeCanvas();
    redrawCanvas();
    if (savedMode === 'text') {
      const target = isNew ? document.getElementById('note-title') : document.getElementById('note-text');
      target.focus();
      if (target.setSelectionRange) target.setSelectionRange(target.value.length, target.value.length);
    }
  });
}

function toDateInput(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromDateInput(val) {
  if (!val) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function setEditorMode(mode) {
  try { localStorage.setItem('editorMode', mode); } catch {}
  const editorNote = document.getElementById('editor-note');
  editorNote.classList.toggle('mode-text', mode === 'text');
  editorNote.classList.toggle('mode-draw', mode === 'draw');
  document.querySelectorAll('.mode-group .tool').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelector('.draw-tools').hidden = mode !== 'draw';
  if (mode === 'draw') { resizeCanvas(); redrawCanvas(); }
}

function setDrawTool(tool) {
  state.drawing.tool = tool;
  document.querySelectorAll('.draw-tools .tool[data-draw-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.drawTool === tool));
}

function setPenColor(hex) {
  state.drawing.color = hex;
  state.drawing.tool = 'pen';
  document.querySelectorAll('#pen-color-picker .color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.penColor === hex));
  document.querySelectorAll('.draw-tools .tool[data-draw-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.drawTool === 'pen'));
}

function setEditorColor(color) {
  if (!state.editing) return;
  state.editing.note.color = color;
  document.getElementById('editor-note').dataset.color = color;
  document.querySelectorAll('#color-picker .color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === color));
}

async function saveEditor() {
  if (!state.editing) return;
  const { note } = state.editing;
  const title = document.getElementById('note-title').value;
  const text = document.getElementById('note-text').value;
  const done = document.getElementById('note-done').checked;
  const due_date = fromDateInput(document.getElementById('note-due').value);
  const catVal = document.getElementById('note-category').value;
  const category_id = catVal ? parseInt(catVal, 10) : null;
  const drawing = state.drawing.strokes.length
    ? JSON.stringify({
        strokes: state.drawing.strokes,
        width: canvasLogicalWidth(),
        height: canvasLogicalHeight()
      })
    : '';
  note.title = title;
  note.text = text;
  note.drawing = drawing;
  note.done = done ? 1 : 0;
  note.due_date = due_date;
  note.category_id = category_id;
  try {
    await api(`/api/notes/${note.id}`, {
      method: 'PATCH',
      body: { title, text, drawing, color: note.color, done, due_date, category_id }
    });
  } catch (e) { console.error(e); alert(e.message); }
  state.editing = null;
  document.getElementById('editor').hidden = true;
  renderBoard();
}

async function deleteFromEditor() {
  if (!state.editing) return;
  if (!confirm('Delete this note?')) return;
  const { note } = state.editing;
  try { await api(`/api/notes/${note.id}`, { method: 'DELETE' }); }
  catch (e) { console.error(e); }
  state.notes = state.notes.filter(n => n.id !== note.id);
  state.editing = null;
  document.getElementById('editor').hidden = true;
  renderBoard();
}

// ============ Categories modal ============
function openCategoriesModal() {
  document.getElementById('categories-modal').hidden = false;
  renderCategoriesList();
}

function renderCategoriesList() {
  const list = document.getElementById('cat-list');
  list.innerHTML = '';
  if (state.categories.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--muted)';
    empty.style.padding = '8px';
    empty.textContent = 'No categories yet.';
    list.appendChild(empty);
    return;
  }
  state.categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    const pill = document.createElement('span');
    pill.className = `note-category-pill cat-${cat.color}`;
    pill.textContent = cat.name;
    pill.style.marginTop = '0';
    row.appendChild(pill);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = cat.name;
    nameInput.addEventListener('change', async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.value = cat.name; return; }
      await api(`/api/categories/${cat.id}`, { method: 'PATCH', body: { name } });
      cat.name = name;
      pill.textContent = name;
      updateCategoryFilter(); renderBoard();
    });
    row.appendChild(nameInput);

    const colorSel = document.createElement('select');
    CATEGORY_COLORS.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      if (c === cat.color) o.selected = true;
      colorSel.appendChild(o);
    });
    colorSel.addEventListener('change', async () => {
      const color = colorSel.value;
      await api(`/api/categories/${cat.id}`, { method: 'PATCH', body: { color } });
      cat.color = color;
      pill.className = `note-category-pill cat-${color}`;
      renderBoard();
    });
    row.appendChild(colorSel);

    const delBtn = document.createElement('button');
    delBtn.className = 'tiny-btn';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete category "${cat.name}"?`)) return;
      await api(`/api/categories/${cat.id}`, { method: 'DELETE' });
      state.categories = state.categories.filter(c => c.id !== cat.id);
      state.notes.forEach(n => { if (n.category_id === cat.id) n.category_id = null; });
      renderCategoriesList(); updateCategoryFilter(); renderBoard();
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  });
}

async function addCategory() {
  const name = document.getElementById('cat-new-name').value.trim();
  if (!name) return;
  const color = document.getElementById('cat-new-color').value;
  const c = await api('/api/categories', {
    method: 'POST',
    body: { board_id: state.currentBoardId, name, color }
  });
  state.categories.push(c);
  document.getElementById('cat-new-name').value = '';
  renderCategoriesList(); updateCategoryFilter();
}

// ============ Drawing canvas ============
let ctx = null;
let canvasDPR = 1;

function setupCanvas() {
  const canvas = document.getElementById('note-canvas');
  ctx = canvas.getContext('2d');
  const ro = new ResizeObserver(() => {
    if (document.getElementById('editor').hidden) return;
    resizeCanvas(); redrawCanvas();
  });
  ro.observe(canvas);
  window.addEventListener('resize', () => {
    if (document.getElementById('editor').hidden) return;
    resizeCanvas(); redrawCanvas();
  });

  canvas.addEventListener('pointerdown', e => {
    if (document.getElementById('editor-note').classList.contains('mode-text')) return;
    e.preventDefault();
    e.stopPropagation();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const p = eventPoint(e, canvas);
    const isEraser = state.drawing.tool === 'eraser' || e.buttons === 32;
    state.drawing.currentStroke = {
      tool: isEraser ? 'eraser' : 'pen',
      color: state.drawing.color,
      size: state.drawing.size,
      points: [p]
    };
    state.drawing.strokes.push(state.drawing.currentStroke);
    ctx.setTransform(canvasDPR, 0, 0, canvasDPR, 0, 0);
    renderStroke(ctx, state.drawing.currentStroke);
  });
  // Block native touch gestures (selection, callout) that can sneak in during rapid strokes
  canvas.addEventListener('touchstart', e => {
    if (!document.getElementById('editor-note').classList.contains('mode-text')) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (!document.getElementById('editor-note').classList.contains('mode-text')) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('selectstart', e => e.preventDefault());
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const moveHandler = e => {
    if (!state.drawing.currentStroke) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    (events.length ? events : [e]).forEach(ev => {
      state.drawing.currentStroke.points.push(eventPoint(ev, canvas));
    });
    drawLastSegment();
  };
  canvas.addEventListener('pointermove', moveHandler);

  const endHandler = e => {
    if (!state.drawing.currentStroke) return;
    state.drawing.currentStroke = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  };
  canvas.addEventListener('pointerup', endHandler);
  canvas.addEventListener('pointercancel', endHandler);
  canvas.addEventListener('pointerleave', e => {
    if (state.drawing.currentStroke) endHandler(e);
  });
}

function eventPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const pressure = (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5;
  return [x, y, pressure];
}

function canvasLogicalWidth() { return document.getElementById('note-canvas').clientWidth; }
function canvasLogicalHeight() { return document.getElementById('note-canvas').clientHeight; }

function resizeCanvas() {
  const canvas = document.getElementById('note-canvas');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvasDPR = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.max(1, Math.floor(w * canvasDPR));
  canvas.height = Math.max(1, Math.floor(h * canvasDPR));
}

function redrawCanvas() {
  const canvas = document.getElementById('note-canvas');
  if (!ctx || canvas.width === 0) return;
  ctx.setTransform(canvasDPR, 0, 0, canvasDPR, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  for (const stroke of state.drawing.strokes) renderStroke(ctx, stroke);
}

function renderStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color || '#2b2a27';
  }
  if (pts.length === 1) {
    const [x, y, p] = pts[0];
    const r = Math.max(0.5, (stroke.size || 3) * (0.5 + (p || 0.5))) / 2;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0, p0] = pts[i - 1];
    const [x1, y1, p1] = pts[i];
    const width = Math.max(0.5, (stroke.size || 3) * (0.4 + 1.1 * ((p0 + p1) / 2)));
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawLastSegment() {
  const stroke = state.drawing.currentStroke;
  if (!stroke) return;
  const pts = stroke.points;
  if (pts.length < 2) return;
  ctx.setTransform(canvasDPR, 0, 0, canvasDPR, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color || '#2b2a27';
  }
  const [x0, y0, p0] = pts[pts.length - 2];
  const [x1, y1, p1] = pts[pts.length - 1];
  ctx.lineWidth = Math.max(0.5, (stroke.size || 3) * (0.4 + 1.1 * ((p0 + p1) / 2)));
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

function undoStroke() { state.drawing.strokes.pop(); redrawCanvas(); }

function drawStrokesOn(canvas, strokes, srcW, srcH) {
  const w = canvas.width, h = canvas.height;
  const c = canvas.getContext('2d');
  const scale = Math.min(w / srcW, h / srcH);
  const ox = (w - srcW * scale) / 2;
  const oy = (h - srcH * scale) / 2;
  c.setTransform(scale, 0, 0, scale, ox, oy);
  c.clearRect(0, 0, srcW, srcH);
  for (const s of strokes) renderStroke(c, s);
}
