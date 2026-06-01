/**
 * CAD Viewer — frontend entry point
 *
 * Sections:
 *   1. Imports & constants
 *   2. State
 *   3. Toast / error display
 *   4. Drag-and-drop + file upload
 *   5. DXF rendering via dxf-viewer (CDN)
 *   6. Viewport transform (pan / zoom)
 *   7. Annotation layer (text, rect, circle, arrow)
 *   8. Annotation persistence (save / load)
 *   9. Toolbar wiring
 */

// ── 1. Imports & constants ────────────────────────────────────────────────

// DxfViewer is loaded lazily inside loadDxf() so a CDN failure never
// prevents the upload/annotation flow from initialising.
const API = ''; // all fetches are relative — no hardcoded origin

// ── 2. State ──────────────────────────────────────────────────────────────

const state = {
  fileId: null,
  dxfViewer: null,
  activeTool: null,   // 'text' | 'rect' | 'circle' | 'arrow' | null
  annotations: [],    // [{ id, type, ...props }]
  drawStart: null,    // { x, y } in SVG coords when drawing shape
  isDirty: false,
};

// ── 3. Toast ──────────────────────────────────────────────────────────────

const toast = document.getElementById('toast');
let toastTimer = null;

function showToast(msg, kind = 'info', duration = 3500) {
  toast.textContent = msg;
  toast.className = kind;
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

function hideToast() { toast.hidden = true; }

// ── 4. Drag-and-drop + file upload ────────────────────────────────────────

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
});

function handleFileSelected(file) {
  if (!file.name.toLowerCase().endsWith('.dxf')) {
    showToast('Only .dxf files are supported.', 'error');
    return;
  }
  uploadFile(file);
}

async function uploadFile(file) {
  showToast('Uploading…', 'info', 0);
  const form = new FormData();
  form.append('file', file);

  let json;
  try {
    const res = await fetch(`${API}/api/files/upload`, { method: 'POST', body: form });
    json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  hideToast();
  state.fileId = json.fileId;
  document.getElementById('file-name').textContent = json.originalName;
  showWorkspace();
  await loadDxf(json.url);
  await loadAnnotations(json.fileId);
}

// ── 5. DXF rendering ──────────────────────────────────────────────────────

const viewerWrap = document.getElementById('viewer-wrap');
const canvas = document.getElementById('viewer-canvas');

function showWorkspace() {
  document.getElementById('drop-zone').hidden = true;
  document.getElementById('workspace').hidden = false;
  resizeCanvas();
}

function resizeCanvas() {
  canvas.width  = viewerWrap.clientWidth;
  canvas.height = viewerWrap.clientHeight;
  if (state.dxfViewer) state.dxfViewer.Resize(canvas.width, canvas.height);
}

window.addEventListener('resize', resizeCanvas);

async function loadDxf(url) {
  showToast('Rendering drawing…', 'info', 0);

  // Destroy previous viewer if any
  if (state.dxfViewer) {
    state.dxfViewer.Destroy();
    state.dxfViewer = null;
  }

  try {
    const [{ DxfViewer }, { Color }] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/dxf-viewer@1.1.7/dist/DxfViewer.esm.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.164/build/three.module.js'),
    ]);
    const viewer = new DxfViewer(canvas, {
      clearColor: new Color(0x111111),
      autoResize: false,
    });
    await viewer.Load({ url, fonts: [] });
    state.dxfViewer = viewer;
    hideToast();
  } catch (err) {
    showToast(`Failed to render DXF: ${err.message}`, 'error');
  }
}

// ── 6. Viewport transform — pan / zoom via dxf-viewer built-ins ──────────

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  state.dxfViewer?.Zoom(1.25);
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  state.dxfViewer?.Zoom(0.8);
});
document.getElementById('btn-fit').addEventListener('click', () => {
  state.dxfViewer?.FitView(0.9);
});

// dxf-viewer handles pan internally via mouse drag on the canvas.
// We add a grabbing cursor class so the UX is clear.
canvas.addEventListener('mousedown', () => viewerWrap.classList.add('grabbing'));
window.addEventListener('mouseup',   () => viewerWrap.classList.remove('grabbing'));

// ── 7. Annotation layer ───────────────────────────────────────────────────

const svgLayer = document.getElementById('annotation-layer');

// SVG arrowhead marker (defined once)
svgLayer.insertAdjacentHTML('afterbegin', `
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#a8ff78"/>
    </marker>
  </defs>
`);

function setActiveTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  svgLayer.classList.toggle('drawing', tool !== null);
}

function svgPoint(e) {
  const rect = svgLayer.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function nextId() {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function renderAnnotations() {
  // Remove all annotation elements (keep <defs>)
  svgLayer.querySelectorAll('[data-ann]').forEach((el) => el.remove());
  state.annotations.forEach(renderOne);
}

function renderOne(ann) {
  let el;
  switch (ann.type) {
    case 'text': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.setAttribute('x', ann.x);
      el.setAttribute('y', ann.y);
      el.classList.add('ann-text');
      el.textContent = ann.text;
      break;
    }
    case 'rect': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('x', Math.min(ann.x, ann.x + ann.w));
      el.setAttribute('y', Math.min(ann.y, ann.y + ann.h));
      el.setAttribute('width',  Math.abs(ann.w));
      el.setAttribute('height', Math.abs(ann.h));
      el.classList.add('ann-rect');
      break;
    }
    case 'circle': {
      const cx = ann.x + ann.w / 2;
      const cy = ann.y + ann.h / 2;
      const r  = Math.sqrt(ann.w ** 2 + ann.h ** 2) / 2;
      el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      el.setAttribute('cx', cx); el.setAttribute('cy', cy);
      el.setAttribute('rx', Math.abs(ann.w / 2));
      el.setAttribute('ry', Math.abs(ann.h / 2));
      el.classList.add('ann-circle');
      break;
    }
    case 'arrow': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('x1', ann.x);  el.setAttribute('y1', ann.y);
      el.setAttribute('x2', ann.x2); el.setAttribute('y2', ann.y2);
      el.classList.add('ann-arrow');
      break;
    }
    default: return;
  }
  el.dataset.ann = ann.id;
  svgLayer.appendChild(el);
}

