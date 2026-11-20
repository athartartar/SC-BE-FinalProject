# Ticket Booking API

API penjualan tiket event dengan penanganan kuota terbatas berbasis Node.js, TypeScript, Hono, Drizzle ORM, dan PostgreSQL.

## Fitur Utama

- Manajemen event dan jenis tiket (Reguler, VIP).
- Hold tiket selama 15 menit dengan status pending.
- Anti-oversell berbasis atomic conditional update dan database check constraint.
- Pembatasan maksimal 4 tiket per buyer per event via PostgreSQL advisory transaction locks.
- Sweeper berkala (10 detik) dan lazy expiry on read untuk mengembalikan kuota order kedaluwarsa.
- Pembayaran simulasi (`POST /orders/:id/pay`) yang idempoten dan menerbitkan kode tiket unik (`TKT-...`).
- Webhook pembayaran (`POST /webhooks/payment`) idempoten dengan verifikasi HMAC-SHA256 timing-safe.
- Teruji menangani beban konkurensi tinggi (200 pemesanan simultan).

## Coba Cepat

1. Jalankan aplikasi dan database:
```bash
docker compose up --build
```

2. Buka terminal baru, masuk ke folder proyek, instal dependensi satu kali (jika belum), lalu jalankan skrip demo:
```bash
npm install
npm run demo
```

Untuk menjalankan demo mode presentasi (menunggu penekanan Enter di setiap langkah):
- **Bash / Linux / macOS / Git Bash:** `DEMO_PAUSE=1 npm run demo`
- **PowerShell (Windows):** `$env:DEMO_PAUSE="1"; npm run demo`
- **Command Prompt (Windows CMD):** `set DEMO_PAUSE=1&& npm run demo`

> **Penting:** Semua perintah `npm` harus dijalankan dari dalam folder proyek.

## Prasyarat

- Docker & Docker Compose

## Menjalankan Aplikasi

Jalankan perintah berikut:

```bash
docker compose up --build
```

Aplikasi berjalan pada port `3000` dan PostgreSQL berjalan pada port `5432`. Migrasi database akan dieksekusi secara otomatis saat aplikasi dinyalakan.

Untuk memeriksa status aplikasi:

```bash
curl "http://localhost:3000/health"
```

## Daftar Endpoint API

| Method | Endpoint | Header Wajib | Deskripsi |
|---|---|---|---|
| GET | `/health` | - | Health check status database & API |
| POST | `/events` | - | Membuat event baru dengan tiket Reguler & VIP |
| GET | `/events/:id` | - | Mengambil detail event dan sisa kuota tiket |
| POST | `/orders` | `X-Buyer-Id: <id>` | Membuat pesanan tiket baru |
| GET | `/orders` | `X-Buyer-Id: <id>` | Mengambil riwayat pesanan milik buyer |
| GET | `/orders/:id` | `X-Buyer-Id: <id>` | Mengambil detail pesanan dan tiket milik buyer |
| POST | `/orders/:id/cancel` | `X-Buyer-Id: <id>` | Membatalkan pesanan pending dan mengembalikan kuota |
| POST | `/orders/:id/pay` | - | Simulasi pembayaran pesanan pending |
| POST | `/webhooks/payment` | `X-Signature: <hex>` | Webhook notifikasi pembayaran dari provider |

### Contoh Penggunaan cURL

> **Catatan:** Seluruh contoh perintah cURL di bawah ini ditulis dalam format satu baris menggunakan tanda kutip ganda (double quotes) tanpa backslash sehingga kompatibel di berbagai sistem operasi: Windows CMD, Git Bash, Linux, dan macOS. Bagi pengguna Windows PowerShell, gunakan `curl.exe` (bukan alias bawaan `curl`). Anda juga dapat menggunakan aplikasi HTTP client seperti Postman atau Insomnia.

1. Membuat Event:
```bash
curl -X POST "http://localhost:3000/events" -H "Content-Type: application/json" -d @examples/create-event.json
```

2. Melihat Event:
Ganti teks `<EVENT_ID>` dengan nilai asli tanpa tanda `< >`; ID didapat dari response langkah sebelumnya.
```bash
curl "http://localhost:3000/events/<EVENT_ID>"
```

3. Membuat Pesanan:
Ganti teks `<TICKET_TYPE_ID>` dengan nilai asli tanpa tanda `< >`; ID didapat dari response langkah sebelumnya. Sesuaikan nilai `ticketTypeId` pada file `examples/create-order.json` sebelum menjalankan perintah berikut:
```bash
curl -X POST "http://localhost:3000/orders" -H "Content-Type: application/json" -H "X-Buyer-Id: buyer-123" -d @examples/create-order.json
```

4. Melihat Riwayat Pesanan:
```bash
curl "http://localhost:3000/orders" -H "X-Buyer-Id: buyer-123"
```

