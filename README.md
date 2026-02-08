# AVIFY

AVIFY is a fast image converter with batch processing, size comparison, and metadata insights. The frontend is a Vite + React app designed for Vercel, and the backend is a Fastify server designed for Render.

## Features
- Convert images to AVIF, WebP, PNG, and JPEG
- Drag & drop multiple files
- Queue processing + progress
- ZIP download of converted files
- Per-format size comparison + preview
- EXIF metadata display (camera model, resolution, GPS, date taken)

## Repo Structure
- `frontend/` — Vite + React UI
- `backend/` — Fastify image conversion API
- `render.yaml` — Render deployment config for backend

## Requirements
- Node.js 18+ recommended
- npm 9+ recommended

## Local Development

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:4200`

## Environment Variables

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:3000
```

### Backend (`backend/.env`)
```
PORT=3000
HOST=0.0.0.0
MAX_FILE_SIZE=1073741824
CORS_ORIGIN=http://localhost:4200
```

## Deploy (Production)

### Frontend on Vercel
1. Import the `frontend/` folder into Vercel.
2. Set `VITE_API_URL` to your Render backend URL.
3. Build command: `npm run build`.
4. Output directory: `dist`.

### Backend on Render
1. Create a new **Web Service** from this repo.
2. Set root directory to `backend/`.
3. Build command: `npm install`.
4. Start command: `npm run start`.
5. Set environment variables:
   - `PORT=10000`
   - `HOST=0.0.0.0`
   - `CORS_ORIGIN=https://YOUR_VERCEL_DOMAIN`

## API

### POST `/convert`
- `multipart/form-data` with a single field named `file`
- Query params:
  - `format` — `avif | webp | png | jpeg | jpg | svg`
  - `keepMetadata` — `1` to preserve metadata (default strips metadata)

Example (curl):
```bash
curl -X POST "http://localhost:3000/convert?format=webp" \
  -F "file=@./image.jpg" \
  --output converted.webp
```

## Notes
- The frontend uses `VITE_API_URL` to route API calls.
- For SVG output, only SVG inputs are allowed.
- Render free tier may sleep; first request can be slow.

--yo