// Apply theme class to body (CSS rule covers both html[data-theme=dark] and body.dark).
try { if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark'); } catch {}

const tabs = document.querySelectorAll('.tab');
const forms = {
  login: document.getElementById('login-form'),
  register: document.getElementById('register-form')
};
const errors = {
  login: document.getElementById('login-error'),
  register: document.getElementById('register-error')
};

tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.toggle('active', x === t));
  const key = t.dataset.tab;
  Object.entries(forms).forEach(([k, f]) => f.classList.toggle('active', k === key));
  Object.values(errors).forEach(e => e.hidden = true);
}));

function showError(which, msg) {
  const el = errors[which];
  el.textContent = msg;
  el.hidden = false;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

forms.login.addEventListener('submit', async e => {
  e.preventDefault();
  errors.login.hidden = true;
  const fd = new FormData(forms.login);
  try {
    await post('/api/login', { username: fd.get('username'), password: fd.get('password') });
    location.href = '/';
  } catch (err) { showError('login', err.message); }
});

forms.register.addEventListener('submit', async e => {
  e.preventDefault();
  errors.register.hidden = true;
  const fd = new FormData(forms.register);
  const p1 = fd.get('password'), p2 = fd.get('password2');
  if (p1 !== p2) return showError('register', 'Passwords do not match.');
  try {
    await post('/api/register', { username: fd.get('username'), password: p1 });
    location.href = '/';
  } catch (err) { showError('register', err.message); }
});
