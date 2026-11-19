import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Top-level error trapping: any startup, shader, or unhandled rejection failure
// immediately transitions to the ERROR state with the exact message on screen.
// ---------------------------------------------------------------------------
function setErrorFromEvent(msg) {
  try {
    showError(msg);
  } catch (e) {
    // showError may not be defined yet if this fires before module init
    console.error('FATAL:', msg);
  }
}

window.onerror = (message, source, lineno, colno, error) => {
  const msg = error ? error.message || String(error) : String(message);
  setErrorFromEvent('Uncaught error: ' + msg);
  return true;
};

window.onunhandledrejection = (event) => {
  const reason = event.reason || {};
  const msg = reason.message || reason.error || String(reason);
  setErrorFromEvent('Unhandled rejection: ' + msg);
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_URL = '/mokki/splats.ply';
const SPLAT_URL = '/mokki/splats.splat';
const FOV = 60;
const NEAR = 0.01;
const FAR = 2000;
const FLY_SPEED = 6;
const AUTO_SPEED = 0.5;

const LOAD_TIMEOUT_MS = 25000;
const FETCH_TIMEOUT_MS = 20000;
const ESTIMATED_TOTAL_MB = 11;

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let scene, camera, renderer, controls, splats;
let center = new THREE.Vector3();
let radius = 10;
let autoFly = false;
let autoAngle = 0;
let autoHeight = 0;
const keys = {};
let lastTime = 0;
let loadError = '';

let currentAbortController = null;
function abortCurrentLoad() {
  if (currentAbortController) {
    try { currentAbortController.abort(); } catch (e) {}
    currentAbortController = null;
  }
}

function timeoutPromise(promise, ms, msg) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg || 'timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const container = document.getElementById('canvas-container');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');
const errorEl = document.getElementById('error');
const errorMsg = document.getElementById('error-msg');
const splatCountEl = document.getElementById('splat-count');
const controlHintEl = document.getElementById('control-hint');
const btnAutoFly = document.getElementById('btn-autofly');
const btnReset = document.getElementById('btn-reset');
const btnReload = document.getElementById('btn-reload');
const btnErrorRetry = document.getElementById('btn-error-retry');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const timeoutBanner = document.getElementById('timeout-banner');
const btnTimeoutRetry = document.getElementById('btn-timeout-retry');

const uiStates = {
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  FALLBACK: 'FALLBACK',
  READY: 'READY',
};

function setProgress(pct, text) {
  if (loadingProgress) loadingProgress.style.width = pct + '%';
  if (loadingText) loadingText.textContent = text;
  if (controlHintEl) controlHintEl.textContent = text.replace(/^\d+% — /, '');
}

function setState(state) {
  loading.classList.remove('visible');
  errorEl.classList.remove('visible');
  timeoutBanner.classList.remove('visible');
  controlHintEl.textContent = 'Drag to look • Pinch to zoom • WASD to fly • ';
  switch (state) {
    case uiStates.LOADING:
      loading.classList.add('visible');
      break;
    case uiStates.ERROR:
      errorEl.classList.add('visible');
      break;
    case uiStates.FALLBACK:
      timeoutBanner.classList.add('visible');
      break;
    case uiStates.READY:
    default:
      break;
  }
}

function showError(msg) {
  loadError = msg;
  if (errorMsg) errorMsg.textContent = msg;
  setState(uiStates.ERROR);
}

