# CAD Viewer

Browser-based DXF viewer with annotation and markup.

## Stack
- **Backend:** Node.js + Express
- **DXF rendering:** dxf-viewer (WebGL via Three.js)
- **Annotations:** SVG overlay layer
- **Testing:** Vitest + Supertest (backend), Playwright (frontend)

## Setup

```bash
cp .env.example .env
npm install
npm start
# open http://localhost:3000
```

## Testing

```bash
npm run test:backend    # Vitest unit/integration tests
npm run test:frontend   # Playwright E2E tests
npm test                # both
```

## Usage

1. Drag and drop a `.dxf` file onto the page (or click Browse)
2. Use toolbar buttons to zoom, pan, and annotate
3. Click **Save** to persist annotations; they reload automatically next time you open the same file

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `UPLOAD_DIR` | `uploads` | Where uploaded DXF files are stored |
| `ANNOTATIONS_DIR` | `annotations` | Where annotation JSON files are stored |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size |
