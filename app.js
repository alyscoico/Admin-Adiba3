import { firebaseConfig, DOMAIN } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, deleteField
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Gaya tambahan untuk fitur keuangan dan arisan (file fitur.css di folder yang sama)
(function () { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'fitur.css'; document.head.append(l); })();

const $ = (s) => document.querySelector(s);
const STATUS = { dihuni: 'Dihuni pemilik', kontrak: 'Dikontrakkan', kosong: 'Kosong' };
const KAT_PENG = { info: 'Info', penting: 'Penting', darurat: 'Darurat' };
const KAT_AG = { rapat: 'Rapat', kegiatan: 'Kegiatan', lainnya: 'Lainnya' };
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const VIEWS = [
  { id: 'rumah', label: 'Warga', icon: 'users' },
  { id: 'info', label: 'Info', icon: 'bell' },
  { id: 'keuangan', label: 'Keuangan', icon: 'coin' },
  { id: 'arisan', label: 'Arisan', icon: 'cycle' },
  { id: 'akun', label: 'Akun', icon: 'key' }
];
const ICONS = {
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2c2.3.6 3.5 2.4 3.5 5.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M9 9.5c0-1.1 1.3-2 3-2s3 .9 3 2-1.3 2-3 2-3 .9-3 2 1.3 2 3 2 3-.9 3-2M12 6v1.5M12 16.5V18"/>',
  cycle: '<path d="M20 11a8 8 0 0 0-14-4M4 13a8 8 0 0 0 14 4"/><path d="M5 3v4h4M19 21v-4h-4"/>'
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
let secApp = null;

let profile = null, unsubs = [], shell = false, menuOpen = false, view = 'rumah';
const COLS = ['rumah', 'users', 'pengumuman', 'agenda', 'iuran', 'pbb', 'pbbTahun', 'arisan', 'ringkasan'];
const data = { rumah: [], users: [], pengumuman: [], agenda: [], iuran: [], pbb: [], pbbTahun: [], arisan: [], ringkasan: [], pengIuran: null };
const ready = { pengIuran: false }, err = { pengIuran: null };
COLS.forEach((k) => { ready[k] = false; err[k] = null; });
const filt = { q: '', blok: '', status: '' };
const info = { tab: 'pengumuman' };
const nowD = new Date();
const keu = { tab: 'iuran', bulan: nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0'), filter: 'semua', q: '', tahun: String(nowD.getFullYear()) };

/* ---------- Util ---------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name];
  return s;
}
let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }
const mount = (...nodes) => { const a = $('#app'); a.textContent = ''; a.append(...nodes); };
const clean = (s) => String(s || '').replace(/[^A-Za-z0-9_.~:@+-]/g, '');
const normStatus = (s) => { s = String(s || '').toLowerCase(); return s.includes('kontrak') ? 'kontrak' : s.includes('kosong') ? 'kosong' : 'dihuni'; };
const normHouse = (d) => ({ id: d.id, blok: String(d.blok || ''), nomor: String(d.nomor || ''), kepala: d.kepala || '', telepon: d.telepon || '',
  jumlah: Number(d.jumlah) || 0, status: normStatus(d.status), jabatan: d.jabatan || '', catatan: d.catatan || '' });
const sortedHouses = (list) => list.slice().sort((a, b) => a.blok.localeCompare(b.blok, 'id') || a.nomor.localeCompare(b.nomor, 'id', { numeric: true }));
const houses = () => data.rumah.map(normHouse);
const rumahLabel = (id) => { const r = houses().find((x) => x.id === id); return r ? r.blok + '-' + r.nomor : ''; };
const isAdmin = () => profile && profile.role === 'admin';
const toInt = (s) => parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ''), 10) || 0;
const rp = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ymNow = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const bkey = (ym) => 'b' + ym.replace('-', '_');
const ykey = (y) => 'y' + y;
const ymLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return BULAN_PANJANG[m - 1] + ' ' + y; };
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const fmtDate = (s) => { const d = parseD(s); return isNaN(d) ? '' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); };
function parseD(s) { s = String(s || ''); return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s); }
function daysAgo(s) {
  const d = parseD(s); if (isNaN(d)) return null;
  const t = new Date();
  return Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
}
function rel(s) {
  const n = daysAgo(s); if (n === null) return '';
  if (n === 0) return 'Hari ini'; if (n === 1) return 'Kemarin'; if (n > 1 && n < 7) return n + ' hari lalu';
  return fmtDate(s);
}

function fbError(e) {
  const c = (e && e.code) || '';
  if (c === 'permission-denied') return 'Akun ini tidak punya izin untuk tindakan ini. Pastikan aturan keamanan terbaru sudah dipasang.';
  if (c === 'auth/email-already-in-use') return 'Username sudah dipakai. Pilih username lain.';
  if (c === 'auth/weak-password') return 'Password terlalu pendek. Pakai minimal 6 karakter.';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-email') return 'Username atau password salah.';
  if (c === 'auth/too-many-requests') return 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.';
  if (c === 'auth/network-request-failed' || c === 'unavailable') return 'Tidak ada koneksi internet. Coba lagi setelah tersambung.';
  return 'Terjadi kesalahan (' + (c || 'tidak dikenal') + '). Coba lagi.';
}
const userErr = (m) => Object.assign(new Error(m), { userMessage: m });
function loadErr(code) {
  return code === 'permission-denied'
    ? 'Data belum bisa dibuka. Pasang aturan keamanan dari firestore.rules di Firebase Console > Firestore > Rules. (permission-denied)'
    : 'Data tidak bisa dimuat. Periksa koneksi lalu muat ulang halaman. (' + code + ')';
}
const stable = (o) => Array.isArray(o) ? '[' + o.map(stable).join(',') + ']'
  : o && typeof o === 'object' ? '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}' : JSON.stringify(o);

/* ---------- Dialog formulir ---------- */
function openModal({ title, fields, submit = 'Simpan', onSubmit, extra, intro }) {
  const msg = h('div', { class: 'msg', role: 'status' });
  const inputs = {};
  const els = fields.map((f) => {
    let input;
    if (f.type === 'select') {
      input = h('select', { class: 'field', id: 'm-' + f.name }, f.options.map(([v, l]) => h('option', { value: v }, l)));
      input.value = f.value ?? f.options[0][0];
    } else if (f.type === 'textarea') {
      input = h('textarea', { class: 'field', id: 'm-' + f.name, maxlength: f.maxlength || 500, placeholder: f.placeholder, required: f.required });
      input.value = f.value || '';
    } else {
      input = h('input', { class: 'field', id: 'm-' + f.name, type: f.type || 'text', maxlength: f.maxlength, placeholder: f.placeholder,
        autocomplete: f.type === 'password' ? 'new-password' : 'off', autocapitalize: f.name === 'username' ? 'none' : null, inputmode: f.inputmode,
        min: f.min, max: f.max, required: f.required, readonly: f.readonly });
      input.value = f.value ?? '';
    }
    if (f.disabled) input.disabled = true;
    inputs[f.name] = input;
    return h('label', { class: 'f' + (f.full ? ' full' : ''), for: 'm-' + f.name }, f.label, f.hint ? h('span', { class: 'hint' }, f.hint) : null, input);
  });
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, submit);
  const close = () => ov.remove();
  const form = h('form', { class: 'panel', autocomplete: 'off' },
    h('h2', null, title),
    intro ? h('p', { class: 'sub', style: 'margin:0' }, intro) : null,
    h('div', { class: 'fieldgrid' }, els),
    msg,
    h('div', { class: 'form-actions' }, saveBtn, h('button', { class: 'btn', type: 'button', onclick: close }, 'Batal'), extra ? extra(close) : null));
  const ov = h('div', { class: 'overlay' }, form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const values = {};
    for (const k in inputs) values[k] = inputs[k].value;
    saveBtn.disabled = true; msg.className = 'msg'; msg.textContent = 'Menyimpan…';
    try { await onSubmit(values); close(); }
    catch (e) { msg.className = 'msg err'; msg.textContent = e.userMessage || fbError(e); saveBtn.disabled = false; }
  });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(ov);
  const first = Object.values(inputs).find((i) => !i.readOnly && !i.disabled);
  if (first) first.focus();
}
function deleteButton(label, run) {
  let armed = false;
  const b = h('button', { class: 'btn danger', type: 'button', style: 'margin-left:auto' }, label);
  b.addEventListener('click', async () => {
    if (!armed) { armed = true; b.textContent = 'Yakin hapus? Ketuk lagi'; return; }
    b.disabled = true;
    try { await run(); } catch (e) { toast(fbError(e)); b.disabled = false; armed = false; b.textContent = label; }
  });
  return b;
}
const monthOptions = () => BULAN_PANJANG.map((n, i) => [pad(i + 1), n]);
const seg = (items, cur, pick) => h('div', { class: 'chips', role: 'group' },
  items.map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(cur === v), onclick: () => { pick(v); renderPage(); } }, l)));