5. Membatalkan Pesanan:
Ganti teks `<ORDER_ID>` dengan nilai asli tanpa tanda `< >`; ID didapat dari response langkah sebelumnya.
```bash
curl -X POST "http://localhost:3000/orders/<ORDER_ID>/cancel" -H "X-Buyer-Id: buyer-123"
```

## Menandai Pesanan Sebagai Paid

Pesanan yang berstatus pending dan belum kedaluwarsa dapat ditandai sebagai paid melalui dua cara:

### Cara 1: Menggunakan Endpoint Simulasi Bayar

Ganti teks `<ORDER_ID>` dengan nilai asli tanpa tanda `< >`; ID didapat dari response langkah sebelumnya.
```bash
curl -X POST "http://localhost:3000/orders/<ORDER_ID>/pay"
```

Response mengembalikan detail pesanan berserta daftar kode tiket (`tickets` dan `ticketCodes`). Pemanggilan berulang pada endpoint ini bersifat idempoten dan mengembalikan tiket yang sama.

### Cara 2: Menggunakan Webhook Pembayaran (HMAC-SHA256 Signed)

Endpoint `POST /webhooks/payment` menerima notifikasi pembayaran dari payment provider dengan verifikasi signature HMAC-SHA256 pada header `X-Signature`.

Contoh payload (blok JSON di bawah adalah body permintaan yang dikirimkan, bukan perintah yang dijalankan di terminal):
```json
{
  "eventId": "evt_test_001",
  "orderId": "<ORDER_ID>",
  "status": "success"
}
```

Untuk mengirim notifikasi webhook dengan signature yang valid secara otomatis dan lintas platform, gunakan script pembantu:

Ganti teks `<ORDER_ID>` dengan nilai asli tanpa tanda `< >`; ID didapat dari response langkah sebelumnya.
```bash
npm run webhook:send -- <ORDER_ID> success
```

Untuk menguji duplicate delivery (pengiriman duplikat), jalankan perintah dua kali dengan memberikan argumen `eventId` yang sama:

Ganti teks `<ORDER_ID>` dengan nilai asli tanpa tanda `< >`; ID didapat dari response langkah sebelumnya.
```bash
npm run webhook:send -- <ORDER_ID> success evt-duplikat-123
npm run webhook:send -- <ORDER_ID> success evt-duplikat-123
```

Panggilan kedua akan dikenali sebagai event duplikat (idempoten) dan tidak akan menerbitkan tiket baru.

Jika signature tidak valid, server mengembalikan status 401 UNAUTHORIZED.

## Menjalankan Pengujian (Tests)

Pastikan seluruh perintah dijalankan dari dalam folder proyek dan container database PostgreSQL sudah berjalan:

```bash
docker compose up -d db
```

Jalankan test suite menggunakan Vitest sesuai sistem operasi dan shell yang Anda gunakan:

**Bash / Linux / macOS / Git Bash:**
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ticket_db npm test
```

**PowerShell (Windows):**
```powershell
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/ticket_db"; npm test
```

**Command Prompt (Windows CMD):**
```cmd
set DATABASE_URL=postgres://postgres:postgres@localhost:5432/ticket_db&& npm test
```

## Alur CI/CD

Pipeline CI/CD dikonfigurasi melalui GitHub Actions pada file `.github/workflows/ci.yml`:
1. **Job Test**: Menjalankan PostgreSQL service container, menginstal dependensi, melakukan type-check build (`npm run build`), dan menjalankan seluruh test suite (`npm test`).
2. **Job Docker**: Berjalan setelah job test berhasil. Membangun image Docker produksi multi-stage dan mempublikasikannya ke GitHub Container Registry (`ghcr.io`). Image diberi tag commit SHA serta tag `latest` ketika merge ke default branch.

## Bukti Konkurensi 200 Pemesanan (Concurrency Proof)

Untuk membuktikan ketahanan sistem terhadap race condition dan overselling, skrip `scripts/load-test.mjs` mengeksekusi 200 permintaan pesanan secara serentak (`Promise.all`) dengan 200 buyer berbeda terhadap event dengan kuota 100.

Jalankan:

```bash
npm run load:test
```

Output aktual pengujian:

```
=== Concurrency Load Test Result ===
Target URL:       http://localhost:3000
Event ID:         f95ba54e-6393-440e-83d6-2498856467fa
Initial Quota:    100
Total Requests:   200
Created (201):    100
Sold Out (409):   100
Other Status:     0
Final Available:  0
```

Hasil membuktikan tepat 100 transaksi berhasil dibuat (201 Created), 100 transaksi ditolak karena kehabisan kuota (409 SOLD_OUT), dan sisa kuota akhir tepat 0 tanpa terjadinya overselling maupun nilai kuota negatif.