// ── Drawing interaction ───────────────────────────────────────────────────

let tempEl = null;

svgLayer.addEventListener('mousedown', (e) => {
  if (!state.activeTool) return;
  state.drawStart = svgPoint(e);

  if (state.activeTool === 'text') {
    const label = prompt('Enter annotation text:');
    if (!label) return;
    const ann = { id: nextId(), type: 'text', x: state.drawStart.x, y: state.drawStart.y, text: label };
    state.annotations.push(ann);
    renderOne(ann);
    state.isDirty = true;
    setActiveTool(null);
    return;
  }

  // Shape tools — create a temporary preview element
  if (state.activeTool === 'rect') {
    tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tempEl.classList.add('ann-rect');
  } else if (state.activeTool === 'circle') {
    tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    tempEl.classList.add('ann-circle');
  } else if (state.activeTool === 'arrow') {
    tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tempEl.classList.add('ann-arrow');
    tempEl.setAttribute('x1', state.drawStart.x);
    tempEl.setAttribute('y1', state.drawStart.y);
  }
  if (tempEl) svgLayer.appendChild(tempEl);
});

svgLayer.addEventListener('mousemove', (e) => {
  if (!tempEl || !state.drawStart) return;
  const cur = svgPoint(e);
  const dx = cur.x - state.drawStart.x;
  const dy = cur.y - state.drawStart.y;

  if (state.activeTool === 'rect') {
    tempEl.setAttribute('x', Math.min(state.drawStart.x, cur.x));
    tempEl.setAttribute('y', Math.min(state.drawStart.y, cur.y));
    tempEl.setAttribute('width',  Math.abs(dx));
    tempEl.setAttribute('height', Math.abs(dy));
  } else if (state.activeTool === 'circle') {
    tempEl.setAttribute('cx', state.drawStart.x + dx / 2);
    tempEl.setAttribute('cy', state.drawStart.y + dy / 2);
    tempEl.setAttribute('rx', Math.abs(dx / 2));
    tempEl.setAttribute('ry', Math.abs(dy / 2));
  } else if (state.activeTool === 'arrow') {
    tempEl.setAttribute('x2', cur.x);
    tempEl.setAttribute('y2', cur.y);
  }
});

svgLayer.addEventListener('mouseup', (e) => {
  if (!tempEl || !state.drawStart) return;
  const cur = svgPoint(e);
  const dx = cur.x - state.drawStart.x;
  const dy = cur.y - state.drawStart.y;
  const tool = state.activeTool;

  tempEl.remove();
  tempEl = null;

  // Discard tiny accidental clicks
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4 && tool !== 'arrow') {
    state.drawStart = null;
    return;
  }

  let ann;
  if (tool === 'rect') {
    ann = { id: nextId(), type: 'rect', x: state.drawStart.x, y: state.drawStart.y, w: dx, h: dy };
  } else if (tool === 'circle') {
    ann = { id: nextId(), type: 'circle', x: state.drawStart.x, y: state.drawStart.y, w: dx, h: dy };
  } else if (tool === 'arrow') {
    ann = { id: nextId(), type: 'arrow', x: state.drawStart.x, y: state.drawStart.y, x2: cur.x, y2: cur.y };
  }

  if (ann) {
    state.annotations.push(ann);
    renderOne(ann);
    state.isDirty = true;
  }
  state.drawStart = null;
  setActiveTool(null);
});

// ── 8. Annotation persistence ─────────────────────────────────────────────

async function loadAnnotations(fileId) {
  try {
    const res = await fetch(`${API}/api/annotations/${fileId}`);
    if (!res.ok) return;
    const data = await res.json();
    state.annotations = data.annotations ?? [];
    renderAnnotations();
  } catch {
    // Non-fatal — user can still annotate
  }
}

async function saveAnnotations() {
  if (!state.fileId) return;
  showToast('Saving…', 'info', 0);
  try {
    const res = await fetch(`${API}/api/annotations/${state.fileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations: state.annotations }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Save failed');
    }
    state.isDirty = false;
    showToast('Annotations saved.', 'success');
  } catch (err) {
    showToast(`Could not save: ${err.message}. Your work is still visible.`, 'error', 6000);
  }
}

// Warn before leaving with unsaved annotations
window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── 9. Toolbar wiring ─────────────────────────────────────────────────────

document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    setActiveTool(state.activeTool === tool ? null : tool);
  });
});

document.getElementById('btn-save').addEventListener('click', saveAnnotations);

document.getElementById('btn-new').addEventListener('click', () => {
  if (state.isDirty && !confirm('You have unsaved annotations. Discard them?')) return;
  location.reload();
});