const stepper = (label, prev, next) => h('div', { class: 'stepper' },
  h('button', { class: 'btn small', type: 'button', 'aria-label': 'Sebelumnya', onclick: () => { prev(); renderPage(); } }, '‹'),
  h('strong', null, label),
  h('button', { class: 'btn small', type: 'button', 'aria-label': 'Berikutnya', onclick: () => { next(); renderPage(); } }, '›'));
const meter = (pct) => h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: 'width:' + pct + '%' }));
const sumItem = (n, l, good) => h('div', null, h('div', { class: 'n' + (good ? ' good' : '') }, n), h('div', { class: 'l' }, l));

/* ---------- Masuk ---------- */
function showLogin() {
  shell = false;
  const msg = h('div', { class: 'msg', role: 'status' });
  const u = h('input', { class: 'field', id: 'l-user', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
  const p = h('input', { class: 'field', id: 'l-pass', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Masuk');
  const form = h('form', { class: 'login' },
    h('div', { class: 'hero' }, h('img', { class: 'logo logo-lg', src: 'logo.png', alt: 'Logo Warga ADIBA 3', width: '96', height: '96' }), h('h1', { style: 'margin-top:10px' }, 'Admin Paguyuban ADIBA 3'),
      h('div', { class: 'sub' }, 'Masuk dengan akun admin.')),
    h('label', { class: 'f', for: 'l-user' }, 'Username', u),
    h('label', { class: 'f', for: 'l-pass' }, 'Password', p),
    msg, btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Masuk…';
    try { await signInWithEmailAndPassword(auth, u.value.trim().toLowerCase() + '@' + DOMAIN, p.value); }
    catch (e) { msg.className = 'msg err'; msg.textContent = fbError(e); btn.disabled = false; }
  });
  mount(h('div', { class: 'login-wrap' }, form));
  u.focus();
}
function showBlocked(text) {
  shell = false;
  mount(h('div', { class: 'login-wrap' }, h('div', { class: 'login' }, h('h1', null, 'Admin Paguyuban ADIBA 3'), h('div', { class: 'note err' }, text),
    h('button', { class: 'btn', type: 'button', onclick: () => signOut(auth) }, 'Keluar'))));
}

/* ---------- Data ---------- */
function stopAll() {
  unsubs.forEach((f) => f()); unsubs = [];
  COLS.forEach((k) => { data[k] = []; ready[k] = false; err[k] = null; });
  data.pengIuran = null; ready.pengIuran = false; err.pengIuran = null;
}
function subscribe(name) {
  unsubs.push(onSnapshot(collection(db, name), (snap) => {
    data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ready[name] = true; err[name] = null; renderPage();
  }, (e) => { ready[name] = true; err[name] = (e && e.code) || 'error'; renderPage(); }));
}
function subscribePengaturan() {
  unsubs.push(onSnapshot(doc(db, 'pengaturan', 'iuran'), (snap) => {
    data.pengIuran = snap.exists() ? snap.data() : null; ready.pengIuran = true; err.pengIuran = null; renderPage();
  }, (e) => { ready.pengIuran = true; err.pengIuran = (e && e.code) || 'error'; renderPage(); }));
}

onAuthStateChanged(auth, (user) => {
  stopAll(); profile = null; shell = false;
  if (!user) { showLogin(); return; }
  mount(h('div', { class: 'login-wrap' }, h('div', { class: 'note' }, 'Memuat data…')));
  let started = false;
  unsubs.push(onSnapshot(doc(db, 'users', user.uid), (snap) => {
    if (!snap.exists()) { showBlocked('Akun ini belum terdaftar di paguyuban. Hubungi admin.'); return; }
    profile = { uid: user.uid, ...snap.data() };
    if (!profile.aktif) { showBlocked('Akun ini dinonaktifkan. Hubungi admin.'); return; }
    if (!isAdmin()) { showBlocked('Aplikasi ini khusus admin. Warga membuka aplikasi warga.'); return; }
    if (!started) { started = true; COLS.forEach(subscribe); subscribePengaturan(); }
    renderPage();
  }, (e) => showBlocked(loadErr((e && e.code) || 'error'))));
});

/* ---------- Kerangka ---------- */
function buildShell() {
  shell = true;
  const name = profile.nama || profile.username || '';
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true },
    h('div', { class: 'who' }, h('div', { class: 'nama' }, name), h('div', { class: 'sub' }, '@' + (profile.username || '') + ' · Admin')),
    h('button', { type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); openPassword(); } }, 'Ganti password'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => signOut(auth) }, 'Keluar'));
  const avatar = h('button', { class: 'avatar', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Menu akun', id: 'avatar',
    onclick: (e) => { e.stopPropagation(); toggleMenu(!menuOpen); } }, (name.trim()[0] || '?').toUpperCase());
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu utama' },
    VIEWS.map((v) => h('a', { href: '#' + v.id, 'data-v': v.id }, icon(v.icon), h('span', null, v.label))));
  mount(
    h('header', { class: 'bar' }, h('div', { class: 'bar-in' },
      h('div', { class: 'brand' }, h('img', { class: 'logo', src: 'logo.png', alt: 'Logo Warga ADIBA 3', width: '44', height: '44' }), h('div', { class: 'brand-text' }, h('div', { class: 'eyebrow' }, 'Admin'), h('b', null, 'ADIBA 3'), h('div', { class: 'addr' }, 'Kelurahan Jungke, Kecamatan Karanganyar, Kabupaten Karanganyar'), h('a', { class: 'maplink', href: 'https://maps.app.goo.gl/vCXrAwGvA3D9S2md8', target: '_blank', rel: 'noopener' }, 'Buka lokasi di Google Maps'))),
      nav, h('div', { class: 'acct' }, avatar, menu))),
    h('main', { class: 'page', id: 'main' }));
}
function toggleMenu(open) {
  menuOpen = open;
  const m = $('.menu'), a = $('#avatar');
  if (m) m.hidden = !open;
  if (a) a.setAttribute('aria-expanded', String(open));
}
document.addEventListener('click', (e) => { if (menuOpen && !e.target.closest('.acct')) toggleMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) toggleMenu(false); });
function syncRoute() {
  const id = location.hash.replace('#', '');
  if (id === 'pengumuman' || id === 'agenda') { info.tab = id; view = 'info'; return; }
  view = VIEWS.some((v) => v.id === id) ? id : 'rumah';
}
window.addEventListener('hashchange', () => { syncRoute(); window.scrollTo(0, 0); renderPage(); });
syncRoute();

function renderPage() {
  if (!profile || !profile.aktif || !isAdmin()) return;
  if (!shell) buildShell();
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.v === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const active = document.activeElement;
  const keep = active && active.id === 'q';
  const caret = keep ? active.selectionStart : 0;
  const main = $('#main');
  main.textContent = '';
  main.append(view === 'akun' ? akunView() : view === 'info' ? infoView() : view === 'keuangan' ? keuanganView() : view === 'arisan' ? arisanView() : rumahView());
  if (keep) { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(caret, caret); } }
  scheduleSync();
}
function state(name, emptyTitle, emptyText) {
  if (err[name]) return h('div', { class: 'note err' }, loadErr(err[name]));
  if (!ready[name]) return h('div', { class: 'note' }, 'Memuat…');
  return h('div', { class: 'card empty' }, h('h2', null, emptyTitle), h('p', null, emptyText));
}

