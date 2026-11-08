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

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
let secApp = null;

let profile = null;          // dokumen users/{uid} milik yang login
let houses = [];
let accounts = [];
let tab = 'rumah';
let unsubs = [];
let dataRole = null;
const filter = { q: '', blok: '', status: '' };

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
let toastTimer;
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}
const clean = (s) => String(s || '').replace(/[^A-Za-z0-9_.~:@+-]/g, '');
const normStatus = (s) => { s = String(s || '').toLowerCase(); return s.includes('kontrak') ? 'kontrak' : s.includes('kosong') ? 'kosong' : 'dihuni'; };
const isAdmin = () => profile && profile.role === 'admin';
const rumahLabel = (id) => { const r = houses.find((x) => x.id === id); return r ? r.blok + '-' + r.nomor : ''; };
function sortedHouses(list) {
  return list.slice().sort((a, b) => a.blok.localeCompare(b.blok, 'id') || a.nomor.localeCompare(b.nomor, 'id', { numeric: true }));
}
function fbError(e) {
  const c = (e && e.code) || '';
  if (c === 'permission-denied') return 'Akun ini tidak punya izin untuk tindakan ini.';
  if (c === 'auth/email-already-in-use') return 'Username sudah dipakai. Pilih username lain.';
  if (c === 'auth/weak-password') return 'Password terlalu pendek. Pakai minimal 6 karakter.';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-email') return 'Username atau password salah.';
  if (c === 'auth/too-many-requests') return 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.';
  if (c === 'auth/network-request-failed' || c === 'unavailable') return 'Tidak ada koneksi internet. Coba lagi setelah tersambung.';
  return 'Terjadi kesalahan (' + (c || 'tidak dikenal') + '). Coba lagi.';
}
const mount = (...nodes) => { const a = $('#app'); a.textContent = ''; a.append(...nodes); };

/* ---------- Modal formulir ---------- */
function openModal({ title, fields, submit = 'Simpan', onSubmit, extra }) {
  const msg = h('div', { class: 'msg', role: 'status' });
  const inputs = {};
  const fieldEls = fields.map((f) => {
    let input;
    if (f.type === 'select') {
      input = h('select', { class: 'field', id: 'm-' + f.name }, f.options.map(([v, l]) => h('option', { value: v }, l)));
      input.value = f.value ?? f.options[0][0];
    } else if (f.type === 'textarea') {
      input = h('textarea', { class: 'field', id: 'm-' + f.name, maxlength: f.maxlength || 200, placeholder: f.placeholder });
      input.value = f.value || '';
    } else {
      input = h('input', { class: 'field', id: 'm-' + f.name, type: f.type || 'text', maxlength: f.maxlength, placeholder: f.placeholder,
        autocomplete: f.type === 'password' ? 'new-password' : 'off', inputmode: f.inputmode, min: f.min, max: f.max, required: f.required, readonly: f.readonly });
      input.value = f.value ?? '';
    }
    if (f.disabled) input.disabled = true;
    inputs[f.name] = input;
    return h('label', { class: 'f', for: 'm-' + f.name }, f.label, f.hint ? h('span', { class: 'hint' }, f.hint) : null, input);
  });
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, submit);
  const close = () => { ov.remove(); };
  const form = h('form', { class: 'panel', autocomplete: 'off' },
    h('h2', null, title),
    h('div', { style: 'display:grid;gap:12px' }, fieldEls),
    msg,
    h('div', { class: 'form-actions' }, saveBtn, h('button', { class: 'btn', type: 'button', onclick: close }, 'Batal'), h('span', { class: 'spacer' }), extra ? extra(close) : null));
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
const userErr = (m) => Object.assign(new Error(m), { userMessage: m });

