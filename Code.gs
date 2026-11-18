/**
 * Sistem Moderasi Digital IPG — MPU7011
 * Code.gs — backend Google Apps Script
 *
 * PASANG / KEMAS KINI
 * 1. Buka Google Sheet > Extensions > Apps Script. Gantikan kandungan Code.gs dengan fail ini.
 * 2. Pilih fungsi setupSistem() dan klik Run sekali. Beri kebenaran Sheets, Drive dan Mail.
 * 3. Deploy > Manage deployments > Edit (ikon pensil) > Version: New version > Deploy.
 *    Selepas kemas kini kod, WAJIB pilih New version. URL /exec kekal sama.
 */

// Versi backend. Kemas kini nilai ini setiap kali Code.gs berubah.
const VERSI_BACKEND = 'v4.0.0-sampel-terbuka';

const NAMA_HELAIAN = {
  PENSYARAH: 'Pensyarah',
  SKRIP: 'SkripInduk',
  HASIL: 'HasilSemakan',
  KONFIG: 'Konfigurasi',
  LOG: 'LogAktiviti',
  RUBRIK: 'TetapanRubrik'
};

const LAJUR = {
  Pensyarah: ['email', 'nama', 'peranan', 'passwordHash', 'aktif', 'tarikhDicipta'],
  SkripInduk: ['angkaGiliran', 'emelPensyarah', 'namaPensyarah', 'kumpulan', 'fasaModerasi', 'markahPemeriksa', 'urlSkrip', 'emelP1', 'emelP2', 'tarikhMuatNaik', 'namaFail'],
  HasilSemakan: ['id', 'angkaGiliran', 'emelPensyarah', 'namaPensyarah', 'fasaModerasi', 'markahPemeriksa', 'hp1_a1', 'hp1_a2', 'hp1_b1', 'hp1_b2', 'hp1_c1', 'hp1_c2', 'hp5_d1', 'hp5_d2', 'hp5_d3', 'hp5_d4', 'markahModerasiP1', 'perbezaanP1', 'markahModerasiP2', 'perbezaanP2', 'markahAkhir', 'dataLakaran', 'tarikhKemaskini', 'rubrikJson'],
  Konfigurasi: ['kunci', 'nilai', 'catatan'],
  TetapanRubrik: ['kod', 'hp', 'perincian', 'markah', 'susunan'],
  LogAktiviti: ['timestamp', 'email', 'action', 'angkaGiliran', 'status', 'mesej']
};

// Lajur sistem dalam HasilSemakan (bukan rubrik). Lajur hp1_*/hp5_* ialah lajur rubrik lama dan dibenarkan.
const LAJUR_SISTEM_HASIL = LAJUR.HasilSemakan.filter(c => !/^hp[15]_/.test(c));

const FASA_SAH = ['Kelompok Tinggi', 'Kelompok Sederhana', 'Kelompok Rendah', 'Kes Ekstrem Cemerlang'];
const MARKAH_MAKSIMUM = 40;
const RUJUKAN_DRIVE = 'DRIVEFILE:';
const LAKARAN_MAKS_AKSARA = 40000; // had sel Google Sheets ialah 50,000 aksara
const PDF_MAKS_BAIT = 20 * 1024 * 1024;
const PERANAN_ADMIN = ['admin', 'ketua jabatan', 'kj', 'kp', 'ketua pemeriksa'];
const NAMA_FOLDER_DEFAULT = 'MPU7011 - Fail Moderasi';

/* ============================== TITIK MASUK ============================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  const tindakan = p.action || 'getData';
  const keluaranTeks = tindakan === 'fetchPdfProxy' || tindakan === 'fetchLakaranProxy';
  try {
    const pengguna = sahkanPengguna(p.email, p.password);
    if (tindakan === 'getData') return sendJson(dapatDataUntukPengguna(pengguna));
    if (tindakan === 'fetchPdfProxy') return teksBiasa(ambilPdfBase64(pengguna, p.id));
    if (tindakan === 'fetchLakaranProxy') return teksBiasa(ambilLakaran(pengguna, p.id));
    return sendJson(ralat('Tindakan tidak dikenali.'));
  } catch (err) {
    return keluaranTeks ? teksBiasa('ERROR: ' + err.message) : sendJson(ralat(err.message));
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let p;
  try {
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return sendJson(ralat('Format permintaan tidak sah.'));
  }
  try {
    lock.waitLock(30000);
    if (p.action === 'login') return sendJson(logMasuk(p));

    const pengguna = sahkanPengguna(p.email || p.adminEmail, p.password || p.adminPassword);
    switch (p.action) {
      case 'simpanSemakan': return sendJson(simpanSemakan(pengguna, p));
      case 'adminUploadScript': return sendJson(muatNaikSkrip(pengguna, p));
      case 'lantikModerator': return sendJson(lantikModerator(pengguna, p));
      case 'kemaskiniKategoriP2': return sendJson(kemaskiniKategoriP2(pengguna, p));
      default: return sendJson(ralat('Tindakan tidak dikenali.'));
    }
  } catch (err) {
    return sendJson(ralat(err.message));
  } finally {
    try { lock.releaseLock(); } catch (_) { /* lock tidak diperoleh */ }
  }
}