/* ========== WARGA (data rumah) ========== */
function rumahView() {
  const hs = houses();
  const withAcc = new Set(data.users.filter((a) => a.aktif && a.rumahId).map((a) => a.rumahId));
  let jiwa = 0; hs.forEach((x) => { jiwa += x.jumlah; });
  const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const bloks = [...new Set(hs.map((x) => x.blok))].sort((a, b) => a.localeCompare(b, 'id'));
  const q = h('input', { class: 'field', id: 'q', type: 'search', placeholder: 'Cari nama, blok, atau telepon', 'aria-label': 'Cari warga', enterkeyhint: 'search' });
  q.value = filt.q;
  q.addEventListener('input', () => { filt.q = q.value; renderPage(); });
  const fb = h('select', { class: 'field', 'aria-label': 'Filter blok', onchange: (e) => { filt.blok = e.target.value; renderPage(); } },
    h('option', { value: '' }, 'Semua blok'), bloks.map((b) => h('option', { value: b }, 'Blok ' + b)));
  fb.value = bloks.includes(filt.blok) ? filt.blok : '';
  const fs = h('select', { class: 'field', 'aria-label': 'Filter status', onchange: (e) => { filt.status = e.target.value; renderPage(); } },
    h('option', { value: '' }, 'Semua status'), Object.entries(STATUS).map(([v, l]) => h('option', { value: v }, l)));
  fs.value = filt.status;
  const needle = filt.q.trim().toLowerCase();
  const all = sortedHouses(hs);
  const shown = all.filter((x) => {
    if (filt.blok && x.blok !== filt.blok) return false;
    if (filt.status && x.status !== filt.status) return false;
    if (!needle) return true;
    return [x.blok + '-' + x.nomor, x.blok + ' ' + x.nomor, x.kepala, x.telepon, x.jabatan, x.catatan].join(' ').toLowerCase().includes(needle);
  });
  const card = (x) => {
    const akun = data.users.filter((a) => a.rumahId === x.id);
    return h('article', { class: 'card house' },
      h('span', { class: 'plate' }, x.blok + '-' + x.nomor),
      h('div', { class: 'nama' }, x.kepala || 'Belum diisi'),
      h('div', { class: 'line' }, h('span', { class: 'pill ' + x.status }, STATUS[x.status]), x.jumlah ? h('span', { class: 'sub' }, x.jumlah + ' jiwa') : null, x.jabatan ? h('span', { class: 'sub' }, x.jabatan) : null),
      h('div', { class: 'line' }, x.telepon ? h('span', { class: 'mono' }, x.telepon) : h('span', { class: 'sub' }, 'Tanpa nomor telepon'),
        akun.length ? h('span', { class: 'sub' }, 'Login: ' + akun.map((a) => a.username).join(', ')) : h('span', { class: 'sub' }, 'Belum punya akun')),
      x.catatan ? h('div', { class: 'sub', style: 'grid-column:2' }, x.catatan) : null,
      h('div', { class: 'card-act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openHouse(x) }, 'Ubah')));
  };
  return h('div', { style: 'display:contents' },
    h('h1', null, 'Data warga'),
    ready.rumah && !err.rumah ? h('section', { class: 'card stats', 'aria-label': 'Ringkasan' }, stat(hs.length, 'Rumah terdata'), stat(hs.filter((x) => withAcc.has(x.id)).length, 'Punya akun'), stat(jiwa, 'Jiwa tercatat')) : null,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => openHouse(null) }, 'Tambah anggota'),
      h('button', { class: 'btn', type: 'button', onclick: openImport }, 'Impor daftar'),
      h('button', { class: 'btn', type: 'button', onclick: exportCsv, disabled: !all.length }, 'Unduh CSV')),
    h('div', { class: 'tools' }, q, h('div', { class: 'row2' }, fb, fs)),
    err.rumah || !ready.rumah ? state('rumah', '', '')
      : all.length ? h('div', { class: 'stack' }, h('div', { class: 'sub' }, 'Menampilkan ' + shown.length + ' dari ' + all.length + ' rumah'),
          shown.length ? h('div', { class: 'grid-houses stack' }, shown.map(card)) : h('div', { class: 'note' }, 'Tidak ada rumah yang cocok dengan pencarian.'))
      : state('rumah', 'Belum ada data warga', 'Ketuk Tambah anggota, atau tempel daftar dari Excel lewat Impor daftar.'));
}

function openHouse(x) {
  const fields = [
    { name: 'blok', label: 'Blok', value: x ? x.blok : filt.blok, maxlength: 8, required: true, readonly: !!x, placeholder: 'mis. A' },
    { name: 'nomor', label: 'Nomor rumah', value: x ? x.nomor : '', maxlength: 8, required: true, readonly: !!x, placeholder: 'mis. 12' },
    { name: 'kepala', label: 'Kepala keluarga', value: x ? x.kepala : '', maxlength: 80, full: true },
    { name: 'telepon', label: 'Telepon / WhatsApp', value: x ? x.telepon : '', maxlength: 20, inputmode: 'tel' },
    { name: 'jumlah', label: 'Jumlah penghuni', type: 'number', min: 0, max: 30, value: x ? x.jumlah : 0, inputmode: 'numeric' },
    { name: 'status', label: 'Status rumah', type: 'select', options: Object.entries(STATUS), value: x ? x.status : 'dihuni' },
    { name: 'jabatan', label: 'Jabatan di paguyuban', hint: 'Boleh kosong', value: x ? x.jabatan : '', maxlength: 40 },
    { name: 'catatan', label: 'Catatan', hint: 'Boleh kosong', type: 'textarea', value: x ? x.catatan : '', maxlength: 200, full: true }
  ].concat(x ? [] : [
    { name: 'username', label: 'Username login anggota', hint: 'Boleh kosong, bisa dibuat nanti di tab Akun', maxlength: 20, placeholder: 'mis. budi.a12' },
    { name: 'password', label: 'Password awal', hint: 'Minimal 6 karakter', type: 'password', maxlength: 60 }
  ]);
  openModal({
    title: x ? 'Ubah rumah ' + x.blok + '-' + x.nomor : 'Tambah anggota',
    fields,
    onSubmit: async (v) => {
      const blok = clean(v.blok).toUpperCase(), nomor = clean(v.nomor).toUpperCase();
      if (!blok || !nomor) throw userErr('Isi blok dan nomor rumah. Hanya huruf, angka, dan tanda hubung.');
      const id = blok + '-' + nomor;
      if (!x && houses().some((r) => r.id === id)) throw userErr('Rumah ' + id + ' sudah ada. Gunakan Ubah pada daftar.');
      const j = parseInt(v.jumlah, 10);
      const uname = (v.username || '').trim().toLowerCase();
      if (!x && uname) {
        checkLogin(uname, v.password);
        await createLogin({ username: uname, password: v.password, nama: v.kepala.trim() || uname, role: 'warga', rumahId: id });
      }
      await setDoc(doc(db, 'rumah', id), {
        blok, nomor, kepala: v.kepala.trim(), telepon: v.telepon.trim(), jumlah: isNaN(j) ? 0 : Math.max(0, Math.min(30, j)),
        status: normStatus(v.status), jabatan: v.jabatan.trim(), catatan: v.catatan.trim(), diubah: new Date().toISOString() });
      toast('Rumah ' + id + ' tersimpan' + (uname && !x ? ' dan akun ' + uname + ' dibuat' : ''));
    },
    extra: x ? (close) => {
      const linked = data.users.filter((a) => a.rumahId === x.id && a.id !== profile.uid);
      return deleteButton('Hapus anggota' + (linked.length ? ' dan ' + linked.length + ' akun' : ''), async () => {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'rumah', x.id));
        batch.delete(doc(db, 'iuran', x.id));
        batch.delete(doc(db, 'pbb', x.id));
        linked.forEach((a) => batch.delete(doc(db, 'users', a.id)));
        await batch.commit();
        close(); toast('Anggota dihapus');
      });
    } : null
  });
}

function parseImport(text) {
  const rows = []; let bad = 0; const seen = new Set();
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const p = line.split(sep).map((s) => s.trim());
    const blok = clean(p[0]).toUpperCase(), nomor = clean(p[1]).toUpperCase(), id = blok + '-' + nomor;
    if (!blok || !nomor || seen.has(id)) { bad++; return; }
    seen.add(id);
    const j = parseInt(p[4], 10);
    rows.push({ id, blok, nomor, kepala: p[2] || '', telepon: p[3] || '', jumlah: isNaN(j) ? 0 : Math.max(0, Math.min(30, j)), status: normStatus(p[5]), jabatan: '', catatan: '', diubah: new Date().toISOString() });
  });
  return { rows, bad };
}
function openImport() {
  openModal({
    title: 'Impor daftar warga', submit: 'Impor',
    fields: [{ name: 'teks', label: 'Satu rumah per baris', full: true, hint: 'Urutan: blok, nomor, kepala keluarga, telepon, jumlah penghuni, status. Pisahkan dengan koma, titik koma, atau tab. Rumah yang sudah ada dilewati.', type: 'textarea', maxlength: 60000, required: true, placeholder: 'A, 1, Nama Kepala Keluarga, 08xxxxxxxxxx, 4, dihuni' }],
    onSubmit: async (v) => {
      const r = parseImport(v.teks);
      const have = new Set(houses().map((x) => x.id));
      const todo = r.rows.filter((x) => !have.has(x.id));
      if (!todo.length) throw userErr('Tidak ada rumah baru untuk diimpor.' + (r.bad ? ' ' + r.bad + ' baris dilewati karena blok atau nomor kosong atau dobel.' : ''));
      for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        todo.slice(i, i + 400).forEach((x) => { const { id, ...rest } = x; batch.set(doc(db, 'rumah', id), rest); });
        await batch.commit();
      }
      toast(todo.length + ' rumah diimpor' + (r.bad ? ', ' + r.bad + ' baris dilewati' : ''));
    }
  });
}
function exportCsv() {
  const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const lines = [['Blok', 'Nomor', 'Kepala Keluarga', 'Telepon', 'Jumlah Penghuni', 'Status', 'Jabatan', 'Catatan'].map(cell).join(',')];
  sortedHouses(houses()).forEach((x) => lines.push([x.blok, x.nomor, x.kepala, x.telepon, x.jumlah, STATUS[x.status], x.jabatan, x.catatan].map(cell).join(',')));
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: 'warga-adiba-3.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Daftar warga diunduh');
}

