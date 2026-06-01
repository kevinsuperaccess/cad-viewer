import fs from 'fs';
import app from './app.js';
import { PORT, UPLOAD_DIR, ANNOTATIONS_DIR } from './config.js';

// Ensure runtime directories exist
[UPLOAD_DIR, ANNOTATIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.listen(PORT, () => {
  console.log(`cad-viewer running at http://localhost:${PORT}`);
});