/* ============================== PENGESAHAN ============================== */

function hashKataLaluan(teks) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, teks, Utilities.Charset.UTF_8));
}

function sahkanPengguna(emel, kataLaluan) {
  const e = String(emel || '').trim();
  const k = String(kataLaluan || '');
  if (!e || !k) throw new Error('Sila log masuk semula.');
  const rekod = bacaJadual(NAMA_HELAIAN.PENSYARAH).find(r => sama(r.email, e));
  if (!rekod || !benar(rekod.aktif) || String(rekod.passwordHash || '').trim() !== hashKataLaluan(k)) {
    throw new Error('Emel atau kata laluan tidak sah.');
  }
  return {
    email: String(rekod.email).trim(),
    nama: String(rekod.nama || ''),
    peranan: String(rekod.peranan || '').trim()
  };
}

function logMasuk(p) {
  try {
    const pengguna = sahkanPengguna(p.email, p.password);
    catatLog(pengguna.email, 'login', '', 'OK', 'Log masuk berjaya');
    return { status: 'success', email: pengguna.email, nama: pengguna.nama, peranan: pengguna.peranan };
  } catch (err) {
    catatLog(String(p.email || ''), 'login', '', 'GAGAL', err.message);
    return ralat(err.message);
  }
}

/* ============================== DATA ============================== */

function dapatDataUntukPengguna(pengguna) {
  const pensyarah = bacaJadual(NAMA_HELAIAN.PENSYARAH)
    .map(r => ({
      email: String(r.email).trim(),
      nama: String(r.nama || ''),
      peranan: String(r.peranan || ''),
      aktif: benar(r.aktif)
    }))
    .filter(r => r.email);

  let skrip = bacaJadual(NAMA_HELAIAN.SKRIP).map(bersih);
  let hasil = bacaJadual(NAMA_HELAIAN.HASIL).map(bersih);

  // Pensyarah biasa hanya melihat skrip yang berkaitan dengannya (dan semakan bagi skrip tersebut)
  if (!isAdmin(pengguna)) {
    skrip = skrip.filter(s => bolehSemak(pengguna, s));
    const angkaSet = new Set(skrip.map(s => String(s.angkaGiliran).trim()));
    hasil = hasil.filter(h => angkaSet.has(String(h.angkaGiliran).trim()));
  }

  let rubrikConfig = [];
  let rubrikRalat = '';
  try { rubrikConfig = bacaRubrik(); } catch (err) { rubrikRalat = err.message; }

  return {
    status: 'success',
    pensyarah: pensyarah,
    skripInduk: skrip,
    hasilSemakan: hasil,
    konfigurasi: bacaKonfigurasi(),
    rubrikConfig: rubrikConfig,
    rubrikRalat: rubrikRalat,
    versi: VERSI_BACKEND
  };
}

function ambilPdfBase64(pengguna, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('ID fail diperlukan.');
  const skrip = bacaJadual(NAMA_HELAIAN.SKRIP).find(r => String(r.urlSkrip || '').trim() === id);
  if (!skrip) throw new Error('Fail ini tidak dikaitkan dengan mana-mana skrip.');
  if (!bolehSemak(pengguna, skrip)) throw new Error('Akses ditolak.');
  return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes());
}