/* ========== AKUN ========== */
function akunView() {
  const list = data.users.slice().sort((a, b) => (a.nama || a.username || '').localeCompare(b.nama || b.username || '', 'id'));
  const card = (a) => h('article', { class: 'card acc' },
    h('div', { class: 'acc-top' }, h('span', { class: 'nama' }, a.nama || '(tanpa nama)'), h('span', { class: 'mono' }, '@' + a.username)),
    h('div', { class: 'acc-top' },
      h('span', { class: 'pill ' + (a.aktif ? 'dihuni' : 'kosong') }, a.aktif ? 'Aktif' : 'Nonaktif'),
      h('span', { class: 'pill ' + (a.role === 'admin' ? 'penting' : 'info') }, a.role === 'admin' ? 'Admin' : 'Warga'),
      a.rumahId ? h('span', { class: 'plate' }, rumahLabel(a.rumahId) || a.rumahId) : h('span', { class: 'sub' }, 'Tidak terkait rumah')),
    h('div', { class: 'card-act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openAccount(a) }, 'Ubah')));
  return h('div', { style: 'display:contents' },
    h('h1', null, 'Akun'),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openAccount(null) }, 'Buat akun'), h('span', { class: 'sub' }, data.users.length + ' akun terdaftar')),
    err.users || !ready.users ? state('users', '', '')
      : list.length ? h('div', { class: 'grid-houses stack' }, list.map(card)) : state('users', 'Belum ada akun', 'Ketuk Buat akun untuk membuatkan username dan password warga.'));
}

function getSecondaryAuth() { if (!secApp) secApp = initializeApp(firebaseConfig, 'pembuat-akun'); return getAuth(secApp); }
function checkLogin(username, password) {
  if (!/^[a-z0-9._-]{3,20}$/.test(username)) throw userErr('Username hanya boleh huruf kecil, angka, titik, strip, dan garis bawah, 3 sampai 20 karakter.');
  if (!password || password.length < 6) throw userErr('Password minimal 6 karakter.');
}
async function createLogin({ username, password, nama, role, rumahId }) {
  const secAuth = getSecondaryAuth();
  const cred = await createUserWithEmailAndPassword(secAuth, username + '@' + DOMAIN, password);
  const uid = cred.user.uid;
  await signOut(secAuth);
  try {
    await setDoc(doc(db, 'users', uid), { username, nama, role, rumahId: rumahId || '', aktif: true });
  } catch (e) {
    throw userErr('Akun login dibuat tetapi profilnya gagal disimpan. Hapus pengguna "' + username + '@' + DOMAIN + '" di Firebase Console > Authentication, lalu coba lagi.');
  }
}
function openAccount(a) {
  const houseOpts = [['', 'Tidak terkait rumah']].concat(sortedHouses(houses()).map((x) => [x.id, x.blok + '-' + x.nomor + (x.kepala ? ' (' + x.kepala + ')' : '')]));
  const self = a && a.id === profile.uid;
  const roleOpts = [['warga', 'Warga'], ['admin', 'Admin']];
  const fields = a ? [
    { name: 'username', label: 'Username', value: a.username, readonly: true },
    { name: 'nama', label: 'Nama', value: a.nama || '', maxlength: 80, required: true },
    { name: 'rumahId', label: 'Rumah', type: 'select', options: houseOpts, value: a.rumahId || '', full: true },
    { name: 'role', label: 'Peran', type: 'select', options: roleOpts, value: a.role, disabled: self },
    { name: 'aktif', label: 'Status akun', type: 'select', options: [['1', 'Aktif'], ['0', 'Nonaktif']], value: a.aktif ? '1' : '0', disabled: self }
  ] : [
    { name: 'username', label: 'Username', hint: 'Huruf kecil, angka, titik, strip', maxlength: 20, required: true, placeholder: 'mis. budi.a12' },
    { name: 'nama', label: 'Nama', maxlength: 80, required: true },
    { name: 'password', label: 'Password awal', hint: 'Minimal 6 karakter, berikan ke warga', type: 'password', maxlength: 60, required: true, full: true },
    { name: 'rumahId', label: 'Rumah', type: 'select', options: houseOpts, value: '' },
    { name: 'role', label: 'Peran', type: 'select', options: roleOpts, value: 'warga' }
  ];
  openModal({
    title: a ? 'Ubah akun ' + a.username : 'Buat akun',
    fields, submit: a ? 'Simpan' : 'Buat akun',
    onSubmit: async (v) => {
      if (a) {
        const upd = { nama: v.nama.trim(), rumahId: v.rumahId };
        if (!self) { upd.role = v.role; upd.aktif = v.aktif === '1'; }
        await updateDoc(doc(db, 'users', a.id), upd);
        toast('Akun diperbarui');
        return;
      }
      const username = v.username.trim().toLowerCase();
      checkLogin(username, v.password);
      await createLogin({ username, password: v.password, nama: v.nama.trim(), role: v.role, rumahId: v.rumahId });
      toast('Akun ' + username + ' dibuat. Berikan username dan password ke warga');
    },
    extra: a && !self ? (close) => deleteButton('Hapus akun', async () => {
      await deleteDoc(doc(db, 'users', a.id));
      close(); toast('Akun dihapus. Login ' + a.username + ' tidak bisa dipakai lagi');
    }) : null
  });
}

/* ========== INFO: PENGUMUMAN DAN AGENDA ========== */
function infoView() {
  return h('div', { style: 'display:contents' },
    h('h1', null, 'Info warga'),
    seg([['pengumuman', 'Pengumuman'], ['agenda', 'Agenda']], info.tab, (v) => { info.tab = v; }),
    info.tab === 'agenda' ? agendaBody() : pengumumanBody());
}
const pengSorted = () => data.pengumuman.slice().sort((a, b) =>
  (b.disematkan ? 1 : 0) - (a.disematkan ? 1 : 0) || String(b.tanggal || '').localeCompare(String(a.tanggal || '')));

function pengumumanBody() {
  const list = pengSorted();
  const card = (p) => {
    const kat = KAT_PENG[p.kategori] ? p.kategori : 'info';
    const isi = String(p.isi || '');
    return h('article', { class: 'card post' + (p.disematkan ? ' pinned' : '') },
      h('div', { class: 'post-top' }, p.disematkan ? h('span', { class: 'pill baru' }, 'Disematkan') : null, h('span', { class: 'pill ' + kat }, KAT_PENG[kat]), h('span', { class: 'sub' }, rel(p.tanggal))),
      h('h3', null, p.judul || '(tanpa judul)'),
      isi ? h('p', { class: 'clamp' }, isi) : null,
      p.penulis ? h('div', { class: 'sub' }, 'Oleh ' + p.penulis) : null,
      h('div', { class: 'card-act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openPeng(p) }, 'Ubah')));
  };
  return h('div', { style: 'display:contents' },
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openPeng(null) }, 'Tambah pengumuman'), h('span', { class: 'sub' }, 'Tampil di aplikasi warga')),
    err.pengumuman || !ready.pengumuman ? state('pengumuman', '', '')
      : list.length ? h('div', { class: 'stack' }, list.map(card)) : state('pengumuman', 'Belum ada pengumuman', 'Ketuk Tambah pengumuman. Warga langsung melihatnya di aplikasi mereka.'));
}
function openPeng(p) {
  openModal({
    title: p ? 'Ubah pengumuman' : 'Tambah pengumuman',
    fields: [
      { name: 'judul', label: 'Judul', value: p ? p.judul : '', maxlength: 120, required: true, full: true },
      { name: 'isi', label: 'Isi pengumuman', type: 'textarea', value: p ? p.isi : '', maxlength: 2000, required: true, full: true },
      { name: 'kategori', label: 'Kategori', type: 'select', options: Object.entries(KAT_PENG), value: p && KAT_PENG[p.kategori] ? p.kategori : 'info' },
      { name: 'tanggal', label: 'Tanggal', type: 'date', value: p && p.tanggal ? String(p.tanggal).slice(0, 10) : ymd(new Date()), required: true },
      { name: 'disematkan', label: 'Sematkan di atas', type: 'select', options: [['0', 'Tidak'], ['1', 'Ya']], value: p && p.disematkan ? '1' : '0' },
      { name: 'penulis', label: 'Ditulis oleh', hint: 'Boleh kosong', value: p ? (p.penulis || '') : (profile.nama || ''), maxlength: 60 }
    ],
    onSubmit: async (v) => {
      const judul = v.judul.trim(), isi = v.isi.trim();
      if (!judul || !isi) throw userErr('Isi judul dan isi pengumuman.');
      if (!v.tanggal) throw userErr('Pilih tanggal pengumuman.');
      const ref = p ? doc(db, 'pengumuman', p.id) : doc(collection(db, 'pengumuman'));
      await setDoc(ref, { judul, isi, kategori: v.kategori, tanggal: v.tanggal, disematkan: v.disematkan === '1', penulis: v.penulis.trim() });
      toast(p ? 'Pengumuman diperbarui' : 'Pengumuman diterbitkan');
    },
    extra: p ? (close) => deleteButton('Hapus', async () => { await deleteDoc(doc(db, 'pengumuman', p.id)); close(); toast('Pengumuman dihapus'); }) : null
  });
}

