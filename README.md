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
curl http://localhost:3000/health
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

1. Membuat Event:
```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Konser Musik Akbar",
    "startsAt": "2026-12-31T20:00:00.000Z",
    "tickets": {
      "reguler": { "price": 75000, "quota": 100 },
      "vip": { "price": 200000, "quota": 25 }
    }
  }'
```

2. Melihat Event:
```bash
curl http://localhost:3000/events/<EVENT_ID>
```

3. Membuat Pesanan:
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "X-Buyer-Id: buyer-123" \
  -d '{
    "ticketTypeId": "<TICKET_TYPE_ID>",
    "quantity": 2
  }'
```

4. Melihat Riwayat Pesanan:
```bash
curl http://localhost:3000/orders \
  -H "X-Buyer-Id: buyer-123"
```

5. Membatalkan Pesanan:
```bash
curl -X POST http://localhost:3000/orders/<ORDER_ID>/cancel \
  -H "X-Buyer-Id: buyer-123"
```

## Menandai Pesanan Sebagai Paid

Pesanan yang berstatus pending dan belum kedaluwarsa dapat ditandai sebagai paid melalui dua cara:

### Cara 1: Menggunakan Endpoint Simulasi Bayar

```bash
curl -X POST http://localhost:3000/orders/<ORDER_ID>/pay
```

Response mengembalikan detail pesanan berserta daftar kode tiket (`tickets` dan `ticketCodes`). Pemanggilan berulang pada endpoint ini bersifat idempoten dan mengembalikan tiket yang sama.

### Cara 2: Menggunakan Webhook Pembayaran (HMAC-SHA256 Signed)

Endpoint `POST /webhooks/payment` menerima notifikasi pembayaran dari payment provider dengan verifikasi signature HMAC-SHA256 pada header `X-Signature`.

Contoh payload:
```json
{
  "eventId": "evt_test_001",
  "orderId": "<ORDER_ID>",
  "status": "success"
}
```

Contoh eksekusi cURL dengan penandatanganan OpenSSL:

```bash
WEBHOOK_SECRET="dev-webhook-secret"
ORDER_ID="<ORDER_ID>"
BODY="{\"eventId\":\"evt_001\",\"orderId\":\"$ORDER_ID\",\"status\":\"success\"}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $NF}')

curl -X POST http://localhost:3000/webhooks/payment \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

Jika signature tidak valid, server mengembalikan status 401 UNAUTHORIZED.

## Menjalankan Pengujian (Tests)

Pastikan container database PostgreSQL berjalan:

```bash
docker compose up -d db
```

Jalankan test suite menggunakan Vitest:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ticket_db npm test
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
