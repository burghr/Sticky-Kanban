const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT || '9889', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'sticky.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lanes_user ON lanes(user_id, position);

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lane_id INTEGER NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '',
    drawing TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'yellow',
    rotation REAL NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_lane ON notes(lane_id, position);
  CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);

  CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id, position);

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'blue',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_categories_board ON categories(board_id);
`);

// Migrations: add columns when missing
function hasColumn(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}
if (!hasColumn('lanes', 'board_id')) db.exec(`ALTER TABLE lanes ADD COLUMN board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE`);
if (!hasColumn('notes', 'title'))      db.exec(`ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
if (!hasColumn('notes', 'due_date'))   db.exec(`ALTER TABLE notes ADD COLUMN due_date INTEGER`);
if (!hasColumn('notes', 'done'))       db.exec(`ALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0`);
if (!hasColumn('notes', 'category_id'))db.exec(`ALTER TABLE notes ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`);
if (!hasColumn('users', 'is_admin'))      db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
if (!hasColumn('users', 'last_login_at')) db.exec(`ALTER TABLE users ADD COLUMN last_login_at INTEGER`);

// Promote configured admin username on boot
if (process.env.ADMIN_USERNAME) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(process.env.ADMIN_USERNAME);
}

// Backfill: ensure every user has at least one board and all lanes are assigned.
(function backfillBoards() {
  const users = db.prepare('SELECT id FROM users').all();
  const insertBoard = db.prepare('INSERT INTO boards (user_id, name, position, created_at) VALUES (?, ?, 0, ?)');
  const getFirstBoard = db.prepare('SELECT id FROM boards WHERE user_id = ? ORDER BY position, id LIMIT 1');
  const hasAnyBoard = db.prepare('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?');
  const orphanLanes = db.prepare('SELECT COUNT(*) AS n FROM lanes WHERE user_id = ? AND board_id IS NULL');
  const assignLanes = db.prepare('UPDATE lanes SET board_id = ? WHERE user_id = ? AND board_id IS NULL');
  const tx = db.transaction(() => {
    for (const u of users) {
      if (hasAnyBoard.get(u.id).n === 0) {
        insertBoard.run(u.id, 'My Board', Date.now());
      }
      if (orphanLanes.get(u.id).n > 0) {
        const b = getFirstBoard.get(u.id);
        if (b) assignLanes.run(b.id, u.id);
      }
    }
  });
  tx();
})();

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(session({
  name: 'sticky.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

// --- helpers ---
const now = () => Date.now();
const DEFAULT_LANES = ['To Do', 'Doing', 'Done'];
const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
const CATEGORY_COLORS = ['red','orange','yellow','green','blue','purple','pink','teal','gray'];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
const randomRotation = () => (Math.random() * 6 - 3); // -3deg .. +3deg

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not authenticated' });
  next();
}

function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 200;
}

// --- auth routes ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3-32 chars (letters, numbers, . _ -).' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username taken.' });

  const hash = bcrypt.hashSync(password, 10);
  const ts = now();
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
  const insertBoard = db.prepare('INSERT INTO boards (user_id, name, position, created_at) VALUES (?, ?, 0, ?)');
  const insertLane = db.prepare('INSERT INTO lanes (user_id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)');

  const tx = db.transaction(() => {
    const { lastInsertRowid: userId } = insertUser.run(username, hash, ts);
    const { lastInsertRowid: boardId } = insertBoard.run(userId, 'My Board', ts);
    DEFAULT_LANES.forEach((name, i) => insertLane.run(userId, boardId, name, i, ts));
    return userId;
  });
  const userId = tx();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(ts, userId);

  req.session.userId = userId;
  req.session.username = username;
  res.json({ id: userId, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing credentials.' });
  }
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const u = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!u) return res.json({ user: null });
  res.json({ user: { id: u.id, username: u.username, is_admin: !!u.is_admin } });
});


// --- password change (self) ---
app.post('/api/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!validPassword(new_password)) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  if (!u || !bcrypt.compareSync(String(current_password || ''), u.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.session.userId);
  res.json({ ok: true });
});