function ambilLakaran(pengguna, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('ID fail diperlukan.');
  const rujukan = RUJUKAN_DRIVE + id;
  const hasil = bacaJadual(NAMA_HELAIAN.HASIL).find(h => String(h.dataLakaran || '').trim() === rujukan);
  if (!hasil) throw new Error('Rekod lakaran tidak ditemui.');
  if (!isAdmin(pengguna)) {
    const skrip = bacaJadual(NAMA_HELAIAN.SKRIP).find(s => sama(s.angkaGiliran, hasil.angkaGiliran));
    if (!skrip || !bolehSemak(pengguna, skrip)) throw new Error('Akses ditolak.');
  }
  return DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
}

/* ============================== TINDAKAN TULIS ============================== */

/** Muat naik PDF skrip pelajar (1 sampel wakil kelas atau kes ekstrem). */
function muatNaikSkrip(pengguna, p) {
  const angka = String(p.angkaGiliran || '').trim();
  const fasa = String(p.fasaModerasi || '').trim();
  if (!angka) throw new Error('Angka giliran diperlukan.');
  if (FASA_SAH.indexOf(fasa) === -1) throw new Error('Jenis serahan tidak sah.');

  const markahMentah = String(p.markahPemeriksa === undefined ? '' : p.markahPemeriksa).trim();
  const markah = Number(markahMentah);
  if (markahMentah === '' || isNaN(markah) || markah < 0 || markah > MARKAH_MAKSIMUM) {
    throw new Error('Markah pemeriksa mesti antara 0 hingga 40.');
  }

  const sedia = bacaJadual(NAMA_HELAIAN.SKRIP).find(s => sama(s.angkaGiliran, angka));
  if (sedia && !isAdmin(pengguna) && !sama(sedia.emelPensyarah, pengguna.email)) {
    throw new Error('Angka giliran ini telah didaftarkan oleh pensyarah lain.');
  }

  const bahagian = String(p.fileData || '').match(/^data:[^;,]*;base64,(.+)$/);
  if (!bahagian) throw new Error('Fail PDF tidak sah.');
  const bait = Utilities.base64Decode(bahagian[1]);
  if (bait.length === 0 || bait.length > PDF_MAKS_BAIT) throw new Error('Saiz PDF kosong atau melebihi 20 MB.');
  if (bait[0] !== 0x25 || bait[1] !== 0x50 || bait[2] !== 0x44 || bait[3] !== 0x46) {
    throw new Error('Fail bukan PDF.');
  }

  const namaFail = 'Skrip_' + angka.replace(/[^\w-]/g, '_') + '.pdf';
  const fail = dapatFolder().createFile(Utilities.newBlob(bait, 'application/pdf', namaFail));

  tulisBaris(NAMA_HELAIAN.SKRIP, LAJUR.SkripInduk, s => sama(s.angkaGiliran, angka), {
    angkaGiliran: angka,
    emelPensyarah: pengguna.email,
    namaPensyarah: pengguna.nama,
    kumpulan: fasa,
    fasaModerasi: fasa,
    markahPemeriksa: markah,
    urlSkrip: fail.getId(),
    tarikhMuatNaik: new Date(),
    namaFail: namaFail
  });

  catatLog(pengguna.email, 'adminUploadScript', angka, 'OK', 'Skrip dimuat naik: ' + fasa);
  return { status: 'success', message: 'Skrip berjaya dimuat naik.', angkaGiliran: angka, urlSkrip: fail.getId() };
}

