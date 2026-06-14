# AnimaKita — React Frontend

## Cara Menjalankan

```bash
npm install
npm run dev
```

Buka → `http://localhost:5173`

**Tidak perlu server proxy terpisah.** Vite sudah menangani CORS langsung via konfigurasi proxy di `vite.config.js`.

## Cara kerjanya

```
Browser → localhost:5173/api/home/ongoing.php
  ↓ (Vite proxy, server-side)
AnimaKita → apps.animekita.org/api/v1.2.5/home/ongoing.php
```

Karena proxy jalan di Node.js (Vite), tidak ada CORS issue.

## Stack
- React 18 + Vite
- Tailwind CSS v3
- Lucide React
