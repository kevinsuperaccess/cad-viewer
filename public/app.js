/**
 * CAD Viewer — frontend entry point
 *
 * Modes:
 *   dxf  — upload a .dxf file, render with dxf-viewer, annotate with SVG layer
 *   rvt  — load pre-exported model.gltf from revit-exports/, render with Three.js,
 *            show schedules panel on the right
 */

const API = ''; // relative — no hardcoded origin

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  mode: null,           // 'dxf' | 'rvt'
  fileId: null,
  dxfViewer: null,
  rvtRenderer: null,    // { renderer, scene, camera, controls, animId }
  activeTool: null,
  annotations: [],
  drawStart: null,
  isDirty: false,
};

// ── Toast ──────────────────────────────────────────────────────────────────────

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

// ── Drop zone — DXF ───────────────────────────────────────────────────────────

const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
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
  state.mode = 'dxf';
  showWorkspace('dxf', json.originalName);
  await loadDxf(json.url);
  await loadAnnotations(json.fileId);
}

// ── Drop zone — Revit export button ───────────────────────────────────────────

const btnLoadRevit = document.getElementById('btn-load-revit');
const revitBadge   = document.getElementById('revit-badge');

// On page load, check whether a Revit export is available and badge accordingly
(async () => {
  try {
    const res = await fetch(`${API}/api/revit/status`);
    const data = await res.json();
    revitBadge.hidden = !data.available;
  } catch { /* non-fatal */ }
})();

btnLoadRevit.addEventListener('click', loadRevitExport);

async function loadRevitExport() {
  showToast('Loading Revit export…', 'info', 0);
  try {
    // Check availability
    const statusRes = await fetch(`${API}/api/revit/status`);
    const status = await statusRes.json();
    if (!status.available) {
      showToast('No Revit export found. Run export_revit.py inside Revit first.', 'error', 6000);
      return;
    }
  } catch (err) {
    showToast(`Could not reach server: ${err.message}`, 'error');
    return;
  }

  state.mode = 'rvt';
  showWorkspace('rvt', 'Revit Model');
  await loadGltf('/revit-exports/model.gltf');
  await loadSchedules('/revit-exports/schedules.json');
  hideToast();
}

// ── Workspace switcher ────────────────────────────────────────────────────────

const dxfCanvas     = document.getElementById('viewer-canvas');
const annLayer      = document.getElementById('annotation-layer');
const rvtCanvas     = document.getElementById('rvt-canvas');
const schedulePanel = document.getElementById('schedule-panel');
const dxfTools      = document.getElementById('dxf-tools');
const rvtTools      = document.getElementById('rvt-tools');

function showWorkspace(mode, label) {
  document.getElementById('drop-zone').hidden = true;
  document.getElementById('workspace').hidden = false;
  document.getElementById('file-name').textContent = label;

  const isDxf = mode === 'dxf';
  dxfCanvas.hidden    = !isDxf;
  annLayer.hidden     = !isDxf;
  dxfTools.hidden     = !isDxf;

  rvtCanvas.hidden    = isDxf;
  rvtTools.hidden     = isDxf;
  schedulePanel.hidden = isDxf;

  if (isDxf) resizeDxfCanvas();
  else       resizeRvtCanvas();
}

window.addEventListener('resize', () => {
  if (state.mode === 'dxf') resizeDxfCanvas();
  else if (state.mode === 'rvt') resizeRvtCanvas();
});

// ── DXF rendering ─────────────────────────────────────────────────────────────

const viewerWrap = document.getElementById('viewer-wrap');

function resizeDxfCanvas() {
  dxfCanvas.width  = viewerWrap.clientWidth;
  dxfCanvas.height = viewerWrap.clientHeight;
  if (state.dxfViewer) state.dxfViewer.Resize(dxfCanvas.width, dxfCanvas.height);
}