/** Simpan semakan P1 atau P2 bagi seorang pensyarah. Satu baris per (angka giliran, pensyarah). */
function simpanSemakan(pengguna, p) {
  const angka = String(p.angkaGiliran || '').trim();
  const skrip = cariSkrip(angka);
  if (!bolehSemak(pengguna, skrip)) throw new Error('Anda tidak dilantik untuk skrip ini.');

  const fasaSemasa = String(p.fasaSemasa || 'P1').trim().toUpperCase() === 'P2' ? 'P2' : 'P1';
  const A = Number(skrip.markahPemeriksa) || 0;

  const rubrikCfg = bacaRubrik();
  const nilaiRubrik = (p.rubrik && typeof p.rubrik === 'object') ? p.rubrik : {};
  const rubrikData = {};
  let jumlah = 0;
  rubrikCfg.forEach(r => {
    const mentah = nilaiRubrik[r.kod] !== undefined ? nilaiRubrik[r.kod] : p[r.kod];
    const kosong = mentah === undefined || mentah === null || mentah === '';
    const v = kosong ? 0 : Number(mentah);
    if (isNaN(v) || v < 0 || v > r.markah) throw new Error('Markah ' + r.kod + ' mesti antara 0 hingga ' + r.markah + '.');
    rubrikData[r.kod] = v;
    jumlah += v;
  });
  jumlah = bulat1(jumlah);
  const data = Object.assign({}, rubrikData);
  data.rubrikJson = JSON.stringify(rubrikData);

  data.angkaGiliran = angka;
  data.emelPensyarah = pengguna.email;
  data.namaPensyarah = pengguna.nama;
  data.fasaModerasi = skrip.fasaModerasi;
  data.markahPemeriksa = A;
  data.tarikhKemaskini = new Date();

  if (fasaSemasa === 'P2') {
    const mentahP2 = p.markahModerasiP2;
    const d = Number(mentahP2);
    if (mentahP2 === undefined || String(mentahP2).trim() === '' || isNaN(d) || d < 0 || d > MARKAH_MAKSIMUM) {
      throw new Error('Markah moderasi P2 mesti antara 0 hingga 40.');
    }
    data.markahModerasiP2 = d;
    data.perbezaanP2 = bulat1(d - A);
    data.markahAkhir = d;
  } else {
    data.markahModerasiP1 = jumlah;
    data.perbezaanP1 = bulat1(jumlah - A);
    data.markahAkhir = jumlah;
  }

  // Lakaran & ulasan: simpan dalam Sheet jika kecil, jika besar simpan sebagai fail JSON di Drive
  let lakaran = String(p.dataLakaran || '{}');
  try { JSON.parse(lakaran); } catch (err) { throw new Error('Data lakaran tidak sah.'); }

  const sedia = bacaJadual(NAMA_HELAIAN.HASIL).find(h => sama(h.angkaGiliran, angka) && sama(h.emelPensyarah, pengguna.email));

  if (lakaran.length > LAKARAN_MAKS_AKSARA) {
    const rujukanSedia = sedia ? String(sedia.dataLakaran || '').trim() : '';
    let fail;
    if (rujukanSedia.indexOf(RUJUKAN_DRIVE) === 0) {
      fail = DriveApp.getFileById(rujukanSedia.substring(RUJUKAN_DRIVE.length).trim());
      fail.setContent(lakaran);
    } else {
      fail = dapatFolder().createFile('lakaran_' + angka + '_' + pengguna.email + '.json', lakaran, 'application/json');
    }
    lakaran = RUJUKAN_DRIVE + fail.getId();
  }
  data.dataLakaran = lakaran;
  data.id = (sedia && sedia.id) ? sedia.id : Utilities.getUuid();

  tulisBaris(NAMA_HELAIAN.HASIL, LAJUR.HasilSemakan,
    h => sama(h.angkaGiliran, angka) && sama(h.emelPensyarah, pengguna.email), data);

  catatLog(pengguna.email, 'simpanSemakan', angka, 'OK', fasaSemasa + ' markah akhir ' + data.markahAkhir);
  return { status: 'success', message: 'Rekod semakan disimpan.', markahAkhir: data.markahAkhir };
}

/** Lantik moderator P1 dan P2 (admin/KJ sahaja). Hantar emel kepada moderator. */
function lantikModerator(pengguna, p) {
  if (!isAdmin(pengguna)) throw new Error('Hanya admin atau ketua jabatan boleh melantik moderator.');
  const angka = String(p.angkaGiliran || '').trim();
  const skrip = cariSkrip(angka);
  const p1 = String(p.p1Email || '').trim().toLowerCase();
  const p2 = String(p.p2Email || '').trim().toLowerCase();
  if (p1 && p2 && p1 === p2) throw new Error('Moderator P1 dan P2 tidak boleh sama.');

  const senarai = bacaJadual(NAMA_HELAIAN.PENSYARAH);
  const cari = emel => senarai.find(r => sama(r.email, emel));
  if (p1 && !cari(p1)) throw new Error('Emel moderator P1 tidak wujud dalam helaian Pensyarah.');
  if (p2 && !cari(p2)) throw new Error('Emel moderator P2 tidak wujud dalam helaian Pensyarah.');

  tulisBaris(NAMA_HELAIAN.SKRIP, LAJUR.SkripInduk, s => sama(s.angkaGiliran, angka), { emelP1: p1, emelP2: p2 });

  const dihantar = [];
  [[p1, 'Moderator P1'], [p2, 'Moderator P2']].forEach(([emel, peranan]) => {
    if (!emel) return;
    try {
      MailApp.sendEmail({
        to: emel,
        subject: '[MPU7011] Lantikan ' + peranan + ' — ' + angka,
        body: 'Tuan/Puan telah dilantik sebagai ' + peranan + ' bagi skrip angka giliran ' + angka +
              '. Sila log masuk ke Sistem Moderasi Digital IPG untuk menjalankan semakan.',
        name: 'Sistem Moderasi Digital IPG — MPU7011'
      });
      dihantar.push(emel);
    } catch (err) {
      Logger.log('Gagal hantar emel kepada ' + emel + ': ' + err.message);
    }
  });

  catatLog(pengguna.email, 'lantikModerator', angka, 'OK', 'P1=' + p1 + ' P2=' + p2);
  return {
    status: 'success',
    message: 'Moderator disimpan. Emel dihantar: ' + dihantar.length,
    emelDihantar: dihantar
  };
}

