import { firebaseConfig, DOMAIN } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (s) => document.querySelector(s);
const STATUS = { dihuni: 'Dihuni pemilik', kontrak: 'Dikontrakkan', kosong: 'Kosong' };
const KAT_PENG = { info: 'Info', penting: 'Penting', darurat: 'Darurat' };
const KAT_AG = { rapat: 'Rapat', kegiatan: 'Kegiatan', lainnya: 'Lainnya' };
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const VIEWS = [
  { id: 'rumah', label: 'Warga', icon: 'users' },
  { id: 'akun', label: 'Akun', icon: 'key' },
  { id: 'pengumuman', label: 'Pengumuman', icon: 'bell' },
  { id: 'agenda', label: 'Agenda', icon: 'cal' }
];
const ICONS = {
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2c2.3.6 3.5 2.4 3.5 5.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>'
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
let secApp = null;

let profile = null, unsubs = [], shell = false, menuOpen = false, view = 'rumah';
const data = { rumah: [], users: [], pengumuman: [], agenda: [] };
const ready = { rumah: false, users: false, pengumuman: false, agenda: false };
const err = { rumah: null, users: null, pengumuman: null, agenda: null };
const filt = { q: '', blok: '', status: '' };

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

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function parseD(s) { s = String(s || ''); return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s); }
function daysAgo(s) {
  const d = parseD(s); if (isNaN(d)) return null;
  const t = new Date();
  return Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
}
function rel(s) {
  const n = daysAgo(s); if (n === null) return '';
  if (n === 0) return 'Hari ini'; if (n === 1) return 'Kemarin'; if (n > 1 && n < 7) return n + ' hari lalu';
  return parseD(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
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

/* ---------- Dialog formulir ---------- */
function openModal({ title, fields, submit = 'Simpan', onSubmit, extra }) {
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

/* ---------- Masuk ---------- */
function showLogin() {
  shell = false;
  const msg = h('div', { class: 'msg', role: 'status' });
  const u = h('input', { class: 'field', id: 'l-user', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
  const p = h('input', { class: 'field', id: 'l-pass', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Masuk');
  const form = h('form', { class: 'login' },
    h('div', { class: 'hero' }, h('span', { class: 'plate', style: 'align-self:flex-start' }, 'ADMIN'), h('h1', { style: 'margin-top:10px' }, 'Admin Paguyuban ADIBA 3'),
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
  for (const k in data) { data[k] = []; ready[k] = false; err[k] = null; }
}
function subscribe(name) {
  unsubs.push(onSnapshot(collection(db, name), (snap) => {
    data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ready[name] = true; err[name] = null; renderPage();
  }, (e) => { ready[name] = true; err[name] = (e && e.code) || 'error'; renderPage(); }));
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
    if (!started) { started = true; ['rumah', 'users', 'pengumuman', 'agenda'].forEach(subscribe); }
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
      h('div', { class: 'brand' }, h('span', { class: 'plate' }, 'A3'), h('div', null, h('div', { class: 'eyebrow' }, 'Admin'), h('b', null, 'ADIBA 3'))),
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
function syncRoute() { const id = location.hash.replace('#', ''); view = VIEWS.some((v) => v.id === id) ? id : 'rumah'; }
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
  main.append(view === 'akun' ? akunView() : view === 'pengumuman' ? pengumumanView() : view === 'agenda' ? agendaView() : rumahView());
  if (keep) { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(caret, caret); } }
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

/* ========== PENGUMUMAN ========== */
const pengSorted = () => data.pengumuman.slice().sort((a, b) =>
  (b.disematkan ? 1 : 0) - (a.disematkan ? 1 : 0) || String(b.tanggal || '').localeCompare(String(a.tanggal || '')));

function pengumumanView() {
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
    h('h1', null, 'Pengumuman'),
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

/* ========== AGENDA ========== */
const agKey = (a) => String(a.tanggal || '') + ' ' + String(a.jam || '00:00');
function agendaView() {
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
    h('h1', null, 'Agenda'),
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
