# Architectural & Design Decisions

File terkait catatan mengenai keputusan arsitektur yang digunakan dalam API Penjualan Tiket, alasan pemilihannya, pilihan lain yang sempat dipertimbangkan, hal-hal yang harus dikorbankan, serta batasan yang ada pada sistem.

---

## 1. Pencegahan Oversell (Anti-Oversell)

- **Keputusan**: Menggunakan conditional update secara atomik melalui query `UPDATE ticket_types SET available = available - q WHERE id = :id AND available >= q RETURNING *`. Selain itu, ditambahkan database check constraint `available >= 0 AND available <= quota` untuk menjaga supaya jumlah tiket tetap sesuai dengan batas kuota.
- **Alasan**: PostgreSQL dapat menjalankan proses perubahan data secara bersamaan dengan aman menggunakan row-level write lock. Jika jumlah tiket yang tersedia tidak mencukupi permintaan, query tidak akan mengubah data dan mengembalikan 0 baris. Artinya stok sudah tidak cukup, sehingga pesanan ditolak dengan 409 SOLD_OUT. Check constraint juga dipakai supaya jumlah tiket tidak pernah negatif atau melebihi kuota.
- **Alternatif yang Dipertimbangkan**:
  - **SELECT FOR UPDATE**: Membutuhkan dua proses query, yaitu read data terlebih dahulu lalu baru update. Cara ini membuat database harus menahan lock lebih lama.
  - **Optimistic Concurrency Control (Version Column)**: Membutuhkan proses pengulangan request ketika terjadi perubahan data secara bersamaan. Jika banyak pengguna memesan tiket pada waktu yang sama, beban sistem bisa meningkat.
- **Trade-off**: Pemesanan tiket dengan jenis yang sama akan diproses secara bergantian karena adanya row lock di PostgreSQL. Namun proses transaksi berlangsung sangat singkat sehingga sistem tetap bisa menangani banyak permintaan pemesanan dengan baik.

---

## 2. Pembatasan 4 Tiket per Buyer per Event

- **Keputusan**: Menggunakan PostgreSQL transaction advisory lock `pg_advisory_xact_lock(hashtext(buyer_id || ':' || event_id))` di dalam transaksi sebelum menghitung `SUM(quantity)` dari pesanan berstatus `paid` serta `pending` yang belum kedaluwarsa.
- **Alasan**: Advisory lock mengunci kombinasi entitas pembeli dan event secara eksklusif selama transaksi berlangsung tanpa memblokir pembeli lain atau mengunci tabel secara luas. Lock ini otomatis dilepaskan saat transaksi commit atau rollback.
- **Alternatif yang Dipertimbangkan**:
  - *Pengecekan tanpa Lock*: Sangat rentan terhadap race condition jika satu buyer meluncurkan banyak request serentak dalam milidetik yang sama.
  - *Kunci di Redis (SETNX)*: Rawan kebocoran kunci jika node server mati sebelum kunci dihapus, serta memerlukan pengelolaan TTL dan renewal lock yang kompleks.
- **Trade-off**: Fungsi bawaan `hashtext()` memiliki kemungkinan kecil terjadi hash collision integer 32-bit. Pada kasus collision langka tersebut, dua buyer berbeda yang mengalami benturan hash akan mengantre sejenak satu sama lain tanpa memengaruhi kebenaran data.

---

## 3. Manajemen Kedaluwarsa Pesanan (Hold 15 Menit)

- **Keputusan**: Menggunakan referensi waktu database `now()` (bukan jam Node.js/JavaScript), dilengkapi proses sweeper periodik setiap 10 detik menggunakan kueri `UPDATE ... WHERE id IN (SELECT id FROM orders WHERE status = 'pending' AND expires_at <= now() FOR UPDATE SKIP LOCKED)` dan mekanisme lazy expiry pada pembacaan/pembuatan order.
- **Alasan**: Penggunaan jam database mencegah anomali akibat perbedaan waktu (clock skew) antarmesin server. Klausul `FOR UPDATE SKIP LOCKED` memastikan bahwa baris yang sedang diproses oleh worker atau transaksi lain dilewati, sehingga kuota dikembalikan tepat satu kali tanpa risiko deadlock.
- **Alternatif yang Dipertimbangkan**:
  - *Murni Lazy Expiry*: Kuota tidak akan kembali sampai ada pengguna lain yang mengakses sistem atau membeli tiket tersebut.
  - *Murni Cron Luar (misal crontab OS)*: Menambah dependensi konfigurasi sistem operasi dan berisiko terlambat membersihkan pesanan.
  - *Redis Key Expiration Notification*: Sifat pengiriman notifikasi Redis bersifat best-effort; jika subscriber sedang terputus, event pembatalan bisa hilang selamanya.
- **Trade-off**: Sweeper interval 10 detik melakukan polling berkala ke database meskipun tidak ada pesanan yang sedang kedaluwarsa.

---

## 4. Idempotensi Pembayaran & Penerbitan Tiket