function hideError() {
  errorEl.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const vertexShader = `
attribute float size;
attribute float opacity;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = max(size * (220.0 / -mvPosition.z), 1.2);
  vColor = color;
  vOpacity = opacity;
}
`;

const fragmentShader = `
varying vec3 vColor;
varying float vOpacity;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float gauss = exp(-(dist * dist) / (2.0 * 0.22 * 0.22));
  float alpha = vOpacity * gauss;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function start() {
  hideError();
  abortCurrentLoad();
  setState(uiStates.LOADING);
  setProgress(0, '0% — Initializing engine…');
  try {
    initScene();
  } catch (err) {
    showError('Engine init failed: ' + (err.message || String(err)));
    return;
  }
  setProgress(15, '15% — Engine ready, connecting to splats…');
  const p = loadSplatsUrlWithFallback(
    (loaded, total) => {
      const pct = total > 0 ? Math.min(15 + Math.floor((loaded / total) * 75), 89) : 15;
      const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
      const totalMB = total ? (total / (1024 * 1024)).toFixed(2) : '?';
      setProgress(pct, `${pct}% — Downloading splats… (${loadedMB} / ${totalMB} MB)`);
    }
  );
  const watchdog = timeoutPromise(p, LOAD_TIMEOUT_MS, 'Splat load timeout');
  watchdog.then(async (data) => {
    currentAbortController = null;
    setProgress(92, '92% — Parsing & uploading 703k splats to GPU…');
    // Yield one animation frame so the UI paints the 92% state before heavy GPU upload
    await new Promise((r) => requestAnimationFrame(r));
    lastTime = performance.now();
    animate();
  }).catch((err) => {
    console.warn('Splat load fell back:', err.message);
    abortCurrentLoad();
    setState(uiStates.FALLBACK);
    const data = generateFallback();
    buildPoints(data);
    splatCountEl.textContent = `Splats: ${data.count.toLocaleString()} (fallback)`;
    controlHintEl.textContent = 'Drag to look • Pinch to zoom • WASD to fly • ';
    resetView();
    setProgress(100, '100% — Ready');
    lastTime = performance.now();
    animate();
  });
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060609);
  scene.fog = new THREE.FogExp2(0x060609, 0.006);

  camera = new THREE.PerspectiveCamera(FOV, container.clientWidth / container.clientHeight, NEAR, FAR);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Hook Three.js r170 shader debug to surface GLSL compile/link errors verbatim
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {
    const vsLog = gl.getShaderInfoLog(glVertexShader) || '(none)';
    const fsLog = gl.getShaderInfoLog(glFragmentShader) || '(none)';
    const progLog = gl.getProgramInfoLog(program) || '(none)';
    showError('GLSL shader error:\\nVERTEX: ' + vsLog + '\\nFRAGMENT: ' + fsLog + '\\nPROGRAM: ' + progLog);
  };

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 4000;
  controls.autoRotate = false;

  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('resize', onResize);

  btnAutoFly.addEventListener('click', () => {
    autoFly = !autoFly;
    btnAutoFly.classList.toggle('active', autoFly);
    controls.enabled = !autoFly;
  });
  btnReset.addEventListener('click', resetView);
  btnReload.addEventListener('click', () => start());
  btnErrorRetry.addEventListener('click', () => start());
  btnFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      if (!(buf instanceof ArrayBuffer)) return;
      loadSplats(buf, null, detectFormat(buf)).catch((err) => {
        console.error('Load failed:', err);
        splatCountEl.textContent = 'Error loading file';
      });
    };
    reader.onerror = () => { splatCountEl.textContent = 'Error reading file'; };
    reader.readAsArrayBuffer(file);
  });
  btnTimeoutRetry.addEventListener('click', () => {
    timeoutBanner.classList.remove('visible');
    start();
  });
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function resetView() {
  if (!splats) return;
  const geom = splats.geometry;
  if (!geom.boundingSphere) geom.computeBoundingSphere();
  const s = geom.boundingSphere;
  center.copy(s.center);
  radius = Math.max(s.radius, 3);
  autoHeight = center.y + radius * 0.55;
  controls.target.copy(center);
  camera.position.set(center.x, center.y + radius, center.z + radius * 1.6);
  camera.lookAt(center);
  controls.update();
}

function updateFly(dt) {
  if (!controls.enabled || autoFly || !camera) return;
  const move = new THREE.Vector3();
  camera.getWorldDirection(move);
  move.y = 0;
  move.normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, move).normalize();
  const speed = FLY_SPEED * dt;
  if (keys['KeyW'] || keys['ArrowUp']) camera.position.addScaledVector(move, speed);
  if (keys['KeyS'] || keys['ArrowDown']) camera.position.addScaledVector(move, -speed);
  if (keys['KeyD'] || keys['ArrowRight']) camera.position.addScaledVector(right, speed);
  if (keys['KeyA'] || keys['ArrowLeft']) camera.position.addScaledVector(right, -speed);
  if (keys['Space']) camera.position.y += speed;
  if (keys['ShiftLeft'] || keys['ShiftRight']) camera.position.y -= speed;
  controls.update();
}

function updateAutoFly(dt) {
  if (!autoFly || !splats || !camera) return;
  autoAngle += AUTO_SPEED * dt;
  const x = center.x + Math.cos(autoAngle) * radius;
  const z = center.z + Math.sin(autoAngle) * radius;
  camera.position.set(x, autoHeight, z);
  camera.lookAt(center);
  controls.update();
}

let _firstRenderDone = false;

function animate(now = 0) {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  if (lastTime === 0) { lastTime = now; return; }
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
  lastTime = now;
  updateFly(dt);
  updateAutoFly(dt);
  if (!autoFly && controls) controls.update();
  try {
    renderer.render(scene, camera);
  } catch (err) {
    showError('WebGL render failed: ' + (err.message || String(err)));
    return;
  }
  if (!_firstRenderDone) {
    _firstRenderDone = true;
    const gl = renderer.getContext();
    if (gl) {
      const err = gl.getError();
      if (err !== gl.NO_ERROR) {
        showError('WebGL error after first render: 0x' + err.toString(16));
        return;
      }
    }
    // Check shader program info log for GLSL compile/link warnings
    if (splats && splats.material && splats.material.program) {
      const log = splats.material.program.log || '';
      if (log && log.length > 0) {
        console.warn('Shader program log:', log);
      }
    }
    setProgress(100, '100% — Ready');
    setState(uiStates.READY);
  }
}

// ---------------------------------------------------------------------------
// Format detection + parsers
// ---------------------------------------------------------------------------
function detectFormat(bytes) {
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4)));
  return header.startsWith('ply') ? 'ply' : 'splat';
}

function parseSplat(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const count = Math.floor(bytes.length / 32);
  if (count === 0 || bytes.length % 32 !== 0) return null;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);

  const f32 = new Float32Array(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);

  for (let i = 0; i < count; i++) {
    const base = i * 8;
    const cbase = i * 32 + 24;
    const pi = i * 3;

    positions[pi] = f32[base];
    positions[pi + 1] = f32[base + 1];
    positions[pi + 2] = f32[base + 2];

    const sx = f32[base + 3];
    const sy = f32[base + 4];
    const sz = f32[base + 5];
    sizes[i] = (sx + sy + sz) / 3;

    colors[pi] = u8[cbase] / 255;
    colors[pi + 1] = u8[cbase + 1] / 255;
    colors[pi + 2] = u8[cbase + 2] / 255;

    opacities[i] = u8[cbase + 3] / 255;
  }

  return { count, positions, colors, sizes, opacities };
}

async function loadSplatsUrlWithFallback(onProgress) {
  try {
    return await loadSplats(SPLAT_URL, onProgress, 'splat');
  } catch (e) {
    if (e.message && e.message.includes('HTTP 404')) {
      console.log('.splat not found, falling back to .ply');
      return await loadSplats(DEFAULT_URL, onProgress, 'ply');
    }
    throw e;
  }
}

async function loadSplats(input, onProgress, formatHint) {
  abortCurrentLoad();
  const controller = new AbortController();
  currentAbortController = controller;
  const signal = controller.signal;
  try {
    let buf;
    let fmt = formatHint;
    if (input instanceof ArrayBuffer) {
      buf = new Uint8Array(input);
      if (!fmt) fmt = detectFormat(buf);
      if (onProgress) onProgress(100, 100);
    } else {
      const res = await timeoutPromise(fetch(input, { signal }), FETCH_TIMEOUT_MS, `Fetch timeout: ${input}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        if (onProgress) onProgress(loaded, total);
      }
      buf = new Uint8Array(loaded);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
      if (!fmt) fmt = detectFormat(buf);
    }
    currentAbortController = null;

    let data;
    if (fmt === 'splat') {
      data = parseSplat(buf);
    } else {
      data = parsePly(buf);
    }
    if (!data || data.count === 0) throw new Error('empty splat data');
    buildPoints(data);
    splatCountEl.textContent = `Splats: ${data.count.toLocaleString()}`;
    controlHintEl.textContent = 'Drag to look • Pinch to zoom • WASD to fly • ';
    resetView();
    setProgress(100, '100% — Ready');
    setState(uiStates.READY);
    return data;
  } catch (e) {
    currentAbortController = null;
    console.warn('Load failed:', e);
    throw e;
  }
}

