import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { ANNOTATIONS_DIR } from '../config.js';

const router = Router();

function annotationPath(fileId) {
  // Prevent path traversal — strip everything except safe filename chars
  const safe = path.basename(fileId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(ANNOTATIONS_DIR, `${safe}.json`);
}

function isValidFileId(fileId) {
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length >= 256) return false;
  // Reject anything containing path separators (catches traversal attempts)
  if (/[/\\]/.test(fileId)) return false;
  return true;
}

// GET /api/annotations/:fileId
router.get('/:fileId', (req, res) => {
  const { fileId } = req.params;
  if (!isValidFileId(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }

  const p = annotationPath(fileId);
  if (!fs.existsSync(p)) {
    return res.status(200).json({ fileId, annotations: [] });
  }

  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return res.status(200).json(data);
  } catch {
    return res.status(500).json({ error: 'Failed to read annotations' });
  }
});

// PUT /api/annotations/:fileId
router.put('/:fileId', (req, res) => {
  const { fileId } = req.params;
  if (!isValidFileId(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }

  const { annotations } = req.body;
  if (!Array.isArray(annotations)) {
    return res.status(400).json({ error: '"annotations" must be an array' });
  }

  const payload = { fileId, annotations, savedAt: new Date().toISOString() };

  try {
    fs.writeFileSync(annotationPath(fileId), JSON.stringify(payload, null, 2), 'utf8');
    return res.status(200).json(payload);
  } catch {
    return res.status(500).json({ error: 'Failed to save annotations' });
  }
});

export default router;
