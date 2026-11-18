# Pemulihan Web App Moderasi MPU7011

Pakej ini mengandungi `index.html`, `Code.gs` dan `MPU7011_Sheet_Template.xlsx`.

## Tetapan kod dan nama subjek

Kod subjek telah ditetapkan kepada `MPU7011`. Selepas `setupSistem()` dijalankan, buka helaian `Konfigurasi` dan ubah nilai `namaSubjek` kepada nama subjek sebenar. Anda juga boleh mengubah `kodSubjek` jika diperlukan; HTML akan membaca kedua-dua nilai ini secara automatik.

## Cara pasang

1. Cipta Google Sheet baharu dan import kandungan `MPU7011_Sheet_Template.xlsx`, atau gunakan Sheet kosong.

1. Buka **Extensions > Apps Script** daripada Sheet tersebut. Tampal kandungan `Code.gs` sebagai fail `Code.gs`.

1. Jalankan fungsi `setupSistem()` sekali. Berikan kebenaran Google untuk Sheets, Drive dan Mail.

1. Pastikan helaian berikut wujud: `Pensyarah`, `SkripInduk`, `HasilSemakan`, `Konfigurasi`, `LogAktiviti`.

1. Tukar kata laluan demo dalam helaian `Pensyarah`. Nilai demo asal ialah `Tukar123!`.

1. Deploy sebagai **Web app**: Execute as **Me**, akses **Anyone**. Salin URL yang berakhir dengan `/exec`.

1. Dalam `index.html`, gantikan `PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` dengan URL tersebut.

1. Hoskan `index.html` pada lokasi yang sama/diizinkan oleh organisasi. Jika menggunakan Apps Script HTML Service, namakan fail HTML sebagai `index.html` dan tambah `return HtmlService.createHtmlOutputFromFile('index');` dalam `doGet` hanya jika mahu host frontend melalui Apps Script.

## Akaun demo

- `admin@ipgm.edu.my` / `Tukar123!`

- `kj@ipgm.edu.my` / `Tukar123!`

- `pensyarah@ipgm.edu.my` / `Tukar123!`

Tukar semua kata laluan sebelum penggunaan sebenar. Backend menyimpan kata laluan sebagai hash SHA-256 dalam helaian `Pensyarah`.

## Nota penting

- PDF dan fail anotasi besar disimpan dalam folder Drive `MPU7011 - Fail Moderasi`; ID folder disimpan dalam Script Properties.

- `urlSkrip` menyimpan ID fail Drive, bukan URL biasa. Ini diperlukan oleh proxy PDF dalam frontend.

- Had perbezaan moderasi asal ialah 2.0 markah dan boleh diubah dalam `Konfigurasi`.

- Selepas menukar `Code.gs` atau konfigurasi, buat deployment baharu/version baharu dan pastikan frontend menggunakan URL deployment yang betul.

- Jangan kongsi URL web app atau helaian dengan pengguna yang tidak sepatutnya mempunyai akses. Untuk produksi, pertimbangkan kawalan domain IPG dan sistem token/session yang lebih ketat.