// --- boards ---
function getUserBoards(uid) {
  return db.prepare('SELECT id, name, position FROM boards WHERE user_id = ? ORDER BY position ASC, id ASC').all(uid);
}
function resolveBoardId(uid, idParam) {
  const id = parseInt(idParam, 10);
  if (Number.isFinite(id)) {
    const b = db.prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?').get(id, uid);
    if (b) return b.id;
  }
  const first = db.prepare('SELECT id FROM boards WHERE user_id = ? ORDER BY position, id LIMIT 1').get(uid);
  return first?.id || null;
}

app.get('/api/boards', requireAuth, (req, res) => {
  res.json({ boards: getUserBoards(req.session.userId) });
});

app.post('/api/boards', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Board name required.' });
  const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM boards WHERE user_id = ?').get(uid);
  const position = (row?.m ?? -1) + 1;
  const ts = now();
  const insertBoard = db.prepare('INSERT INTO boards (user_id, name, position, created_at) VALUES (?, ?, ?, ?)');
  const insertLane = db.prepare('INSERT INTO lanes (user_id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    const { lastInsertRowid: boardId } = insertBoard.run(uid, name, position, ts);
    DEFAULT_LANES.forEach((lname, i) => insertLane.run(uid, boardId, lname, i, ts));
    return boardId;
  });
  const id = tx();
  res.json({ id, name, position });
});

app.patch('/api/boards/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const b = db.prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?').get(id, uid);
  if (!b) return res.status(404).json({ error: 'Board not found.' });
  const name = req.body?.name != null ? String(req.body.name).trim().slice(0, 80) : null;
  if (name !== null && !name) return res.status(400).json({ error: 'Board name required.' });
  if (name !== null) db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, id);
  res.json({ ok: true });
});

app.delete('/api/boards/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const b = db.prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?').get(id, uid);
  if (!b) return res.status(404).json({ error: 'Board not found.' });
  const count = db.prepare('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?').get(uid).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last board.' });
  db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- board contents ---
app.get('/api/board', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const boardId = resolveBoardId(uid, req.query.id);
  if (!boardId) return res.status(404).json({ error: 'No board.' });
  const board = db.prepare('SELECT id, name, position FROM boards WHERE id = ?').get(boardId);
  const lanes = db.prepare('SELECT id, board_id, name, position FROM lanes WHERE user_id = ? AND board_id = ? ORDER BY position ASC, id ASC').all(uid, boardId);
  const laneIds = lanes.map(l => l.id);
  const notes = laneIds.length
    ? db.prepare(`SELECT id, lane_id, title, text, drawing, color, rotation, position, updated_at, due_date, done, category_id
                  FROM notes WHERE user_id = ? AND lane_id IN (${laneIds.map(() => '?').join(',')})
                  ORDER BY position ASC, id ASC`).all(uid, ...laneIds)
    : [];
  const categories = db.prepare('SELECT id, name, color FROM categories WHERE board_id = ? ORDER BY name').all(boardId);
  res.json({ board, lanes, notes, categories });
});

// --- categories ---
app.post('/api/categories', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const boardId = resolveBoardId(uid, req.body?.board_id);
  if (!boardId) return res.status(400).json({ error: 'Invalid board.' });
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Category name required.' });
  const color = CATEGORY_COLORS.includes(req.body?.color) ? req.body.color : 'blue';
  const info = db.prepare('INSERT INTO categories (user_id, board_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, boardId, name, color, now());
  res.json({ id: info.lastInsertRowid, name, color });
});

