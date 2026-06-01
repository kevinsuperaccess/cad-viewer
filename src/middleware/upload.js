import multer from 'multer';
import path from 'path';
import { UPLOAD_DIR, MAX_FILE_SIZE_BYTES } from '../config.js';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.dxf') {
    return cb(Object.assign(new Error('Only .dxf files are accepted'), { code: 'INVALID_FILE_TYPE' }));
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});