function parsePly(input) {
  let bytes;
  let headerText;
  let dataStart = 0;
  if (typeof input === 'string') {
    headerText = input;
  } else {
    bytes = new Uint8Array(input);
    const headText = new TextDecoder().decode(bytes.subarray(0, 8192));
    const endIdx = headText.indexOf('end_header');
    if (endIdx === -1) return null;
    dataStart = endIdx + 'end_header'.length;
    if (headText[dataStart] === '\n') dataStart++;
    else if (headText[dataStart] === '\r') dataStart += 2;
    headerText = headText.slice(0, endIdx);
  }

  const lines = headerText.split(/\r?\n/);
  let i = 0;
  const next = () => lines[i++].trim();
  const magic = next();
  if (magic !== 'ply') return null;
  let format = 'ascii';
  const elements = [];
  let cur = null;
  while (i < lines.length) {
    const line = next();
    if (line === 'end_header') break;
    const p = line.split(/\s+/);
    if (p[0] === 'format') format = p[1];
    else if (p[0] === 'comment' || p[0] === 'obj_info') continue;
    else if (p[0] === 'element') {
      cur = { name: p[1], count: parseInt(p[2]) || 0, props: [] };
      elements.push(cur);
    } else if (p[0] === 'property' && cur) {
      if (p[1] === 'list') cur.props.push({ list: true, countType: p[2], itemType: p[3], name: p[4] });
      else cur.props.push({ list: false, type: p[1], name: p[2] });
    }
  }

  const typeSize = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, double: 8 };
  const readerMap = {
    float: (dv, o, l) => dv.getFloat32(o, l),
    double: (dv, o, l) => dv.getFloat64(o, l),
    int: (dv, o, l) => dv.getInt32(o, l),
    uint: (dv, o, l) => dv.getUint32(o, l),
    short: (dv, o, l) => dv.getInt16(o, l),
    ushort: (dv, o, l) => dv.getUint16(o, l),
    char: (dv, o) => dv.getInt8(o),
    uchar: (dv, o) => dv.getUint8(o),
  };

  const vertex = elements.find((e) => e.name === 'vertex');
  if (!vertex) return null;
  const count = vertex.count;

  const propReaders = {};
  let stride = 0;
  for (const pr of vertex.props) {
    if (pr.list) continue;
    propReaders[pr.name] = { offset: stride, type: pr.type };
    stride += typeSize[pr.type] || 1;
  }

  const readProp = (dv, base, little, name) => {
    const r = propReaders[name];
    if (!r) return NaN;
    return readerMap[r.type](dv, base + r.offset, little);
  };

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);

  const hasR = !!propReaders['red'];
  const hasG = !!propReaders['green'];
  const hasB = !!propReaders['blue'];
  const hasFdc = !!propReaders['f_dc_0'];
  const hasOpacity = !!propReaders['opacity'];
  const hasScale = !!propReaders['scale_0'];

  if (format === 'ascii') {
    const get = (vals, name) => { const o = propReaders[name]; return o === undefined ? NaN : parseFloat(vals[o.offset]); };
    let written = 0;
    let li = 0;
    while (li < lines.length && written < count) {
      const line = lines[li++];
      if (!line.trim()) continue;
      const vals = line.trim().split(/\s+/);
      const x = get(vals, 'x'), y = get(vals, 'y'), z = get(vals, 'z');
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      const pi = written * 3;
      positions[pi] = x; positions[pi + 1] = y; positions[pi + 2] = z;
      if (hasR && hasG && hasB) {
        colors[pi] = Math.max(0, Math.min(1, (get(vals, 'red') || 0) / 255));
        colors[pi + 1] = Math.max(0, Math.min(1, (get(vals, 'green') || 0) / 255));
        colors[pi + 2] = Math.max(0, Math.min(1, (get(vals, 'blue') || 0) / 255));
      } else if (hasFdc) {
        colors[pi] = 0.5 + get(vals, 'f_dc_0');
        colors[pi + 1] = 0.5 + get(vals, 'f_dc_1');
        colors[pi + 2] = 0.5 + get(vals, 'f_dc_2');
      } else {
        colors[pi] = 0.7; colors[pi + 1] = 0.8; colors[pi + 2] = 1.0;
      }
      sizes[written] = hasScale ? Math.max(0.02, (get(vals, 'scale_0') + get(vals, 'scale_1') + get(vals, 'scale_2')) / 3) : 0.1;
      opacities[written] = hasOpacity ? get(vals, 'opacity') : 0.9;
      written++;
    }
    return finalize(written, positions, colors, sizes, opacities);
  }

  if (format !== 'binary_little_endian' && format !== 'binary_big_endian') return null;
  if (!bytes) return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset + dataStart);
  const little = format === 'binary_little_endian';
  const totalBytes = dv.byteLength;

  let written = 0;
  let byteOff = 0;
  while (written < count && byteOff + stride <= totalBytes) {
    const base = byteOff;
    const x = readProp(dv, base, little, 'x');
    const y = readProp(dv, base, little, 'y');
    const z = readProp(dv, base, little, 'z');
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { byteOff += stride; continue; }
    const pi = written * 3;
    positions[pi] = x; positions[pi + 1] = y; positions[pi + 2] = z;
    if (hasR && hasG && hasB) {
      colors[pi] = Math.max(0, Math.min(1, readProp(dv, base, little, 'red') / 255));
      colors[pi + 1] = Math.max(0, Math.min(1, readProp(dv, base, little, 'green') / 255));
      colors[pi + 2] = Math.max(0, Math.min(1, readProp(dv, base, little, 'blue') / 255));
    } else if (hasFdc) {
      colors[pi] = 0.5 + readProp(dv, base, little, 'f_dc_0');
      colors[pi + 1] = 0.5 + readProp(dv, base, little, 'f_dc_1');
      colors[pi + 2] = 0.5 + readProp(dv, base, little, 'f_dc_2');
    } else {
      colors[pi] = 0.7; colors[pi + 1] = 0.8; colors[pi + 2] = 1.0;
    }
    sizes[written] = hasScale ? Math.max(0.02, (readProp(dv, base, little, 'scale_0') + readProp(dv, base, little, 'scale_1') + readProp(dv, base, little, 'scale_2')) / 3) : 0.1;
    opacities[written] = hasOpacity ? readProp(dv, base, little, 'opacity') : 0.9;
    byteOff += stride;
    written++;
  }
  return finalize(written, positions, colors, sizes, opacities);
}