/** Tukar kategori P2 bagi skrip (admin/KJ sahaja). */
function kemaskiniKategoriP2(pengguna, p) {
  if (!isAdmin(pengguna)) throw new Error('Hanya admin atau ketua jabatan boleh menukar kategori.');
  const angka = String(p.angkaGiliran || '').trim();
  const kategori = String(p.kategoriBaru || '').trim();
  cariSkrip(angka);
  if (FASA_SAH.indexOf(kategori) === -1) throw new Error('Kategori tidak sah.');
  tulisBaris(NAMA_HELAIAN.SKRIP, LAJUR.SkripInduk, s => sama(s.angkaGiliran, angka), { fasaModerasi: kategori, kumpulan: kategori });
  catatLog(pengguna.email, 'kemaskiniKategoriP2', angka, 'OK', kategori);
  return { status: 'success', message: 'Kategori dikemas kini.' };
}

/** Baca dan sahkan rubrik daripada helaian TetapanRubrik. Dilempar ralat jika tidak sah. */
function bacaRubrik() {
  const senarai = bacaJadual(NAMA_HELAIAN.RUBRIK).map(r => ({
    kod: String(r.kod || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    hp: String(r.hp || '').trim(),
    perincian: String(r.perincian || '').trim(),
    markah: Number(r.markah),
    susunan: Number(r.susunan) || 0
  })).filter(r => r.kod && r.hp && r.perincian);

  if (senarai.length === 0) throw new Error('Helaian TetapanRubrik kosong. Isi perincian rubrik dahulu.');

  const kodDiguna = {};
  senarai.forEach(r => {
    if (!(r.markah > 0)) throw new Error('Markah untuk ' + r.kod + ' mesti nombor lebih daripada 0.');
    if (LAJUR_SISTEM_HASIL.map(c => c.toLowerCase()).indexOf(r.kod) !== -1) throw new Error('Kod rubrik "' + r.kod + '" digunakan oleh sistem. Tukar kodnya.');
    if (kodDiguna[r.kod]) throw new Error('Kod rubrik berganda: ' + r.kod);
    kodDiguna[r.kod] = true;
  });

  const jumlah = senarai.reduce((a, r) => a + r.markah, 0);
  if (jumlah > MARKAH_MAKSIMUM) throw new Error('Jumlah markah rubrik ' + jumlah + ' melebihi ' + MARKAH_MAKSIMUM + '.');

  senarai.sort((a, b) => a.susunan - b.susunan);
  return senarai;
}

/* ============================== UTILITI SHEET ============================== */

function dapatHelaian(nama) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nama);
  if (!sh) throw new Error('Helaian "' + nama + '" tidak wujud. Jalankan setupSistem() sekali.');
  return sh;
}

/** Baca helaian sebagai senarai objek (kunci = header baris 1). Setiap objek ada _baris (nombor baris sebenar). */
function bacaJadual(nama) {
  const nilai = dapatHelaian(nama).getDataRange().getValues();
  if (nilai.length < 2) return [];
  const header = nilai[0].map(h => String(h).trim());
  const senarai = [];
  for (let i = 1; i < nilai.length; i++) {
    if (nilai[i].every(c => c === '' || c === null)) continue;
    const obj = { _baris: i + 1 };
    header.forEach((h, j) => { if (h) obj[h] = nilai[i][j]; });
    senarai.push(obj);
  }
  return senarai;
}