async function loadDxf(url) {
  showToast('Rendering drawing…', 'info', 0);
  if (state.dxfViewer) { state.dxfViewer.Destroy(); state.dxfViewer = null; }
  try {
    const [{ DxfViewer }, { Color }] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/dxf-viewer@1.1.7/dist/DxfViewer.esm.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.164/build/three.module.js'),
    ]);
    const viewer = new DxfViewer(dxfCanvas, {
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

// DXF zoom / pan
document.getElementById('btn-zoom-in').addEventListener('click',  () => state.dxfViewer?.Zoom(1.25));
document.getElementById('btn-zoom-out').addEventListener('click', () => state.dxfViewer?.Zoom(0.8));
document.getElementById('btn-fit').addEventListener('click',      () => state.dxfViewer?.FitView(0.9));

dxfCanvas.addEventListener('mousedown', () => viewerWrap.classList.add('grabbing'));
window.addEventListener('mouseup',      () => viewerWrap.classList.remove('grabbing'));

// ── RVT / Three.js rendering ──────────────────────────────────────────────────

function resizeRvtCanvas() {
  const r = state.rvtRenderer;
  if (!r) return;
  const w = rvtCanvas.clientWidth;
  const h = rvtCanvas.clientHeight;
  r.renderer.setSize(w, h);
  r.camera.aspect = w / h;
  r.camera.updateProjectionMatrix();
}

async function loadGltf(url) {
  showToast('Loading 3D model…', 'info', 0);

  // Tear down previous Three.js session
  if (state.rvtRenderer) {
    cancelAnimationFrame(state.rvtRenderer.animId);
    state.rvtRenderer.renderer.dispose();
    state.rvtRenderer = null;
  }

  let THREE, OrbitControls, GLTFLoader;
  try {
    [{ default: THREE }, { OrbitControls }, { GLTFLoader }] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/three@0.164/build/three.module.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.164/examples/jsm/controls/OrbitControls.js'),
      import('https://cdn.jsdelivr.net/npm/three@0.164/examples/jsm/loaders/GLTFLoader.js'),
    ]);
  } catch (err) {
    showToast(`Could not load Three.js from CDN: ${err.message}`, 'error');
    return;
  }

  const scene    = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const w = rvtCanvas.clientWidth  || viewerWrap.clientWidth;
  const h = rvtCanvas.clientHeight || viewerWrap.clientHeight;

  const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 200000);
  camera.position.set(0, 50, 100);

  const renderer = new THREE.WebGLRenderer({ canvas: rvtCanvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(100, 200, 100);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
  fill.position.set(-100, -50, -100);
  scene.add(fill);

  const controls = new OrbitControls(camera, rvtCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  rvtCanvas.classList.remove('grabbing');
  controls.addEventListener('start', () => rvtCanvas.classList.add('grabbing'));
  controls.addEventListener('end',   () => rvtCanvas.classList.remove('grabbing'));

  // Animation loop
  let animId;
  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  // Load glTF
  const loader = new GLTFLoader();
  await new Promise((resolve, reject) => {
    loader.load(url,
      (gltf) => {
        // Apply a default material with flat shading so normals look sharp
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          const old = Array.isArray(child.material) ? child.material[0] : child.material;
          child.material = new THREE.MeshStandardMaterial({
            color: old?.color ?? new THREE.Color(0x99aaaa),
            flatShading: true,
            roughness: 0.8,
            metalness: 0.1,
          });
        });

        scene.add(gltf.scene);

        // Fit camera to model
        const box    = new THREE.Box3().setFromObject(gltf.scene);
        const centre = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z);
        camera.position.set(centre.x + radius, centre.y + radius * 0.6, centre.z + radius);
        controls.target.copy(centre);
        controls.update();

        resolve();
      },
      undefined,
      reject,
    );
  }).catch((err) => {
    showToast(`Failed to load glTF: ${err.message}`, 'error');
  });

  state.rvtRenderer = { renderer, scene, camera, controls, animId: null };
  animate();
  state.rvtRenderer.animId = animId;

  // RVT zoom buttons
  document.getElementById('btn-rvt-zoom-in').onclick  = () => {
    camera.position.lerp(controls.target, 0.2);
    controls.update();
  };
  document.getElementById('btn-rvt-zoom-out').onclick = () => {
    const dir = camera.position.clone().sub(controls.target).multiplyScalar(0.25);
    camera.position.add(dir);
    controls.update();
  };
  document.getElementById('btn-rvt-fit').onclick = () => {
    const box    = new THREE.Box3().setFromObject(scene);
    const centre = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    camera.position.set(centre.x + radius, centre.y + radius * 0.6, centre.z + radius);
    controls.target.copy(centre);
    controls.update();
  };

  resizeRvtCanvas();
}