const agKey = (a) => String(a.tanggal || '') + ' ' + String(a.jam || '00:00');
function agendaBody() {
  const t = ymd(new Date());
  const up = data.agenda.filter((a) => String(a.tanggal || '') >= t).sort((a, b) => agKey(a).localeCompare(agKey(b)));
  const past = data.agenda.filter((a) => String(a.tanggal || '') < t).sort((a, b) => agKey(b).localeCompare(agKey(a)));
  const item = (a) => {
    const d = parseD(a.tanggal), valid = !isNaN(d);
    const kat = KAT_AG[a.kategori] ? a.kategori : 'lainnya';
    const isToday = a.tanggal === t;
    const meta = [a.jam ? 'Pukul ' + a.jam : '', a.lokasi || ''].filter(Boolean).join(' · ');
    return h('li', { class: 'card ag' + (isToday ? ' today' : ''), style: 'list-style:none' },
      h('div', { class: 'dateplate' }, h('b', null, valid ? d.getDate() : '–'), h('span', null, valid ? BULAN[d.getMonth()] : '')),
      h('div', { class: 'ag-body', style: 'flex:1' },
        h('div', { class: 'post-top' }, h('span', { class: 'pill ' + kat }, KAT_AG[kat]), isToday ? h('span', { class: 'pill baru' }, 'Hari ini') : null,
          valid ? h('span', { class: 'sub' }, d.toLocaleDateString('id-ID', { weekday: 'long' })) : null),
        h('div', { class: 'ag-title' }, a.judul || '(tanpa judul)'),
        meta ? h('div', { class: 'ag-meta' }, meta) : null,
        a.keterangan ? h('div', { class: 'ag-note' }, a.keterangan) : null,
        h('div', { class: 'card-act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openAgenda(a) }, 'Ubah'))));
  };
  const ul = (items) => h('ul', { class: 'stack', style: 'margin:0;padding:0' }, items.map(item));
  return h('div', { style: 'display:contents' },
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openAgenda(null) }, 'Tambah agenda'), h('span', { class: 'sub' }, 'Tampil di aplikasi warga')),
    err.agenda || !ready.agenda ? state('agenda', '', '')
      : !up.length && !past.length ? state('agenda', 'Belum ada agenda', 'Ketuk Tambah agenda untuk jadwal rapat atau kegiatan warga.')
      : h('div', { style: 'display:contents' },
          up.length ? h('section', { class: 'stack' }, h('h2', null, 'Akan datang'), ul(up)) : h('div', { class: 'note' }, 'Tidak ada agenda yang akan datang.'),
          past.length ? h('details', { class: 'past' }, h('summary', null, 'Sudah lewat (' + past.length + ')'), h('div', { class: 'stack', style: 'margin-top:8px' }, ul(past.slice(0, 30)))) : null));
}
function openAgenda(a) {
  openModal({
    title: a ? 'Ubah agenda' : 'Tambah agenda',
    fields: [
      { name: 'judul', label: 'Nama kegiatan', value: a ? a.judul : '', maxlength: 120, required: true, full: true },
      { name: 'tanggal', label: 'Tanggal', type: 'date', value: a ? a.tanggal : ymd(new Date()), required: true },
      { name: 'jam', label: 'Jam', hint: 'Boleh kosong', type: 'time', value: a ? (a.jam || '') : '' },
      { name: 'lokasi', label: 'Lokasi', hint: 'Boleh kosong', value: a ? (a.lokasi || '') : '', maxlength: 100 },
      { name: 'kategori', label: 'Kategori', type: 'select', options: Object.entries(KAT_AG), value: a && KAT_AG[a.kategori] ? a.kategori : 'kegiatan' },
      { name: 'keterangan', label: 'Keterangan', hint: 'Boleh kosong', type: 'textarea', value: a ? (a.keterangan || '') : '', maxlength: 500, full: true }
    ],
    onSubmit: async (v) => {
      const judul = v.judul.trim();
      if (!judul) throw userErr('Isi nama kegiatan.');
      if (!v.tanggal) throw userErr('Pilih tanggal kegiatan.');
      const ref = a ? doc(db, 'agenda', a.id) : doc(collection(db, 'agenda'));
      await setDoc(ref, { judul, tanggal: v.tanggal, jam: v.jam, lokasi: v.lokasi.trim(), kategori: v.kategori, keterangan: v.keterangan.trim() });
      toast(a ? 'Agenda diperbarui' : 'Agenda ditambahkan');
    },
    extra: a ? (close) => deleteButton('Hapus', async () => { await deleteDoc(doc(db, 'agenda', a.id)); close(); toast('Agenda dihapus'); }) : null
  });
}

/* ========== KEUANGAN ========== */
const iuranMap = () => Object.fromEntries(data.iuran.map((d) => [d.id, d]));
const pbbMap = () => Object.fromEntries(data.pbb.map((d) => [d.id, d]));

function keuanganView() {
  return h('div', { style: 'display:contents' },
    h('h1', null, 'Keuangan'),
    seg([['iuran', 'Iuran bulanan'], ['pbb', 'PBB kolektif']], keu.tab, (v) => { keu.tab = v; }),
    keu.tab === 'pbb' ? pbbAdmin() : iuranAdmin());
}
function keuBlock(...names) {
  for (const n of names) { if (err[n]) return state(n, '', ''); if (!ready[n]) return state(n, '', ''); }
  return null;
}
function keuFilter(ph) {
  const q = h('input', { class: 'field', id: 'q', type: 'search', placeholder: ph, 'aria-label': 'Cari rumah', enterkeyhint: 'search' });
  q.value = keu.q;
  q.addEventListener('input', () => { keu.q = q.value; renderPage(); });
  return q;
}
const matchHouse = (x, needle) => !needle || [x.blok + '-' + x.nomor, x.blok + ' ' + x.nomor, x.kepala].join(' ').toLowerCase().includes(needle);

/* ----- Iuran bulanan ----- */
function iuranAdmin() {
  const blocked = keuBlock('rumah', 'iuran'); if (blocked) return blocked;
  const set = data.pengIuran, nominal = Number(set && set.nominal) || 0;
  const ym = keu.bulan, key = bkey(ym);
  const map = iuranMap(), hs = sortedHouses(houses());
  const recOf = (id) => { const d = map[id]; return d && d.bayar ? d.bayar[key] || null : null; };
  let lunas = 0, total = 0;
  hs.forEach((x) => { const r = recOf(x.id); if (r) { lunas++; total += Number(r.jumlah) || 0; } });
  const pct = hs.length ? Math.round(lunas * 100 / hs.length) : 0;
  const needle = keu.q.trim().toLowerCase();
  const shown = hs.filter((x) => {
    const r = recOf(x.id);
    if (keu.filter === 'belum' && r) return false;
    if (keu.filter === 'lunas' && !r) return false;
    return matchHouse(x, needle);
  });
  const row = (x) => {
    const r = recOf(x.id);
    return h('article', { class: 'card house' },
      h('span', { class: 'plate' }, x.blok + '-' + x.nomor),
      h('div', { class: 'nama' }, x.kepala || 'Belum diisi'),
      h('div', { class: 'line' }, r ? [h('span', { class: 'pill info' }, 'Lunas'), h('span', { class: 'money' }, rp(r.jumlah)), r.tgl ? h('span', { class: 'sub' }, fmtDate(r.tgl)) : null]
        : h('span', { class: 'pill darurat' }, 'Belum bayar')),
      h('div', { class: 'card-act' },
        r ? h('button', { class: 'btn small', type: 'button', onclick: () => openIuranBayar(x, r) }, 'Ubah')
          : [h('button', { class: 'btn small primary', type: 'button', onclick: () => quickLunas(x) }, 'Tandai lunas'),
             h('button', { class: 'btn small', type: 'button', onclick: () => openIuranBayar(x, null) }, 'Catat rinci')]));
  };
  return h('div', { style: 'display:contents' },
    h('div', { class: 'card sum' },
      h('div', { class: 'bill-top' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Pengaturan iuran'),
          nominal ? h('div', null, h('span', { class: 'money' }, rp(nominal)), ' per bulan per rumah' + (set.mulai ? ', mulai ' + ymLabel(set.mulai) : ''))
            : h('div', { class: 'sub' }, 'Nominal iuran belum diatur')),
        h('button', { class: 'btn small' + (nominal ? '' : ' primary'), type: 'button', onclick: openIuranSet }, nominal ? 'Atur iuran' : 'Atur nominal iuran'))),
    stepper(ymLabel(ym), () => { keu.bulan = ymAdd(keu.bulan, -1); }, () => { keu.bulan = ymAdd(keu.bulan, 1); }),
    h('div', { class: 'card sum' },
      h('div', { class: 'sum-grid three' }, sumItem(rp(total), 'Terkumpul bulan ini', true), sumItem(lunas + ' dari ' + hs.length, 'Rumah sudah bayar'), sumItem(rp(Math.max(0, hs.length * nominal - total)), 'Belum terkumpul')),
      meter(pct)),
    seg([['semua', 'Semua'], ['belum', 'Belum bayar'], ['lunas', 'Lunas']], keu.filter, (v) => { keu.filter = v; }),
    keuFilter('Cari nama atau nomor rumah'),
    hs.length ? h('div', { class: 'grid-houses stack' }, shown.length ? shown.map(row) : h('div', { class: 'note' }, 'Tidak ada rumah yang cocok.'))
      : state('rumah', 'Belum ada data warga', 'Tambahkan rumah di tab Warga dulu.'));
}
async function simpanIuran(rid, key, rec) { await setDoc(doc(db, 'iuran', rid), { rumahId: rid, bayar: { [key]: rec } }, { merge: true }); }
async function quickLunas(x) {
  const nominal = Number(data.pengIuran && data.pengIuran.nominal) || 0;
  if (!nominal) { toast('Atur nominal iuran dulu'); openIuranSet(); return; }
  try { await simpanIuran(x.id, bkey(keu.bulan), { jumlah: nominal, tgl: ymd(new Date()), catatan: '' }); toast('Rumah ' + x.blok + '-' + x.nomor + ' lunas untuk ' + ymLabel(keu.bulan)); }
  catch (e) { toast(fbError(e)); }
}
function openIuranBayar(x, rec) {
  const nominal = Number(data.pengIuran && data.pengIuran.nominal) || 0;
  const key = bkey(keu.bulan);
  openModal({
    title: 'Iuran ' + x.blok + '-' + x.nomor + ', ' + ymLabel(keu.bulan),
    fields: [
      { name: 'jumlah', label: 'Jumlah dibayar (Rp)', type: 'text', inputmode: 'numeric', required: true, value: rec ? rec.jumlah : (nominal || '') },
      { name: 'tgl', label: 'Tanggal bayar', type: 'date', required: true, value: rec && rec.tgl ? rec.tgl : ymd(new Date()) },
      { name: 'catatan', label: 'Catatan', hint: 'Boleh kosong', value: rec ? (rec.catatan || '') : '', maxlength: 100, full: true }
    ],
    submit: rec ? 'Simpan' : 'Catat lunas',
    onSubmit: async (v) => {
      const jumlah = toInt(v.jumlah);
      if (jumlah <= 0) throw userErr('Isi jumlah pembayaran dengan angka.');
      await simpanIuran(x.id, key, { jumlah, tgl: v.tgl, catatan: v.catatan.trim() });
      toast('Pembayaran dicatat');
    },
    extra: rec ? (close) => deleteButton('Batalkan pembayaran', async () => {
      await updateDoc(doc(db, 'iuran', x.id), { ['bayar.' + key]: deleteField() });
      close(); toast('Pembayaran dibatalkan');
    }) : null
  });
}
function openIuranSet() {
  const set = data.pengIuran || {};
  const [my, mm] = (set.mulai || ymNow()).split('-');
  openModal({
    title: 'Atur iuran bulanan',
    intro: 'Nominal ini dipakai untuk tombol Tandai lunas dan untuk menghitung tunggakan warga.',
    fields: [
      { name: 'nominal', label: 'Iuran per rumah per bulan (Rp)', type: 'text', inputmode: 'numeric', required: true, value: set.nominal || '', full: true },
      { name: 'bulan', label: 'Mulai dihitung dari bulan', type: 'select', options: monthOptions(), value: mm },
      { name: 'tahun', label: 'Tahun', type: 'number', inputmode: 'numeric', min: 2020, max: 2100, required: true, value: my },
      { name: 'keterangan', label: 'Keterangan', hint: 'Boleh kosong, mis. untuk keamanan dan kebersihan', value: set.keterangan || '', maxlength: 120, full: true }
    ],
    onSubmit: async (v) => {
      const nominal = toInt(v.nominal), tahun = toInt(v.tahun);
      if (nominal <= 0) throw userErr('Isi nominal iuran dengan angka.');
      if (tahun < 2020 || tahun > 2100) throw userErr('Isi tahun dengan benar, mis. 2026.');
      await setDoc(doc(db, 'pengaturan', 'iuran'), { nominal, mulai: tahun + '-' + v.bulan, keterangan: v.keterangan.trim() });
      toast('Pengaturan iuran tersimpan');
    }
  });
}

/* ----- PBB kolektif ----- */
function pbbStatus(rec) {
  const t = Number(rec && rec.tagihan) || 0, b = Number(rec && rec.dibayar) || 0;
  if (!t) return 'tanpa'; if (b >= t) return 'lunas'; if (b > 0) return 'sebagian'; return 'belum';
}
const PBB_PILL = { lunas: ['info', 'Lunas'], sebagian: ['penting', 'Sebagian'], belum: ['darurat', 'Belum bayar'], tanpa: ['lainnya', 'Belum ada tagihan'] };

function pbbAdmin() {
  const blocked = keuBlock('rumah', 'pbb', 'pbbTahun'); if (blocked) return blocked;
  const th = keu.tahun, yk = ykey(th);
  const td = data.pbbTahun.find((d) => d.id === th) || {};
  const map = pbbMap(), hs = sortedHouses(houses());
  const recOf = (id) => { const d = map[id]; return d && d.tahun ? d.tahun[yk] || null : null; };
  let tagihan = 0, terkumpul = 0, lunas = 0, adaTagihan = 0;
  hs.forEach((x) => { const r = recOf(x.id); if (r && Number(r.tagihan) > 0) { adaTagihan++; tagihan += Number(r.tagihan); terkumpul += Number(r.dibayar) || 0; if (pbbStatus(r) === 'lunas') lunas++; } });
  const pct = tagihan ? Math.min(100, Math.round(terkumpul * 100 / tagihan)) : 0;
  const needle = keu.q.trim().toLowerCase();
  const shown = hs.filter((x) => {
    const st = pbbStatus(recOf(x.id));
    if (keu.filter === 'belum' && (st === 'lunas' || st === 'tanpa')) return false;
    if (keu.filter === 'lunas' && st !== 'lunas') return false;
    return matchHouse(x, needle);
  });
  const row = (x) => {
    const r = recOf(x.id), st = pbbStatus(r), p = PBB_PILL[st];
    return h('article', { class: 'card house' },
      h('span', { class: 'plate' }, x.blok + '-' + x.nomor),
      h('div', { class: 'nama' }, x.kepala || 'Belum diisi'),
      h('div', { class: 'line' }, h('span', { class: 'pill ' + p[0] }, p[1]),
        st !== 'tanpa' ? [h('span', { class: 'money' }, rp(r.dibayar) + ' / ' + rp(r.tagihan)), r.tgl ? h('span', { class: 'sub' }, fmtDate(r.tgl)) : null] : null),
      h('div', { class: 'card-act' },
        st === 'belum' || st === 'sebagian' ? h('button', { class: 'btn small primary', type: 'button', onclick: () => pbbLunas(x, r) }, 'Tandai lunas') : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => openPbb(x, r) }, st === 'tanpa' ? 'Isi tagihan' : 'Ubah')));
  };
  return h('div', { style: 'display:contents' },
    stepper('PBB ' + th, () => { keu.tahun = String(Number(keu.tahun) - 1); }, () => { keu.tahun = String(Number(keu.tahun) + 1); }),
    h('div', { class: 'card sum' },
      h('div', { class: 'bill-top' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Pengaturan PBB ' + th),
          h('div', null, td.jatuhTempo ? 'Jatuh tempo ' + fmtDate(td.jatuhTempo) : 'Jatuh tempo belum diisi'),
          h('div', { class: 'sub' }, td.disetor ? 'Sudah disetor ke kelurahan' + (td.tglSetor ? ' pada ' + fmtDate(td.tglSetor) : '') : 'Belum disetor ke kelurahan')),
        h('button', { class: 'btn small', type: 'button', onclick: () => openPbbTahun(th, td) }, 'Atur')),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: openPbbImpor }, 'Impor tagihan dari daftar'))),
    h('div', { class: 'card sum' },
      h('div', { class: 'sum-grid three' }, sumItem(rp(tagihan), 'Total tagihan'), sumItem(rp(terkumpul), 'Terkumpul', true), sumItem(lunas + ' dari ' + adaTagihan, 'Rumah lunas')),
      meter(pct), h('div', { class: 'sub' }, 'Sisa yang belum terkumpul ' + rp(Math.max(0, tagihan - terkumpul)))),
    seg([['semua', 'Semua'], ['belum', 'Belum lunas'], ['lunas', 'Lunas']], keu.filter, (v) => { keu.filter = v; }),
    keuFilter('Cari nama atau nomor rumah'),
    hs.length ? h('div', { class: 'grid-houses stack' }, shown.length ? shown.map(row) : h('div', { class: 'note' }, 'Tidak ada rumah yang cocok.'))
      : state('rumah', 'Belum ada data warga', 'Tambahkan rumah di tab Warga dulu.'));
}
async function pbbLunas(x, r) {
  try {
    await setDoc(doc(db, 'pbb', x.id), { rumahId: x.id, tahun: { [ykey(keu.tahun)]: { dibayar: Number(r.tagihan) || 0, tgl: ymd(new Date()) } } }, { merge: true });
    toast('PBB ' + x.blok + '-' + x.nomor + ' lunas');
  } catch (e) { toast(fbError(e)); }
}
function openPbb(x, rec) {
  const yk = ykey(keu.tahun);
  openModal({
    title: 'PBB ' + keu.tahun + ', rumah ' + x.blok + '-' + x.nomor,
    fields: [
      { name: 'tagihan', label: 'Tagihan PBB (Rp)', type: 'text', inputmode: 'numeric', required: true, value: rec ? rec.tagihan : '' },
      { name: 'dibayar', label: 'Sudah dibayar warga (Rp)', hint: 'Total sejauh ini', type: 'text', inputmode: 'numeric', value: rec ? (rec.dibayar || 0) : 0 },
      { name: 'tgl', label: 'Tanggal bayar terakhir', hint: 'Boleh kosong', type: 'date', value: rec ? (rec.tgl || '') : '' },
      { name: 'catatan', label: 'Catatan', hint: 'Boleh kosong', value: rec ? (rec.catatan || '') : '', maxlength: 100 }
    ],
    onSubmit: async (v) => {
      const tagihan = toInt(v.tagihan), dibayar = toInt(v.dibayar);
      if (tagihan <= 0) throw userErr('Isi tagihan PBB dengan angka.');
      await setDoc(doc(db, 'pbb', x.id), { rumahId: x.id, tahun: { [yk]: { tagihan, dibayar, tgl: v.tgl, catatan: v.catatan.trim() } } }, { merge: true });
      toast('Data PBB tersimpan');
    },
    extra: rec ? (close) => deleteButton('Hapus tagihan', async () => {
      await updateDoc(doc(db, 'pbb', x.id), { ['tahun.' + yk]: deleteField() });
      close(); toast('Tagihan PBB dihapus');
    }) : null
  });
}
function openPbbTahun(th, td) {
  openModal({
    title: 'Pengaturan PBB ' + th,
    fields: [
      { name: 'jatuhTempo', label: 'Jatuh tempo pembayaran', hint: 'Boleh kosong', type: 'date', value: td.jatuhTempo || '' },
      { name: 'disetor', label: 'Setoran ke kelurahan', type: 'select', options: [['0', 'Belum disetor'], ['1', 'Sudah disetor']], value: td.disetor ? '1' : '0' },
      { name: 'tglSetor', label: 'Tanggal setor', hint: 'Boleh kosong', type: 'date', value: td.tglSetor || '' },
      { name: 'catatan', label: 'Catatan untuk warga', hint: 'Boleh kosong, mis. cara membayar', type: 'textarea', value: td.catatan || '', maxlength: 300, full: true }
    ],
    onSubmit: async (v) => {
      await setDoc(doc(db, 'pbbTahun', th), { tahun: th, jatuhTempo: v.jatuhTempo, disetor: v.disetor === '1', tglSetor: v.tglSetor, catatan: v.catatan.trim() });
      toast('Pengaturan PBB tersimpan');
    }
  });
}
function openPbbImpor() {
  const th = keu.tahun, yk = ykey(th);
  openModal({
    title: 'Impor tagihan PBB ' + th, submit: 'Impor',
    intro: 'Tempel satu rumah per baris: ID rumah lalu nominal tagihan, dipisah koma, titik koma, atau tab. Tagihan yang sudah ada di tahun ini akan diganti, pembayarannya tidak berubah.',
    fields: [{ name: 'teks', label: 'Daftar tagihan', type: 'textarea', maxlength: 60000, required: true, full: true, placeholder: 'A-1, 350000\nA-2, 410500' }],
    onSubmit: async (v) => {
      const have = new Set(houses().map((x) => x.id));
      const ok = [], bad = [];
      v.teks.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        const p = line.split(/[,;\t]/).map((s) => s.trim());
        const m = String(p[0]).match(/^([A-Za-z]+)\s*[-_.\/ ]?\s*(\d+[A-Za-z]?)$/);
        const id = m ? (m[1] + '-' + m[2]).toUpperCase() : '';
        const n = toInt(p[1]);
        if (!id || !have.has(id) || n <= 0) bad.push(line.trim().slice(0, 30)); else ok.push([id, n]);
      });
      if (bad.length) throw userErr('Baris tidak dikenali (cek ID rumah dan nominal): ' + bad.slice(0, 5).join(' | ') + (bad.length > 5 ? ' dan ' + (bad.length - 5) + ' lainnya' : ''));
      if (!ok.length) throw userErr('Tidak ada baris yang bisa diimpor.');
      for (let i = 0; i < ok.length; i += 400) {
        const batch = writeBatch(db);
        ok.slice(i, i + 400).forEach(([id, n]) => batch.set(doc(db, 'pbb', id), { rumahId: id, tahun: { [yk]: { tagihan: n } } }, { merge: true }));
        await batch.commit();
      }
      toast(ok.length + ' tagihan PBB diimpor');
    }
  });
}

