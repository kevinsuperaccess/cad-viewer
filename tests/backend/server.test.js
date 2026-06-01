import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../../src/app.js';
import { UPLOAD_DIR, ANNOTATIONS_DIR } from '../../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal valid DXF content — group code 0 starts the file
const VALID_DXF = `  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n`;
const VALID_DXF_PATH = path.join(__dirname, 'fixture.dxf');
const INVALID_DXF_PATH = path.join(__dirname, 'fixture.txt');
const MALFORMED_DXF_PATH = path.join(__dirname, 'malformed.dxf');
const EMPTY_DXF_PATH = path.join(__dirname, 'empty.dxf');

beforeAll(() => {
  [UPLOAD_DIR, ANNOTATIONS_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  fs.writeFileSync(VALID_DXF_PATH, VALID_DXF, 'utf8');
  fs.writeFileSync(INVALID_DXF_PATH, 'this is not a dxf file', 'utf8');
  fs.writeFileSync(MALFORMED_DXF_PATH, 'NOT A DXF FILE AT ALL', 'utf8');
  fs.writeFileSync(EMPTY_DXF_PATH, '', 'utf8');
});

afterAll(() => {
  [VALID_DXF_PATH, INVALID_DXF_PATH, MALFORMED_DXF_PATH, EMPTY_DXF_PATH].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

// ── Health / startup ────────────────────────────────────────────────────────

describe('Server health', () => {
  it('responds 200 on /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── File upload ─────────────────────────────────────────────────────────────

describe('POST /api/files/upload', () => {
  it('accepts a valid DXF file and returns success', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('file', VALID_DXF_PATH, { filename: 'drawing.dxf', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fileId');
    expect(res.body).toHaveProperty('url');
    expect(res.body.originalName).toBe('drawing.dxf');
  });

  it('rejects a non-DXF file with 415 and clear message', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('file', INVALID_DXF_PATH, { filename: 'readme.txt', contentType: 'text/plain' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/\.dxf/i);
  });

  it('rejects an empty file upload with 422', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('file', EMPTY_DXF_PATH, { filename: 'empty.dxf', contentType: 'application/octet-stream' });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects a malformed DXF (wrong content) with 422', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('file', MALFORMED_DXF_PATH, { filename: 'bad.dxf', contentType: 'application/octet-stream' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/valid DXF/i);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app).post('/api/files/upload');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when wrong field name is used', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('drawing', VALID_DXF_PATH, { filename: 'drawing.dxf' });

    expect(res.status).toBe(400);
  });
});

// ── Annotations ─────────────────────────────────────────────────────────────

describe('Annotations API', () => {
  const fileId = `test-${Date.now()}`;
  const annotations = [
    { id: '1', type: 'text', x: 10, y: 20, text: 'Note A' },
    { id: '2', type: 'rect', x: 30, y: 40, width: 100, height: 50 },
  ];

  afterAll(() => {
    const p = path.join(ANNOTATIONS_DIR, `${fileId}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('PUT saves annotations and returns them', async () => {
    const res = await request(app)
      .put(`/api/annotations/${fileId}`)
      .send({ annotations });

    expect(res.status).toBe(200);
    expect(res.body.annotations).toHaveLength(2);
    expect(res.body.fileId).toBe(fileId);
    expect(res.body).toHaveProperty('savedAt');
  });

  it('GET returns saved annotations for a known fileId', async () => {
    const res = await request(app).get(`/api/annotations/${fileId}`);
    expect(res.status).toBe(200);
    expect(res.body.annotations).toHaveLength(2);
    expect(res.body.annotations[0].text).toBe('Note A');
  });

  it('GET returns empty array for an unknown fileId (not 404)', async () => {
    const res = await request(app).get('/api/annotations/nonexistent-file-xyz');
    expect(res.status).toBe(200);
    expect(res.body.annotations).toEqual([]);
  });

  it('PUT returns 400 when annotations field is missing', async () => {
    const res = await request(app)
      .put(`/api/annotations/${fileId}`)
      .send({ notes: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/annotations/i);
  });

  it('PUT returns 400 for an invalid fileId', async () => {
    const res = await request(app)
      .put('/api/annotations/')
      .send({ annotations: [] });

    // Express treats trailing slash as 404 on that route
    expect([400, 404]).toContain(res.status);
  });

  it('GET returns 400 for a path-traversal fileId', async () => {
    const res = await request(app).get('/api/annotations/..%2F..%2Fetc%2Fpasswd');
    expect([400, 404]).toContain(res.status);
  });
});

// ── Error codes ─────────────────────────────────────────────────────────────

describe('Error handling', () => {
  it('returns 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
