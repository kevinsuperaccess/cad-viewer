import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PORT = parseInt(process.env.PORT ?? '3000', 10);
export const UPLOAD_DIR = path.resolve(ROOT, process.env.UPLOAD_DIR ?? 'uploads');
export const ANNOTATIONS_DIR = path.resolve(ROOT, process.env.ANNOTATIONS_DIR ?? 'annotations');
export const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_FILE_SIZE_MB ?? '50', 10) * 1024 * 1024;