- **Keputusan**: Menggunakan pembaruan bersyarat `UPDATE orders SET status = 'paid', paid_at = now() WHERE id = :id AND status = 'pending' AND expires_at > now() RETURNING *` dipadukan dengan unique constraint `unique(order_id, seq)` pada tabel `tickets`.
- **Alasan**: Hanya ada satu transaksi yang dapat mengubah status pesanan dari pending menjadi paid. Pemanggilan kedua pada endpoint bayar mendeteksi pesanan telah berstatus paid dan langsung membaca tiket yang sudah ada, menjamin bahwa kode tiket tidak pernah dibuat ulang.
- **Alternatif yang Dipertimbangkan**:
  - *Cek status di aplikasi lalu terbitkan tiket (read-then-write)*: Dua request bayar yang bersamaan sama-sama membaca status pending lalu sama-sama menerbitkan tiket, sehingga tiket ganda. Dengan update bersyarat, database yang menentukan hanya satu pemenang.
- **Trade-off**: Perlu percabangan logika untuk mengambil tiket yang telah dibuat sebelumnya agar mengembalikan response seragam pada pemanggilan ulang.

---

## 5. Idempotensi Webhook Pembayaran

- **Keputusan**: Membuat tabel `webhook_events` dengan primary key `provider_event_id`, di mana pencatatan event dan pemrosesan status order dieksekusi dalam **satu transaksi database tunggal** dengan `INSERT ... ON CONFLICT (provider_event_id) DO NOTHING`.
- **Alasan**: Payment provider (seperti Stripe, Xendit, atau Midtrans) sering melakukan retry pengiriman webhook akibat latensi jaringan. Jika event id yang sama diterima ulang, constraint primary key memicu kondisi conflict sehingga sistem langsung mengembalikan status 200 dengan outcome tersimpan tanpa memodifikasi data order lagi.
- **Alternatif yang Dipertimbangkan**:
  - *Pencatatan webhook di memori atau Redis*: Risiko pemrosesan ganda jika dua webhook identik tiba bersamaan sebelum state di memori disinkronkan ke basis data.
- **Trade-off**: Memerlukan kapasitas penyimpanan tambahan untuk tabel audit log webhook event di PostgreSQL.

---

## 6. Kebijakan Late Webhook (Webhook Terlambat)

- **Keputusan**: Jika notifikasi sukses tiba untuk pesanan yang sudah kedaluwarsa (`expires_at <= now()`) atau telah dibatalkan, tiket **tidak diterbitkan** dan kuota tiket **tidak diambil lagi dari stok**. Sistem mencatat outcome `LATE_NOT_ISSUED` dan tetap mengembalikan HTTP 200 ke provider.
- **Alasan**: Ketika pesanan kedaluwarsa, kuota telah dikembalikan ke stok dan mungkin sudah dibeli oleh pelanggan lain. Menerbitkan tiket pada pesanan kedaluwarsa akan menyebabkan tiket terjual melebihi kapasitas fisik venue (overselling nyata). Mengembalikan HTTP 200 bertujuan agar provider menghentikan pengiriman retry. Di lingkungan produksi nyata, kejadian ini memicu instruksi otomatisasi pengembalian dana (refund) kepada pelanggan.
- **Alternatif yang Dipertimbangkan**:
  - *Memaksakan penerbitan tiket*: Berakibat fatal pada kapasitas fisik tempat acara.
  - *Mengembalikan error 4xx/5xx*: Menyebabkan webhook provider terus melakukan retry eksponensial tanpa mengubah fakta bahwa pesanan telah kedaluwarsa.
- **Trade-off**: Pembeli yang terlambat menyelesaikan pembayaran tidak mendapatkan tiket dan proses penyelesaian harus dialihkan ke alur refund.

---

## 7. Batasan Sistem yang Diketahui (Known Limitations)

1. **Keamanan Multi-Instance Sweeper**: Walaupun pemanggilan `setInterval` berada di dalam file entrypoint `src/index.ts`, implementasi query sweeper menggunakan `FOR UPDATE SKIP LOCKED`. Artinya, jika sistem dijalankan pada beberapa kontainer/instance secara paralel, setiap kontainer dapat menjalankan sweeper tanpa saling mengunci (deadlock) dan tanpa risiko mengembalikan kuota tiket yang sama dua kali.
2. **Ketiadaan Otentikasi Pengguna (Trusted Buyer ID)**: Sesuai batasan spesifikasi proyek, identitas pembeli dibaca langsung dari header `X-Buyer-Id` tanpa verifikasi token otentikasi (JWT/OAuth). Pada sistem produksi publik, header ini wajib divalidasi oleh API Gateway atau middleware otentikasi.
3. **Jeda Pengembalian Kuota**: Kuota dari pesanan kedaluwarsa bisa kembali dengan jeda hingga 10 detik karena sweeper berkala. Dampaknya kecil karena GET /events dan POST /orders juga menjalankan pembersihan sebelum membaca stok.
4. **Penyimpanan Payload Webhook**: Payload JSON disimpan langsung di kolom `jsonb`. Di skala enterprise dengan jutaan event, tabel ini memerlukan strategi partisi berbasis waktu (*range partitioning*) atau pengarsipan berkala.