// ── Schedules panel ───────────────────────────────────────────────────────────

async function loadSchedules(url) {
  const container = document.getElementById('schedule-container');
  container.innerHTML = '';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);font-size:.85rem">No schedules found in export.</p>';
      return;
    }

    data.forEach((sched) => {
      const h3 = document.createElement('h3');
      h3.textContent = sched.schedule;
      container.appendChild(h3);

      const table = document.createElement('table');

      // Header row
      const thead = document.createElement('tr');
      (sched.columns || []).forEach((col) => {
        const th = document.createElement('th');
        th.textContent = col;
        th.title = col;
        thead.appendChild(th);
      });
      table.appendChild(thead);

      // Data rows
      if (!sched.rows || sched.rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = sched.columns?.length || 1;
        td.textContent = 'No data';
        td.style.color = 'var(--text-dim)';
        tr.appendChild(td);
        table.appendChild(tr);
      } else {
        sched.rows.forEach((row) => {
          const tr = document.createElement('tr');
          row.forEach((cell) => {
            const td = document.createElement('td');
            td.textContent = cell;
            td.title = cell;
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
      }
      container.appendChild(table);
    });
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-dim);font-size:.85rem">Could not load schedules: ${err.message}</p>`;
  }
}

// Schedule search filter
document.getElementById('schedule-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#schedule-container tr').forEach((row) => {
    row.classList.toggle('hidden', q.length > 0 && !row.innerText.toLowerCase().includes(q));
  });
});

// Schedule panel toggle
document.getElementById('schedule-toggle').addEventListener('change', (e) => {
  schedulePanel.hidden = !e.target.checked;
  resizeRvtCanvas();
});

// ── DXF annotation layer ───────────────────────────────────────────────────────