function finalize(count, positions, colors, sizes, opacities) {
  return {
    count,
    positions: positions.slice(0, count * 3),
    colors: colors.slice(0, count * 3),
    sizes: sizes.slice(0, count),
    opacities: opacities.slice(0, count),
  };
}

function buildPoints(data) {
  if (splats) {
    splats.geometry.dispose();
    splats.material.dispose();
    scene.remove(splats);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(data.sizes, 1));
  geometry.setAttribute('opacity', new THREE.BufferAttribute(data.opacities, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  splats = new THREE.Points(geometry, material);
  splats.frustumCulled = false;
  scene.add(splats);
}

function generateFallback() {
  const count = 24000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);
  const rnd = () => Math.random();
  for (let i = 0; i < count; i++) {
    const pi = i * 3;
    if (i < count * 0.6) {
      positions[pi] = (rnd() - 0.5) * 30;
      positions[pi + 1] = 0.1;
      positions[pi + 2] = (rnd() - 0.5) * 30;
      colors[pi] = 0.34 + rnd() * 0.14;
      colors[pi + 1] = 0.52 + rnd() * 0.18;
      colors[pi + 2] = 0.34 + rnd() * 0.14;
      sizes[i] = 0.12 + rnd() * 0.22;
    } else {
      const t = rnd() * Math.PI * 2;
      const radius = 2 + rnd() * 10;
      positions[pi] = Math.cos(t) * radius + (rnd() - 0.5) * 3;
      positions[pi + 1] = 0.5 + rnd() * 5;
      positions[pi + 2] = Math.sin(t) * radius + (rnd() - 0.5) * 3;
      colors[pi] = 0.6 + rnd() * 0.4;
      colors[pi + 1] = 0.5 + rnd() * 0.4;
      colors[pi + 2] = 0.85 + rnd() * 0.15;
      sizes[i] = 0.08 + rnd() * 0.16;
    }
    opacities[i] = 0.7 + rnd() * 0.3;
  }
  return { count, positions, colors, sizes, opacities };
}

start();