/** Buang medan dalaman dan tukar Date kepada teks ISO sebelum dihantar kepada frontend. */
function bersih(obj) {
  const o = {};
  Object.keys(obj).forEach(k => {
    if (k === '_baris') return;
    const v = obj[k];
    o[k] = v instanceof Date ? v.toISOString() : v;
  });
  return o;
}

/** Pastikan header lajur wujud; tambah yang hilang di hujung. Pulang senarai header. */
function pastikanLajur(sh, lajur) {
  const bil = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, bil).getValues()[0].map(h => String(h).trim());
  lajur.forEach(l => {
    if (header.indexOf(l) === -1) {
      header.push(l);
      sh.getRange(1, header.length).setValue(l);
    }
  });
  return header;
}

/** Cari baris yang memenuhi syarat; kemaskini medan dalam `data`, atau tambah baris baharu jika tiada. */
function tulisBaris(nama, lajur, syarat, data) {
  const sh = dapatHelaian(nama);
  const header = pastikanLajur(sh, lajur);
  const nilai = sh.getDataRange().getValues();
  const adaData = h => Object.prototype.hasOwnProperty.call(data, h) && data[h] !== undefined;

  let idx = -1;
  for (let i = 1; i < nilai.length && idx === -1; i++) {
    const obj = {};
    header.forEach((h, j) => { obj[h] = nilai[i][j]; });
    if (syarat(obj)) idx = i;
  }

  if (idx === -1) {
    sh.appendRow(header.map(h => (adaData(h) ? data[h] : '')));
    return { baris: sh.getLastRow(), baru: true };
  }

  const baris = header.map((h, j) => {
    if (adaData(h)) return data[h];
    return nilai[idx][j] !== undefined ? nilai[idx][j] : '';
  });
  sh.getRange(idx + 1, 1, 1, header.length).setValues([baris]);
  return { baris: idx + 1, baru: false };
}

function cariSkrip(angka) {
  const s = bacaJadual(NAMA_HELAIAN.SKRIP).find(r => sama(r.angkaGiliran, angka));
  if (!s) throw new Error('Angka giliran ' + angka + ' tiada dalam helaian SkripInduk. Muat naik skrip dahulu.');
  return bersih(s);
}

function bacaKonfigurasi() {
  const obj = {};
  bacaJadual(NAMA_HELAIAN.KONFIG).forEach(r => {
    if (r.kunci) obj[String(r.kunci).trim()] = r.nilai;
  });
  return obj;
}

/** Dapatkan folder Drive simpanan. Jika driveFolderId kosong, cipta folder baharu dan simpan ID-nya. */
function dapatFolder() {
  const id = String(bacaKonfigurasi().driveFolderId || '').trim();
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      throw new Error('driveFolderId dalam helaian Konfigurasi tidak sah atau akaun ini tiada akses: ' + err.message);
    }
  }
  const folder = DriveApp.createFolder(NAMA_FOLDER_DEFAULT);
  tulisBaris(NAMA_HELAIAN.KONFIG, LAJUR.Konfigurasi, r => sama(r.kunci, 'driveFolderId'),
    { kunci: 'driveFolderId', nilai: folder.getId(), catatan: 'Folder simpanan PDF dan anotasi (dicipta automatik)' });
  return folder;
}

function catatLog(email, tindakan, angka, status, mesej) {
  try {
    tulisBaris(NAMA_HELAIAN.LOG, LAJUR.LogAktiviti, () => false, {
      timestamp: new Date(), email: email, action: tindakan, angkaGiliran: angka, status: status, mesej: mesej
    });
  } catch (err) {
    Logger.log('Gagal catat log: ' + err.message);
  }
}

/* ============================== UTILITI UMUM ============================== */

function berkaitan(pengguna, skrip) {
  return sama(skrip.emelPensyarah, pengguna.email) || sama(skrip.emelP1, pengguna.email) || sama(skrip.emelP2, pengguna.email);
}

/** Sampel Moderasi (Kelompok ...) dibuka kepada semua pensyarah. Kes Ekstrem hanya untuk P1/P2 yang dilantik. */
function ialahSampel(skrip) {
  return String(skrip.fasaModerasi || '').trim().indexOf('Kelompok') === 0;
}

function bolehSemak(pengguna, skrip) {
  if (isAdmin(pengguna)) return true;
  if (ialahSampel(skrip)) return true;
  return sama(skrip.emelP1, pengguna.email) || sama(skrip.emelP2, pengguna.email);
}