/* ---------- Login & status ---------- */
function showLogin() {
  const msg = h('div', { class: 'msg', role: 'status' });
  const u = h('input', { class: 'field', id: 'l-user', autocomplete: 'username', autocapitalize: 'none', required: true });
  const p = h('input', { class: 'field', id: 'l-pass', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Masuk');
  const form = h('form', { class: 'login' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Perumahan ADIBA 3'), h('h1', null, 'Admin Paguyuban'), h('div', { class: 'sub' }, 'Masuk dengan akun admin.')),
    h('label', { class: 'f', for: 'l-user' }, 'Username', u),
    h('label', { class: 'f', for: 'l-pass' }, 'Password', p),
    msg, btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Masuk…';
    try { await signInWithEmailAndPassword(auth, u.value.trim().toLowerCase() + '@' + DOMAIN, p.value); }
    catch (e) { msg.className = 'msg err'; msg.textContent = fbError(e); btn.disabled = false; }
  });
  mount(form);
  u.focus();
}
function showBlocked(text) {
  mount(h('div', { class: 'login' },
    h('h1', null, 'Paguyuban ADIBA 3'),
    h('div', { class: 'note err' }, text),
    h('button', { class: 'btn', type: 'button', onclick: () => signOut(auth) }, 'Keluar')));
}

/* ---------- Data ---------- */
function stopAll() { unsubs.forEach((f) => f()); unsubs = []; dataRole = null; houses = []; accounts = []; }

onAuthStateChanged(auth, (user) => {
  stopAll(); profile = null;
  if (!user) { showLogin(); return; }
  mount(h('div', { class: 'note' }, 'Memuat data…'));
  unsubs.push(onSnapshot(doc(db, 'users', user.uid), (snap) => {
    if (!snap.exists()) { showBlocked('Akun ini belum terdaftar di paguyuban. Hubungi pengurus.'); return; }
    profile = { uid: user.uid, ...snap.data() };
    if (!profile.aktif) { showBlocked('Akun ini dinonaktifkan. Hubungi pengurus.'); return; }
    if (profile.role !== 'admin') { showBlocked('Aplikasi ini khusus admin. Warga membuka aplikasi warga.'); return; }
    if (dataRole !== profile.role) startData();
    render();
  }, () => showBlocked('Data tidak bisa dimuat. Periksa koneksi lalu muat ulang halaman.')));
});

function startData() {
  dataRole = profile.role;
  unsubs.push(onSnapshot(collection(db, 'rumah'), (snap) => {
    houses = snap.docs.map((d) => { const v = d.data(); return {
      id: d.id, blok: String(v.blok || ''), nomor: String(v.nomor || ''), kepala: v.kepala || '', telepon: v.telepon || '',
      jumlah: Number(v.jumlah) || 0, status: normStatus(v.status), jabatan: v.jabatan || '', catatan: v.catatan || '' }; });
    render();
  }, () => toast('Data rumah tidak bisa dimuat')));
  if (isAdmin()) {
    unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
      accounts = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      render();
    }, () => toast('Daftar akun tidak bisa dimuat')));
  }
}

/* ---------- Tampilan utama ---------- */
function render() {
  if (!profile || !profile.aktif) return;
  const active = document.activeElement;
  const keepSearch = active && active.id === 'q';
  const caret = keepSearch ? active.selectionStart : 0;
  const admin = isAdmin();
  const head = h('header', { class: 'top' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Perumahan ADIBA 3'), h('h1', null, 'Admin Paguyuban'),
      h('div', { class: 'sub' }, 'Masuk sebagai ' + (profile.nama || profile.username))),
    h('div', { class: 'me' },
      h('span', { class: 'role' + (admin ? '' : ' read') }, admin ? 'Admin' : 'Warga'),
      h('button', { class: 'btn small', type: 'button', onclick: openPassword }, 'Ganti password'),
      h('button', { class: 'btn small', type: 'button', onclick: () => signOut(auth) }, 'Keluar')));
  const parts = [head];
  if (admin) {
    parts.push(h('div', { class: 'tabs', role: 'tablist' },
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === 'rumah'), onclick: () => { tab = 'rumah'; render(); } }, 'Data rumah'),
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === 'akun'), onclick: () => { tab = 'akun'; render(); } }, 'Akun warga')));
  }
  parts.push(admin && tab === 'akun' ? akunView() : rumahView());
  mount(...parts);
  if (keepSearch) { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(caret, caret); } }
}