app.patch('/api/categories/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(id, uid);
  if (!c) return res.status(404).json({ error: 'Category not found.' });
  const fields = [], values = [];
  if (req.body?.name != null) {
    const n = String(req.body.name).trim().slice(0, 40);
    if (!n) return res.status(400).json({ error: 'Category name required.' });
    fields.push('name = ?'); values.push(n);
  }
  if (req.body?.color != null && CATEGORY_COLORS.includes(req.body.color)) {
    fields.push('color = ?'); values.push(req.body.color);
  }
  if (!fields.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(id, uid);
  if (!c) return res.status(404).json({ error: 'Category not found.' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- lanes ---
app.post('/api/lanes', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const boardId = resolveBoardId(uid, req.body?.board_id);
  if (!boardId) return res.status(400).json({ error: 'Invalid board.' });
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Lane name required.' });
  const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM lanes WHERE user_id = ? AND board_id = ?').get(uid, boardId);
  const position = (row?.m ?? -1) + 1;
  const info = db.prepare('INSERT INTO lanes (user_id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, boardId, name, position, now());
  res.json({ id: info.lastInsertRowid, board_id: boardId, name, position });
});

app.patch('/api/lanes/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const lane = db.prepare('SELECT id FROM lanes WHERE id = ? AND user_id = ?').get(id, uid);
  if (!lane) return res.status(404).json({ error: 'Lane not found.' });
  const name = req.body?.name != null ? String(req.body.name).trim().slice(0, 80) : null;
  if (name !== null && name.length === 0) return res.status(400).json({ error: 'Lane name required.' });
  if (name !== null) db.prepare('UPDATE lanes SET name = ? WHERE id = ?').run(name, id);
  res.json({ ok: true });
});

app.delete('/api/lanes/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const lane = db.prepare('SELECT id, board_id FROM lanes WHERE id = ? AND user_id = ?').get(id, uid);
  if (!lane) return res.status(404).json({ error: 'Lane not found.' });
  const count = db.prepare('SELECT COUNT(*) AS n FROM lanes WHERE user_id = ? AND board_id = ?').get(uid, lane.board_id).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last lane in a board.' });
  db.prepare('DELETE FROM lanes WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/lanes/reorder', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
  const upd = db.prepare('UPDATE lanes SET position = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => { ids.forEach((id, i) => upd.run(i, id, uid)); });
  tx();
  res.json({ ok: true });
});

// --- notes ---
function validateCategoryForLane(uid, categoryId, laneId) {
  if (categoryId == null) return null; // allowed (no category)
  const cid = parseInt(categoryId, 10);
  if (!Number.isFinite(cid)) return 'invalid';
  const cat = db.prepare('SELECT c.id FROM categories c JOIN lanes l ON l.board_id = c.board_id WHERE c.id = ? AND l.id = ? AND c.user_id = ?').get(cid, laneId, uid);
  return cat ? cid : 'invalid';
}

app.post('/api/notes', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const laneId = parseInt(req.body?.lane_id, 10);
  const lane = db.prepare('SELECT id FROM lanes WHERE id = ? AND user_id = ?').get(laneId, uid);
  if (!lane) return res.status(400).json({ error: 'Invalid lane.' });
  const title = String(req.body?.title || '').slice(0, 120);
  const text = String(req.body?.text || '').slice(0, 5000);
  const drawing = typeof req.body?.drawing === 'string' ? req.body.drawing.slice(0, 2_000_000) : '';
  const color = COLORS.includes(req.body?.color) ? req.body.color : randomColor();
  const rotation = Number.isFinite(req.body?.rotation) ? Math.max(-8, Math.min(8, req.body.rotation)) : randomRotation();
  const due_date = Number.isFinite(req.body?.due_date) ? parseInt(req.body.due_date, 10) : null;
  const done = req.body?.done ? 1 : 0;
  let category_id = null;
  if (req.body?.category_id != null) {
    const v = validateCategoryForLane(uid, req.body.category_id, laneId);
    if (v === 'invalid') return res.status(400).json({ error: 'Invalid category.' });
    category_id = v;
  }
  const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM notes WHERE lane_id = ? AND user_id = ?').get(laneId, uid);
  const position = (row?.m ?? -1) + 1;
  const ts = now();
  const info = db.prepare(`INSERT INTO notes (user_id, lane_id, title, text, drawing, color, rotation, position, updated_at, due_date, done, category_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid, laneId, title, text, drawing, color, rotation, position, ts, due_date, done, category_id);
  res.json({
    id: info.lastInsertRowid, lane_id: laneId, title, text, drawing, color, rotation, position,
    updated_at: ts, due_date, done, category_id
  });
});

app.patch('/api/notes/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const note = db.prepare('SELECT id, lane_id FROM notes WHERE id = ? AND user_id = ?').get(id, uid);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  const fields = [];
  const values = [];
  if (req.body?.title != null) { fields.push('title = ?'); values.push(String(req.body.title).slice(0, 120)); }
  if (req.body?.text != null) { fields.push('text = ?'); values.push(String(req.body.text).slice(0, 5000)); }
  if (req.body?.drawing != null) { fields.push('drawing = ?'); values.push(String(req.body.drawing).slice(0, 2_000_000)); }
  if (req.body?.color != null && COLORS.includes(req.body.color)) { fields.push('color = ?'); values.push(req.body.color); }
  if (Number.isFinite(req.body?.rotation)) { fields.push('rotation = ?'); values.push(Math.max(-8, Math.min(8, req.body.rotation))); }
  let targetLane = note.lane_id;
  if (req.body?.lane_id != null) {
    const lid = parseInt(req.body.lane_id, 10);
    const lane = db.prepare('SELECT id FROM lanes WHERE id = ? AND user_id = ?').get(lid, uid);
    if (!lane) return res.status(400).json({ error: 'Invalid lane.' });
    fields.push('lane_id = ?'); values.push(lid);
    targetLane = lid;
  }
  if (Number.isFinite(req.body?.position)) { fields.push('position = ?'); values.push(parseInt(req.body.position, 10)); }
  if ('due_date' in (req.body || {})) {
    const d = req.body.due_date;
    if (d === null) { fields.push('due_date = ?'); values.push(null); }
    else if (Number.isFinite(d)) { fields.push('due_date = ?'); values.push(parseInt(d, 10)); }
  }
  if ('done' in (req.body || {})) { fields.push('done = ?'); values.push(req.body.done ? 1 : 0); }
  if ('category_id' in (req.body || {})) {
    if (req.body.category_id === null) { fields.push('category_id = ?'); values.push(null); }
    else {
      const v = validateCategoryForLane(uid, req.body.category_id, targetLane);
      if (v === 'invalid') return res.status(400).json({ error: 'Invalid category.' });
      fields.push('category_id = ?'); values.push(v);
    }
  }
  fields.push('updated_at = ?'); values.push(now());
  values.push(id);
  db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const id = parseInt(req.params.id, 10);
  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').get(id, uid);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/notes/reorder', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const laneId = parseInt(req.body?.lane_id, 10);
  const lane = db.prepare('SELECT id FROM lanes WHERE id = ? AND user_id = ?').get(laneId, uid);
  if (!lane) return res.status(400).json({ error: 'Invalid lane.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
  const upd = db.prepare('UPDATE notes SET lane_id = ?, position = ?, updated_at = ? WHERE id = ? AND user_id = ?');
  const ts = now();
  const tx = db.transaction(() => { ids.forEach((id, i) => upd.run(laneId, i, ts, id, uid)); });
  tx();
  res.json({ ok: true });
});

// --- admin ---
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not authenticated' });
  const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!u?.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.created_at, u.last_login_at, u.is_admin,
      (SELECT COUNT(*) FROM boards b WHERE b.user_id = u.id) AS board_count,
      (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id) AS note_count
    FROM users u ORDER BY u.username COLLATE NOCASE
  `).all();
  res.json({ users });
});

app.post('/api/admin/users/:id/password', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { new_password } = req.body || {};
  if (!validPassword(new_password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
  if (id === req.session.userId) return res.status(400).json({ error: 'Cannot delete yourself.' });
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- static ---
app.use(express.static(path.join(__dirname, 'public')));

// Root redirect: send to login or app based on session
app.get('/', (req, res) => {
  if (req.session.userId) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/admin', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.listen(PORT, () => {
  console.log(`sticky-kanban listening on :${PORT} (data: ${DATA_DIR})`);
});
