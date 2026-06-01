import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import filesRouter from './routes/files.js';
import annotationsRouter from './routes/annotations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json());

// Serve uploaded DXF files so the browser can fetch them
app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')));

// Serve Revit glTF exports (written by export_revit.py)
app.use('/revit-exports', express.static(path.resolve(__dirname, '..', 'revit-exports')));

// Serve the frontend
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// API routes
app.use('/api/files', filesRouter);
app.use('/api/annotations', annotationsRouter);

// Health check
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Check whether a Revit export is available
app.get('/api/revit/status', (_req, res) => {
  const gltfPath = path.resolve(__dirname, '..', 'revit-exports', 'model.gltf');
  const exists = fs.existsSync(gltfPath);
  res.status(200).json({ available: exists });
});

// 404 for unmatched API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// All other routes serve the SPA
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

export default app;