function rumahView() {
  const admin = isAdmin();
  const c = { dihuni: 0, kontrak: 0, kosong: 0 }; let jiwa = 0;
  houses.forEach((x) => { c[x.status]++; jiwa += x.jumlah; });
  const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const bloks = [...new Set(houses.map((x) => x.blok))].sort((a, b) => a.localeCompare(b, 'id'));
  const q = h('input', { class: 'field', id: 'q', type: 'search', placeholder: 'Cari nama, blok, nomor rumah, atau telepon', 'aria-label': 'Cari' });
  q.value = filter.q;
  q.addEventListener('input', () => { filter.q = q.value; render(); });
  const fb = h('select', { class: 'field', 'aria-label': 'Filter blok', onchange: (e) => { filter.blok = e.target.value; render(); } },
    h('option', { value: '' }, 'Semua blok'), bloks.map((b) => h('option', { value: b }, 'Blok ' + b)));
  fb.value = bloks.includes(filter.blok) ? filter.blok : '';
  const fs = h('select', { class: 'field', 'aria-label': 'Filter status', onchange: (e) => { filter.status = e.target.value; render(); } },
    h('option', { value: '' }, 'Semua status'), Object.entries(STATUS).map(([v, l]) => h('option', { value: v }, l)));
  fs.value = filter.status;

  const needle = filter.q.trim().toLowerCase();
  const all = sortedHouses(houses);
  const shown = all.filter((x) => {
    if (filter.blok && x.blok !== filter.blok) return false;
    if (filter.status && x.status !== filter.status) return false;
    if (!needle) return true;
    return [x.blok + '-' + x.nomor, x.blok + ' ' + x.nomor, x.kepala, x.telepon, x.jabatan, x.catatan].join(' ').toLowerCase().includes(needle);
  });

  const mine = !admin && profile.rumahId ? houses.find((x) => x.id === profile.rumahId) : null;
  const rows = shown.map((x) => h('li', { class: 'row cols-rumah' + (x.id === profile.rumahId ? ' me-row' : '') },
    h('span', { class: 'plate' }, x.blok + '-' + x.nomor),
    h('div', { class: 'who' }, h('div', { class: 'nama' }, x.kepala || 'Belum diisi'), x.jabatan ? h('div', { class: 'sub' }, x.jabatan) : null, x.catatan ? h('div', { class: 'sub' }, x.catatan) : null),
    h('div', null, x.telepon ? h('span', { class: 'mono' }, x.telepon) : h('span', { class: 'sub' }, 'Tanpa nomor')),
    h('div', null, h('span', { class: 'pill ' + x.status }, STATUS[x.status])),
    h('div', { class: 'sub' }, x.jumlah ? x.jumlah + ' jiwa' : '–'),
    admin ? h('div', { class: 'act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openHouse(x) }, 'Ubah')) : h('span')));

  return h('div', { style: 'display:flex;flex-direction:column;gap:20px' },
    h('section', { class: 'stats' }, stat(houses.length, 'Rumah terdata'), stat(c.dihuni, 'Dihuni pemilik'), stat(c.kontrak, 'Dikontrakkan'), stat(c.kosong, 'Kosong'), stat(jiwa, 'Jiwa tercatat')),
    mine ? h('div', { class: 'mine' }, h('span', { class: 'plate' }, mine.blok + '-' + mine.nomor), h('strong', null, 'Rumah Anda'), h('span', { class: 'sub' }, STATUS[mine.status] + (mine.jumlah ? ', ' + mine.jumlah + ' jiwa' : ''))) : null,
    h('section', { class: 'tools' }, h('div', { class: 'grow' }, q), fb, fs, h('span', { class: 'spacer' }),
      admin ? [h('button', { class: 'btn', type: 'button', onclick: openImport }, 'Impor daftar'), h('button', { class: 'btn primary', type: 'button', onclick: () => openHouse(null) }, 'Tambah rumah')] : null),
    all.length
      ? h('section', { class: 'list' },
          h('div', { class: 'thead cols-rumah', 'aria-hidden': 'true' }, h('span', null, 'Rumah'), h('span', null, 'Kepala keluarga'), h('span', null, 'Telepon'), h('span', null, 'Status'), h('span', null, 'Penghuni'), h('span')),
          h('ul', { class: 'rows' }, rows.length ? rows : h('li', { class: 'row' }, h('div', { class: 'sub' }, 'Tidak ada rumah yang cocok dengan pencarian.'))))
      : h('section', { class: 'list' }, h('div', { class: 'empty' }, h('span', { class: 'plate' }, 'A-1'), h('h2', null, 'Belum ada data rumah'),
          h('p', null, admin ? 'Tambahkan rumah pertama, atau tempel daftar dari spreadsheet lewat Impor daftar.' : 'Pengurus belum mengisi data.'))),
    all.length ? h('div', { class: 'sub' }, 'Menampilkan ' + shown.length + ' dari ' + all.length + ' rumah') : null);
}

function akunView() {
  const list = accounts.slice().sort((a, b) => (a.nama || a.username || '').localeCompare(b.nama || b.username || '', 'id'));
  const rows = list.map((a) => h('li', { class: 'row cols-akun' },
    h('div', { class: 'who' }, h('div', { class: 'nama' }, a.nama || '(tanpa nama)'), h('div', { class: 'mono' }, a.username)),
    h('div', null, a.rumahId ? h('span', { class: 'plate' }, rumahLabel(a.rumahId) || a.rumahId) : h('span', { class: 'sub' }, 'Tidak terkait')),
    h('div', { class: 'sub' }, a.role === 'admin' ? 'Admin' : 'Warga'),
    h('div', null, h('span', { class: 'pill ' + (a.aktif ? 'aktif' : 'nonaktif') }, a.aktif ? 'Aktif' : 'Nonaktif')),
    h('span'),
    h('div', { class: 'act' }, h('button', { class: 'btn small', type: 'button', onclick: () => openAccount(a) }, 'Ubah'))));
  return h('div', { style: 'display:flex;flex-direction:column;gap:20px' },
    h('div', { class: 'tools' }, h('div', { class: 'sub grow' }, accounts.length + ' akun terdaftar'), h('button', { class: 'btn primary', type: 'button', onclick: () => openAccount(null) }, 'Buat akun')),
    accounts.length
      ? h('section', { class: 'list' }, h('div', { class: 'thead cols-akun', 'aria-hidden': 'true' }, h('span', null, 'Nama dan username'), h('span', null, 'Rumah'), h('span', null, 'Peran'), h('span', null, 'Status'), h('span'), h('span')), h('ul', { class: 'rows' }, rows))
      : h('div', { class: 'note' }, 'Belum ada akun.'));
}

/* ---------- Rumah: tambah, ubah, hapus, impor ---------- */
function openHouse(x) {
  openModal({
    title: x ? 'Ubah rumah ' + x.blok + '-' + x.nomor : 'Tambah rumah',
    fields: [
      { name: 'blok', label: 'Blok', value: x ? x.blok : filter.blok, maxlength: 8, required: true, readonly: !!x, placeholder: 'mis. A' },
      { name: 'nomor', label: 'Nomor rumah', value: x ? x.nomor : '', maxlength: 8, required: true, readonly: !!x, placeholder: 'mis. 12' },
      { name: 'kepala', label: 'Kepala keluarga', value: x ? x.kepala : '', maxlength: 80 },
      { name: 'telepon', label: 'Telepon / WhatsApp', value: x ? x.telepon : '', maxlength: 20, inputmode: 'tel' },
      { name: 'jumlah', label: 'Jumlah penghuni', type: 'number', min: 0, max: 30, value: x ? x.jumlah : 0 },
      { name: 'status', label: 'Status rumah', type: 'select', options: Object.entries(STATUS), value: x ? x.status : 'dihuni' },
      { name: 'jabatan', label: 'Jabatan di paguyuban', hint: ' (boleh kosong)', value: x ? x.jabatan : '', maxlength: 40 },
      { name: 'catatan', label: 'Catatan', hint: ' (boleh kosong)', type: 'textarea', value: x ? x.catatan : '' }
    ].concat(x ? [] : [
      { name: 'username', label: 'Username login anggota', hint: ' (boleh kosong, bisa dibuat nanti di tab Akun)', maxlength: 20, placeholder: 'mis. budi.a12' },
      { name: 'password', label: 'Password awal', hint: ' (minimal 6 karakter)', type: 'password', maxlength: 60 }
    ]),
    onSubmit: async (v) => {
      const blok = clean(v.blok).toUpperCase(), nomor = clean(v.nomor).toUpperCase();
      if (!blok || !nomor) throw userErr('Isi blok dan nomor rumah. Hanya huruf, angka, dan tanda hubung.');
      const id = blok + '-' + nomor;
      if (!x && houses.some((r) => r.id === id)) throw userErr('Rumah ' + id + ' sudah ada. Gunakan Ubah pada daftar.');
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
      let armed = false;
      const linked = accounts.filter((a) => a.rumahId === x.id && a.uid !== profile.uid);
      const label = 'Hapus anggota' + (linked.length ? ' dan ' + linked.length + ' akun' : '');
      const b = h('button', { class: 'btn danger', type: 'button' }, label);
      b.addEventListener('click', async () => {
        if (!armed) { armed = true; b.textContent = 'Yakin hapus? Klik lagi'; return; }
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'rumah', x.id));
          linked.forEach((a) => batch.delete(doc(db, 'users', a.uid)));
          await batch.commit();
          close(); toast('Anggota dihapus');
        } catch (e) { toast(fbError(e)); }
      });
      return b;
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
    title: 'Impor daftar rumah',
    submit: 'Impor',
    fields: [{ name: 'teks', label: 'Satu rumah per baris', hint: 'Urutan: blok, nomor, kepala keluarga, telepon, jumlah penghuni, status. Pisahkan dengan koma, titik koma, atau tab. Rumah yang sudah ada dilewati.', type: 'textarea', maxlength: 60000, placeholder: 'A, 1, Nama Kepala Keluarga, 08xxxxxxxxxx, 4, dihuni' }],
    onSubmit: async (v) => {
      const r = parseImport(v.teks);
      const todo = r.rows.filter((x) => !houses.some((e) => e.id === x.id));
      if (!todo.length) throw userErr('Tidak ada rumah baru untuk diimpor. ' + (r.bad ? r.bad + ' baris dilewati karena blok atau nomor kosong atau dobel.' : ''));
      for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        todo.slice(i, i + 400).forEach((x) => { const { id, ...data } = x; batch.set(doc(db, 'rumah', id), data); });
        await batch.commit();
      }
      toast(todo.length + ' rumah diimpor');
    }
  });
}

/* ---------- Akun warga ---------- */
function getSecondaryAuth() {
  if (!secApp) secApp = initializeApp(firebaseConfig, 'pembuat-akun');
  return getAuth(secApp);
}
function openAccount(a) {
  const houseOpts = [['', 'Tidak terkait rumah']].concat(sortedHouses(houses).map((x) => [x.id, x.blok + '-' + x.nomor + (x.kepala ? ' (' + x.kepala + ')' : '')]));
  const self = a && a.uid === profile.uid;
  const fields = a ? [
    { name: 'username', label: 'Username', value: a.username, readonly: true },
    { name: 'nama', label: 'Nama', value: a.nama || '', maxlength: 80, required: true },
    { name: 'rumahId', label: 'Rumah', type: 'select', options: houseOpts, value: a.rumahId || '' },
    { name: 'role', label: 'Peran', type: 'select', options: [['warga', 'Warga'], ['admin', 'Admin']], value: a.role, disabled: self },
    { name: 'aktif', label: 'Status akun', type: 'select', options: [['1', 'Aktif'], ['0', 'Nonaktif']], value: a.aktif ? '1' : '0', disabled: self }
  ] : [
    { name: 'username', label: 'Username', hint: ' (huruf kecil, angka, titik, strip, 3 sampai 20 karakter)', maxlength: 20, required: true, placeholder: 'mis. budi.a12' },
    { name: 'nama', label: 'Nama', maxlength: 80, required: true },
    { name: 'password', label: 'Password awal', hint: ' (minimal 6 karakter, berikan ke warga)', type: 'password', maxlength: 60, required: true },
    { name: 'rumahId', label: 'Rumah', type: 'select', options: houseOpts, value: '' },
    { name: 'role', label: 'Peran', type: 'select', options: [['warga', 'Warga'], ['admin', 'Admin']], value: 'warga' }
  ];
  openModal({
    title: a ? 'Ubah akun ' + a.username : 'Buat akun warga',
    fields,
    submit: a ? 'Simpan' : 'Buat akun',
    onSubmit: async (v) => {
      if (a) {
        const upd = { nama: v.nama.trim(), rumahId: v.rumahId };
        if (!self) { upd.role = v.role; upd.aktif = v.aktif === '1'; }
        await updateDoc(doc(db, 'users', a.uid), upd);
        toast('Akun diperbarui');
        return;
      }
      const username = v.username.trim().toLowerCase();
      checkLogin(username, v.password);
      await createLogin({ username, password: v.password, nama: v.nama.trim(), role: v.role, rumahId: v.rumahId });
      toast('Akun ' + username + ' dibuat');
    },
    extra: a && !self ? (close) => {
      let armed = false;
      const b = h('button', { class: 'btn danger', type: 'button' }, 'Hapus akun');
      b.addEventListener('click', async () => {
        if (!armed) { armed = true; b.textContent = 'Yakin hapus? Klik lagi'; return; }
        try { await deleteDoc(doc(db, 'users', a.uid)); close(); toast('Akun dihapus. Login ' + a.username + ' tidak bisa dipakai lagi'); } catch (e) { toast(fbError(e)); }
      });
      return b;
    } : null
  });
}

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

function openPassword() {
  openModal({
    title: 'Ganti password',
    fields: [
      { name: 'lama', label: 'Password sekarang', type: 'password', required: true },
      { name: 'baru', label: 'Password baru', hint: ' (minimal 6 karakter)', type: 'password', required: true, maxlength: 60 }
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
