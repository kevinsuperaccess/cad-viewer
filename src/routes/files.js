import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { upload } from '../middleware/upload.js';
import { UPLOAD_DIR } from '../config.js';

const router = Router();

// POST /api/files/upload
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(415).json({ error: err.message });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File exceeds maximum allowed size' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FIELD_KEY') {
        return res.status(400).json({ error: 'Unexpected field name — use "file"' });
      }
      return res.status(400).json({ error: err.message ?? 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Basic DXF sanity check — a valid DXF starts with a section marker
    const filePath = path.join(UPLOAD_DIR, req.file.filename);
    let head;
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(128);
      fs.readSync(fd, buf, 0, 128, 0);
      fs.closeSync(fd);
      head = buf.toString('utf8', 0, 128);
    } catch {
      fs.unlink(filePath, () => {});
      return res.status(422).json({ error: 'Could not read uploaded file' });
    }

    // DXF files begin with group code "0" on the first meaningful line
    const trimmed = head.trimStart();
    if (!trimmed.startsWith('0') && !trimmed.startsWith('  0')) {
      fs.unlink(filePath, () => {});
      return res.status(422).json({ error: 'File does not appear to be a valid DXF document' });
    }

    return res.status(200).json({
      fileId: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`,
    });
  });
});

export default router;