/* ========== ARISAN ========== */
function arisanView() {
  const now = ymNow();
  const list = data.arisan.slice().sort((a, b) => a.id.localeCompare(b.id));
  const next = list.find((a) => a.id >= now);
  const hmap = new Map(houses().map((x) => [x.id, x]));
  const item = (a) => {
    const [y, m] = a.id.split('-').map(Number);
    const x = hmap.get(a.rumahId), isNow = a.id === now, isNext = next && a.id === next.id && !isNow, past = a.id < now;
    const meta = [a.tanggal ? fmtDate(a.tanggal) : '', a.jam ? 'Pukul ' + a.jam : ''].filter(Boolean).join(' · ');
    return h('li', { class: 'card ag' + (isNow ? ' today' : ''), style: 'list-style:none' + (past ? ';opacity:.72' : '') },
      h('div', { class: 'dateplate' }, h('b', null, BULAN[m - 1]), h('span', null, y)),
      h('div', { class: 'ag-body', style: 'flex:1' },
        h('div', { class: 'post-top' }, isNow ? h('span', { class: 'pill baru' }, 'Bulan ini') : null, isNext ? h('span', { class: 'pill baru' }, 'Berikutnya') : null, past ? h('span', { class: 'pill lainnya' }, 'Selesai') : null),
        h('div', { class: 'turn-name' }, h('span', { class: 'plate' }, x ? x.blok + '-' + x.nomor : a.rumahId), h('span', { class: 'ag-title' }, x && x.kepala ? x.kepala : 'Rumah tidak ditemukan')),
        meta ? h('div', { class: 'ag-meta' }, meta) : null,
        a.catatan ? h('div', { class: 'ag-note' }, a.catatan) : null,
        h('div', { class: 'card-act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openArisan(a) }, 'Ubah'))));
  };
  return h('div', { style: 'display:contents' },
    h('h1', null, 'Giliran arisan'),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openArisan(null) }, 'Tambah giliran'),
      h('button', { class: 'btn', type: 'button', onclick: openArisanMassal }, 'Susun urutan sekaligus')),
    err.arisan || !ready.arisan ? state('arisan', '', '')
      : list.length ? h('ul', { class: 'grid-houses stack', style: 'margin:0;padding:0' }, list.map(item))
      : state('arisan', 'Belum ada jadwal arisan', 'Ketuk Tambah giliran, atau Susun urutan sekaligus untuk memasukkan daftar rumah berurutan. Warga melihat jadwalnya di aplikasi mereka.'));
}
function houseOptions() { return sortedHouses(houses()).map((x) => [x.id, x.blok + '-' + x.nomor + (x.kepala ? ' (' + x.kepala + ')' : '')]); }
function openArisan(a) {
  const hopts = houseOptions();
  if (!hopts.length) { toast('Tambahkan data rumah dulu di tab Warga'); return; }
  const [ay, am] = (a ? a.id : ymNow()).split('-');
  openModal({
    title: a ? 'Ubah giliran ' + ymLabel(a.id) : 'Tambah giliran arisan',
    fields: [
      { name: 'bulan', label: 'Bulan', type: 'select', options: monthOptions(), value: am, disabled: !!a },
      { name: 'tahun', label: 'Tahun', type: 'number', inputmode: 'numeric', min: 2020, max: 2100, required: true, value: ay, readonly: !!a },
      { name: 'rumahId', label: 'Tempat arisan (tuan rumah)', type: 'select', options: hopts, value: a ? a.rumahId : hopts[0][0], full: true },
      { name: 'tanggal', label: 'Tanggal', hint: 'Boleh kosong', type: 'date', value: a ? (a.tanggal || '') : '' },
      { name: 'jam', label: 'Jam', hint: 'Boleh kosong', type: 'time', value: a ? (a.jam || '') : '' },
      { name: 'catatan', label: 'Catatan', hint: 'Boleh kosong', value: a ? (a.catatan || '') : '', maxlength: 150, full: true }
    ],
    onSubmit: async (v) => {
      const tahun = toInt(v.tahun);
      if (tahun < 2020 || tahun > 2100) throw userErr('Isi tahun dengan benar, mis. 2026.');
      const id = a ? a.id : tahun + '-' + v.bulan;
      if (!a && data.arisan.some((d) => d.id === id)) throw userErr('Bulan ' + ymLabel(id) + ' sudah punya giliran. Gunakan Ubah pada daftar.');
      await setDoc(doc(db, 'arisan', id), { bulan: id, rumahId: v.rumahId, tanggal: v.tanggal, jam: v.jam, catatan: v.catatan.trim() });
      toast('Giliran ' + ymLabel(id) + ' tersimpan');
    },
    extra: a ? (close) => deleteButton('Hapus', async () => { await deleteDoc(doc(db, 'arisan', a.id)); close(); toast('Giliran dihapus'); }) : null
  });
}
function openArisanMassal() {
  const have = new Set(houses().map((x) => x.id));
  const [y, m] = ymNow().split('-');
  openModal({
    title: 'Susun urutan sekaligus', submit: 'Buat jadwal',
    intro: 'Tempel daftar rumah satu per baris, sesuai urutan giliran. Bulan terisi berurutan mulai dari bulan awal. Bulan yang sudah punya giliran tidak ditimpa.',
    fields: [
      { name: 'bulan', label: 'Bulan awal', type: 'select', options: monthOptions(), value: m },
      { name: 'tahun', label: 'Tahun awal', type: 'number', inputmode: 'numeric', min: 2020, max: 2100, required: true, value: y },
      { name: 'daftar', label: 'Urutan rumah', hint: 'mis. A-5 lalu baris berikutnya B-2', type: 'textarea', maxlength: 5000, required: true, full: true, placeholder: 'A-5\nB-2\nA-12' }
    ],
    onSubmit: async (v) => {
      const tahun = toInt(v.tahun);
      if (tahun < 2020 || tahun > 2100) throw userErr('Isi tahun dengan benar, mis. 2026.');
      const ids = [], bad = [];
      v.daftar.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        const mm = line.trim().match(/^([A-Za-z]+)\s*[-_.\/ ]?\s*(\d+[A-Za-z]?)/);
        const id = mm ? (mm[1] + '-' + mm[2]).toUpperCase() : '';
        if (!id || !have.has(id)) bad.push(line.trim().slice(0, 20)); else ids.push(id);
      });
      if (bad.length) throw userErr('Rumah tidak dikenali: ' + bad.slice(0, 6).join(', ') + '. Cek penulisan blok dan nomor.');
      if (!ids.length) throw userErr('Daftar rumah masih kosong.');
      const start = tahun + '-' + v.bulan;
      const plan = ids.map((rid, i) => [ymAdd(start, i), rid]);
      const clash = plan.filter(([bln]) => data.arisan.some((d) => d.id === bln)).map(([bln]) => ymLabel(bln));
      if (clash.length) throw userErr('Sudah ada giliran di: ' + clash.slice(0, 4).join(', ') + (clash.length > 4 ? ' dan lainnya' : '') + '. Hapus dulu atau mulai dari bulan lain.');
      for (let i = 0; i < plan.length; i += 400) {
        const batch = writeBatch(db);
        plan.slice(i, i + 400).forEach(([bln, rid]) => batch.set(doc(db, 'arisan', bln), { bulan: bln, rumahId: rid, tanggal: '', jam: '', catatan: '' }));
        await batch.commit();
      }
      toast(plan.length + ' giliran dibuat, ' + ymLabel(plan[0][0]) + ' sampai ' + ymLabel(plan[plan.length - 1][0]));
    }
  });
}