function isAdmin(pengguna) {
  return PERANAN_ADMIN.indexOf(String(pengguna.peranan || '').trim().toLowerCase()) !== -1;
}

function sama(a, b) {
  return String(a === null || a === undefined ? '' : a).trim().toLowerCase() ===
         String(b === null || b === undefined ? '' : b).trim().toLowerCase();
}

function benar(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function bulat1(x) {
  return Math.round(x * 10) / 10;
}

function sendJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function teksBiasa(teks) {
  return ContentService.createTextOutput(String(teks)).setMimeType(ContentService.MimeType.TEXT);
}

function ralat(mesej) {
  return { status: 'error', message: mesej };
}

/* ============================== PENYEDIAAN ============================== */

/** Jalankan SEKALI selepas tampal Code.gs: cipta helaian, header, akaun demo dan folder Drive. */
function setupSistem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(LAJUR).forEach(nama => {
    const sh = ss.getSheetByName(nama) || ss.insertSheet(nama);
    if (sh.getLastRow() === 0) sh.appendRow(LAJUR[nama]);
    else pastikanLajur(sh, LAJUR[nama]);
  });

  if (bacaJadual(NAMA_HELAIAN.PENSYARAH).length === 0) {
    const h = hashKataLaluan('Tukar123!');
    const kini = new Date();
    ss.getSheetByName(NAMA_HELAIAN.PENSYARAH).getRange(2, 1, 3, LAJUR.Pensyarah.length).setValues([
      ['admin@ipgm.edu.my', 'Admin Demo', 'Admin', h, true, kini],
      ['kj@ipgm.edu.my', 'Ketua Jabatan Demo', 'Ketua Jabatan', h, true, kini],
      ['pensyarah@ipgm.edu.my', 'Pensyarah Demo', 'Pensyarah', h, true, kini]
    ]);
  }

  const kon = bacaKonfigurasi();
  [
    ['namaSistem', 'Sistem Moderasi Digital IPG — MPU7011', ''],
    ['ambangModerasi', 2, 'Perbezaan markah yang mencetuskan Pusingan 2'],
    ['namaInstitusi', 'IPG KAMPUS DARULAMAN', ''],
    ['kodSubjek', 'MPU7011', 'Kod kursus/subjek'],
    ['namaSubjek', 'NAMA SUBJEK BAHARU (SILA UBAH)', 'Nama subjek — sila ubah nilai ini'],
    ['driveFolderId', '', 'Folder simpanan PDF dan anotasi']
  ].forEach(([k, n, c]) => {
    if (kon[k] === undefined) {
      tulisBaris(NAMA_HELAIAN.KONFIG, LAJUR.Konfigurasi, r => sama(r.kunci, k), { kunci: k, nilai: n, catatan: c });
    }
  });

  if (bacaJadual(NAMA_HELAIAN.RUBRIK).length === 0) {
    ss.getSheetByName(NAMA_HELAIAN.RUBRIK).getRange(2, 1, 10, LAJUR.TetapanRubrik.length).setValues([
      ['hp1_a1', 'HP1', 'A1. Pengenalan, Konsep & Rasional', 5, 1],
      ['hp1_a2', 'HP1', 'A2. Rekaan Logo & Moto', 5, 2],
      ['hp1_b1', 'HP1', 'B1. Struktur AJK & Perlembagaan', 5, 3],
      ['hp1_b2', 'HP1', 'B2. Takwim Aktiviti Tahunan', 5, 4],
      ['hp1_c1', 'HP1', 'C1. Carta Alir & Surat Permohonan', 5, 5],
      ['hp1_c2', 'HP1', 'C2. Analisis Mitigasi Risiko', 5, 6],
      ['hp5_d1', 'HP5', 'D1. Kelancaran & Koheren Idea', 2.5, 7],
      ['hp5_d2', 'HP5', 'D2. Justifikasi & Keyakinan Hujah', 2.5, 8],
      ['hp5_d3', 'HP5', 'D3. Keaslian Idea & Laras Bahasa', 2.5, 9],
      ['hp5_d4', 'HP5', 'D4. Ketepatan Tatabahasa & APA 7', 2.5, 10]
    ]);
  }

  const folder = dapatFolder();
  Logger.log('setupSistem selesai. Folder Drive: ' + folder.getId());
}
