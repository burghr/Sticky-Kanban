async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function relTime(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

async function load() {
  const err = document.getElementById('admin-error');
  err.hidden = true;
  try {
    const me = await api('/api/me');
    if (!me.user) { window.location.href = '/login'; return; }
    if (!me.user.is_admin) { showError('Not authorized.'); return; }

    const { users } = await api('/api/admin/users');
    const now = Date.now();
    const stale = users.filter(u => !u.last_login_at || (now - u.last_login_at) > 90 * 86400000).length;
    document.getElementById('admin-summary').innerHTML =
      `<strong>${users.length}</strong> user${users.length === 1 ? '' : 's'} · ` +
      `<strong>${stale}</strong> inactive 90+ days`;

    const tbody = document.getElementById('admin-tbody');
    tbody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(u.username)}${u.is_admin ? ' <span class="admin-badge">admin</span>' : ''}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td title="${fmtDate(u.last_login_at)}">${relTime(u.last_login_at)}</td>
        <td>${u.board_count}</td>
        <td>${u.note_count}</td>
        <td></td>
      `;
      const cell = tr.lastElementChild;
      const resetBtn = document.createElement('button');
      resetBtn.className = 'ghost-btn';
      resetBtn.textContent = 'Reset password';
      resetBtn.addEventListener('click', async () => {
        const pw = prompt(`Set a new password for "${u.username}" (min 6 chars):`);
        if (pw == null) return;
        try {
          await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { new_password: pw } });
          alert('Password updated.');
        } catch (e) { showError(e.message); }
      });
      cell.appendChild(resetBtn);
      if (u.id !== me.user.id) {
        const btn = document.createElement('button');
        btn.className = 'danger';
        btn.textContent = 'Delete';
        btn.style.marginLeft = '6px';
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete user "${u.username}" and all their data? This cannot be undone.`)) return;
          try {
            await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
            load();
          } catch (e) { showError(e.message); }
        });
        cell.appendChild(btn);
      }
      tbody.appendChild(tr);
    });
  } catch (e) { showError(e.message); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function showError(m) {
  const err = document.getElementById('admin-error');
  err.textContent = m; err.hidden = false;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  let mode = 'local';
  try { mode = (await api('/api/me')).mode || 'local'; } catch {}
  await api('/api/logout', { method: 'POST' });
  window.location.href = mode === 'sso' ? '/outpost.goauthentik.io/sign_out' : '/';
});

load();