annLayer.insertAdjacentHTML('afterbegin', `
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
  annLayer.classList.toggle('drawing', tool !== null);
}

function svgPoint(e) {
  const rect = annLayer.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function nextId() { return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function renderAnnotations() {
  annLayer.querySelectorAll('[data-ann]').forEach((el) => el.remove());
  state.annotations.forEach(renderOne);
}

function renderOne(ann) {
  let el;
  switch (ann.type) {
    case 'text': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.setAttribute('x', ann.x); el.setAttribute('y', ann.y);
      el.classList.add('ann-text'); el.textContent = ann.text; break;
    }
    case 'rect': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('x', Math.min(ann.x, ann.x + ann.w));
      el.setAttribute('y', Math.min(ann.y, ann.y + ann.h));
      el.setAttribute('width', Math.abs(ann.w)); el.setAttribute('height', Math.abs(ann.h));
      el.classList.add('ann-rect'); break;
    }
    case 'circle': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      el.setAttribute('cx', ann.x + ann.w / 2); el.setAttribute('cy', ann.y + ann.h / 2);
      el.setAttribute('rx', Math.abs(ann.w / 2)); el.setAttribute('ry', Math.abs(ann.h / 2));
      el.classList.add('ann-circle'); break;
    }
    case 'arrow': {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('x1', ann.x); el.setAttribute('y1', ann.y);
      el.setAttribute('x2', ann.x2); el.setAttribute('y2', ann.y2);
      el.classList.add('ann-arrow'); break;
    }
    default: return;
  }
  el.dataset.ann = ann.id;
  annLayer.appendChild(el);
}

let tempEl = null;

annLayer.addEventListener('mousedown', (e) => {
  if (!state.activeTool) return;
  state.drawStart = svgPoint(e);
  if (state.activeTool === 'text') {
    const label = prompt('Enter annotation text:');
    if (!label) return;
    const ann = { id: nextId(), type: 'text', x: state.drawStart.x, y: state.drawStart.y, text: label };
    state.annotations.push(ann); renderOne(ann); state.isDirty = true; setActiveTool(null); return;
  }
  if (state.activeTool === 'rect') {
    tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tempEl.classList.add('ann-rect');
  } else if (state.activeTool === 'circle') {
    tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    tempEl.classList.add('ann-circle');
  } else if (state.activeTool === 'arrow') {
    tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tempEl.classList.add('ann-arrow');
    tempEl.setAttribute('x1', state.drawStart.x); tempEl.setAttribute('y1', state.drawStart.y);
  }
  if (tempEl) annLayer.appendChild(tempEl);
});

annLayer.addEventListener('mousemove', (e) => {
  if (!tempEl || !state.drawStart) return;
  const cur = svgPoint(e);
  const dx = cur.x - state.drawStart.x, dy = cur.y - state.drawStart.y;
  if (state.activeTool === 'rect') {
    tempEl.setAttribute('x', Math.min(state.drawStart.x, cur.x));
    tempEl.setAttribute('y', Math.min(state.drawStart.y, cur.y));
    tempEl.setAttribute('width', Math.abs(dx)); tempEl.setAttribute('height', Math.abs(dy));
  } else if (state.activeTool === 'circle') {
    tempEl.setAttribute('cx', state.drawStart.x + dx / 2); tempEl.setAttribute('cy', state.drawStart.y + dy / 2);
    tempEl.setAttribute('rx', Math.abs(dx / 2)); tempEl.setAttribute('ry', Math.abs(dy / 2));
  } else if (state.activeTool === 'arrow') {
    tempEl.setAttribute('x2', cur.x); tempEl.setAttribute('y2', cur.y);
  }
});

annLayer.addEventListener('mouseup', (e) => {
  if (!tempEl || !state.drawStart) return;
  const cur = svgPoint(e);
  const dx = cur.x - state.drawStart.x, dy = cur.y - state.drawStart.y;
  const tool = state.activeTool;
  tempEl.remove(); tempEl = null;
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4 && tool !== 'arrow') { state.drawStart = null; return; }
  let ann;
  if (tool === 'rect')   ann = { id: nextId(), type: 'rect',   x: state.drawStart.x, y: state.drawStart.y, w: dx, h: dy };
  if (tool === 'circle') ann = { id: nextId(), type: 'circle', x: state.drawStart.x, y: state.drawStart.y, w: dx, h: dy };
  if (tool === 'arrow')  ann = { id: nextId(), type: 'arrow',  x: state.drawStart.x, y: state.drawStart.y, x2: cur.x, y2: cur.y };
  if (ann) { state.annotations.push(ann); renderOne(ann); state.isDirty = true; }
  state.drawStart = null;
  setActiveTool(null);
});

document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    setActiveTool(state.activeTool === tool ? null : tool);
  });
});

// ── Annotation persistence (DXF mode only) ────────────────────────────────────

async function loadAnnotations(fileId) {
  try {
    const res = await fetch(`${API}/api/annotations/${fileId}`);
    if (!res.ok) return;
    const data = await res.json();
    state.annotations = data.annotations ?? [];
    renderAnnotations();
  } catch { /* non-fatal */ }
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
    if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'Save failed'); }
    state.isDirty = false;
    showToast('Annotations saved.', 'success');
  } catch (err) {
    showToast(`Could not save: ${err.message}. Your work is still visible.`, 'error', 6000);
  }
}

document.getElementById('btn-save').addEventListener('click', saveAnnotations);

window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── New / reset ───────────────────────────────────────────────────────────────

document.getElementById('btn-new').addEventListener('click', () => {
  if (state.isDirty && !confirm('You have unsaved annotations. Discard them?')) return;
  location.reload();
});