/* ========== RINGKASAN UNTUK WARGA ========== */
/* Warga tidak boleh membaca data rumah lain, jadi total dihitung di sini dan disimpan tanpa nama rumah. */
let syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(syncRingkasan, 1500); }
async function syncRingkasan() {
  if (!profile || !isAdmin()) return;
  for (const k of ['rumah', 'iuran', 'pbb', 'ringkasan']) if (!ready[k] || err[k]) return;
  const ids = new Set(houses().map((x) => x.id));
  const perBulan = {};
  data.iuran.forEach((d) => {
    if (!ids.has(d.id) || !d.bayar) return;
    for (const k in d.bayar) { const p = perBulan[k] || (perBulan[k] = { lunas: 0, total: 0 }); p.lunas++; p.total += Number(d.bayar[k].jumlah) || 0; }
  });
  const perTahun = {};
  data.pbb.forEach((d) => {
    if (!ids.has(d.id) || !d.tahun) return;
    for (const k in d.tahun) {
      const r = d.tahun[k], t = Number(r.tagihan) || 0; if (t <= 0) continue;
      const p = perTahun[k] || (perTahun[k] = { rumah: 0, lunas: 0, tagihan: 0, terkumpul: 0 });
      p.rumah++; p.tagihan += t; p.terkumpul += Number(r.dibayar) || 0; if ((Number(r.dibayar) || 0) >= t) p.lunas++;
    }
  });
  const want = { iuran: { rumah: ids.size, perBulan }, pbb: { perTahun } };
  for (const name of ['iuran', 'pbb']) {
    const cur = data.ringkasan.find((d) => d.id === name);
    let same = false;
    if (cur) { const { id, diperbarui, ...rest } = cur; same = stable(rest) === stable(want[name]); }
    if (!same) { try { await setDoc(doc(db, 'ringkasan', name), { ...want[name], diperbarui: new Date().toISOString() }); } catch (e) { /* diulang pada pembaruan berikutnya */ } }
  }
}

/* ---------- Ganti password sendiri ---------- */
function openPassword() {
  openModal({
    title: 'Ganti password',
    fields: [
      { name: 'lama', label: 'Password sekarang', type: 'password', required: true, full: true },
      { name: 'baru', label: 'Password baru', hint: 'Minimal 6 karakter', type: 'password', required: true, maxlength: 60, full: true }
    ],
    onSubmit: async (v) => {
      if (v.baru.length < 6) throw userErr('Password baru minimal 6 karakter.');
      const user = auth.currentUser;
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, v.lama));
      await updatePassword(user, v.baru);
      toast('Password diganti');
    }
  });
}
