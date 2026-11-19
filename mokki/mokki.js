import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Boot marker so the inline watchdog knows mokki.js executed
window.__MOKKI_BOOTED__ = true;
document.body.style.background = '#d8e2e8';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GLB_URL = '/mokki/cabin.glb';
const SPLAT_URL = '/mokki/cabin.splat';
const SPZ_URL = '/mokki/cabin.spz';
const PLY_URL = '/mokki/cabin.ply';
const FOV = 60;
const NEAR = 0.01;
const FAR = 2000;
const FLY_SPEED = 6;
const AUTO_SPEED = 0.5;

const LOAD_TIMEOUT_MS = 60000;
const FETCH_TIMEOUT_MS = 60000;

// On-demand render settings
const RENDER_IDLE_MS = 450;

// Camera ease duration (seconds)
const CAM_EASE_DURATION = 1.4;

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let scene, camera, renderer, controls, splats, gltfScene;
let sparkMesh = null;
let center = new THREE.Vector3();
let radius = 10;
let autoFly = false;
let autoAngle = 0;
let autoHeight = 0;
const keys = {};
let lastTime = 0;

// On-demand render state
let needsRender = true;
let lastInteraction = 0;

// Camera ease state
let camEase = null; // { startPos, endPos, startTarget, endTarget, t, duration }

// Progressive LOD + depth sort state (splats only)
let activeCount = 60000;
let sortIndices = null;
let viewZBuffer = null;
let strideIndices = null;
let lastCameraPos = null;
let lastCameraLook = null;
let frameCount = 0;
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
const btnFlipAxis = document.getElementById('btn-flip-axis');
const btnSavePhoto = document.getElementById('btn-save-photo');
const btnReload = document.getElementById('btn-reload');
const btnErrorRetry = document.getElementById('btn-error-retry');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const timeoutBanner = document.getElementById('timeout-banner');
const btnTimeoutRetry = document.getElementById('btn-timeout-retry');
const pillYard = document.getElementById('pill-yard');
const pillFront = document.getElementById('pill-front');
const pillSide = document.getElementById('pill-side');
const pillBird = document.getElementById('pill-bird');

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
  if (loading) loading.classList.remove('visible');
  if (errorEl) errorEl.classList.remove('visible');
  if (timeoutBanner) timeoutBanner.classList.remove('visible');
  if (controlHintEl) controlHintEl.textContent = 'Drag to look • Pinch to zoom • WASD to fly • ';
  switch (state) {
    case uiStates.LOADING:
      if (loading) loading.classList.add('visible');
      break;
    case uiStates.ERROR:
      if (errorEl) errorEl.classList.add('visible');
      break;
    case uiStates.FALLBACK:
      if (timeoutBanner) timeoutBanner.classList.add('visible');
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
  if (errorEl) errorEl.classList.remove('visible');
}

// Mark that user interaction happened — keeps rendering alive for RENDER_IDLE_MS
function markInteraction() {
  lastInteraction = performance.now();
  needsRender = true;
}

// ---------------------------------------------------------------------------
// Shaders (fallback splat renderer)
// ---------------------------------------------------------------------------
const vertexShader = `
attribute float size;
attribute float opacity;
uniform float uPointScale;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float screenSize = size * uPointScale * (uPixelRatio * 220.0 / -mvPosition.z);
  gl_PointSize = clamp(screenSize, 2.0, 24.0);
  vColor = color;
  vOpacity = opacity;
}
`;

const fragmentShader = `
uniform float uOpacity;
varying vec3 vColor;
varying float vOpacity;
void main() {
  float r2 = dot(gl_PointCoord - vec2(0.5), gl_PointCoord - vec2(0.5));
  if (r2 > 1.0) discard;
  float alpha = exp(-3.0 * r2) * vOpacity * uOpacity;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

// ---------------------------------------------------------------------------
// Spark (2026 Gaussian Splatting) loader
// ---------------------------------------------------------------------------
let SparkMesh = null;
let sparkTried = false;

async function loadSpark() {
  if (sparkTried) return SparkMesh;
  sparkTried = true;
  try {
    const mod = await import('@sparkjsdev/spark');
    SparkMesh = mod.SplatMesh || mod.SparkMeshLoader || mod.Spark || mod.default || null;
  } catch (e) {
    console.warn('@sparkjsdev/spark not available:', e.message);
  }
  return SparkMesh;
}

async function loadSparkSplat(url) {
  const Cls = await loadSpark();
  if (!Cls) throw new Error('@sparkjsdev/spark module not available');
  const inst = new Cls();
  // Try common method names
  if (typeof inst.load === 'function') await inst.load(url);
  else if (typeof inst.loadSplat === 'function') await inst.loadSplat(url);
  else if (typeof inst.loadSplatFile === 'function') await inst.loadSplatFile(url);
  else throw new Error('Spark mesh has no load method');
  // Attach to scene
  if (inst.scene) scene.add(inst.scene);
  else if (inst.mesh) scene.add(inst.mesh);
  else if (inst.add) inst.add(scene);
  return inst;
}

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
  setProgress(15, '15% — Engine ready, connecting to assets…');
  loadAssetUrlWithFallback(
    (loaded, total) => {
      const pct = total > 0 ? Math.min(15 + Math.floor((loaded / total) * 75), 89) : 15;
      const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
      const totalMB = total ? (total / (1024 * 1024)).toFixed(2) : '?';
      setProgress(pct, `${pct}% — Downloading assets… (${loadedMB} / ${totalMB} MB)`);
    }
  );
}

function loadAssetUrlWithFallback(onProgress) {
  // Priority: .spz → .splat → .glb → .ply
  loadSPZ(SPZ_URL, onProgress)
    .then((inst) => { sparkMesh = inst; renderMode = 'spark'; finishLoad(); })
    .catch((e1) => {
      console.warn('SPZ load failed:', e1.message);
      loadSplat(SPLAT_URL, onProgress)
        .then((data) => { renderMode = 'splat'; finishSplat(data); })
        .catch((e2) => {
          console.warn('SPLAT load failed:', e2.message);
          loadGlb(GLB_URL, onProgress)
            .then((gltf) => { renderMode = 'gltf'; buildGltf(gltf); finishLoad(); })
            .catch((e3) => {
              console.warn('GLB load failed:', e3.message);
              loadPly(PLY_URL, onProgress)
                .then((data) => { renderMode = 'ply'; finishSplat(data); })
                .catch((e4) => {
                  console.warn('PLY load failed:', e4.message);
                  setState(uiStates.ERROR);
                  showError('All asset loads failed: ' + (e4.message || String(e4)));
                });
            });
        });
    });
}

function finishLoad() {
  currentAbortController = null;
  setProgress(92, '92% — Parsing & uploading assets to GPU…');
  // Yield one animation frame so the UI paints before heavy GPU upload
  requestAnimationFrame(() => {
    lastTime = performance.now();
    animate();
  });
}

function finishSplat(data) {
  currentAbortController = null;
  buildPoints(data);
  splatCountEl.textContent = `Splats: ${data.count.toLocaleString()}`;
  controlHintEl.textContent = 'Drag to look • Pinch to zoom • WASD to fly • ';
  resetView();
  activeCount = Math.min(60000, data.count);
  frameCount = 0;
  lastCameraPos = null;
  lastCameraLook = null;
  setProgress(100, '100% — Ready');
  setState(uiStates.READY);
  lastTime = performance.now();
  animate();
}

// ---------------------------------------------------------------------------
// Asset fetchers (with progress + AbortController)
// ---------------------------------------------------------------------------
function fetchBytes(url, onProgress) {
  return new Promise((resolve, reject) => {
    abortCurrentLoad();
    const controller = new AbortController();
    currentAbortController = controller;
    const signal = controller.signal;
    fetch(url, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length') || 0);
        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;
        return new Promise((resolveRead, rejectRead) => {
          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) {
                const buf = new Uint8Array(loaded);
                let off = 0;
                for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
                // Detect Git LFS pointer file
                const header = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 64)));
                if (header.startsWith('version https://git-lfs')) {
                  const mediaUrl = 'https://media.githubusercontent.com/media/Rustoga/Composer/main/mokki/cabin.glb';
                  fetch(mediaUrl).then((res2) => {
                    if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
                    return res2.arrayBuffer();
                  }).then((buf2) => {
                    currentAbortController = null;
                    const ab = buf2 instanceof ArrayBuffer ? buf2 : buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength);
                    const dv = new DataView(ab);
                    const magic = dv.getUint32(0, true);
                    if (magic !== 0x46546C67) {
                      const first16 = Array.from(new Uint8Array(ab.slice(0, 16))).map((b) => b.toString(16).padStart(2, '0')).join(' ');
                      rejectRead(new Error('GLTFLoader: bad magic 0x' + magic.toString(16) + ', first 16 bytes: ' + first16));
                    } else {
                      resolveRead(ab);
                    }
                  }).catch(rejectRead);
                } else {
                  currentAbortController = null;
                  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                  const dv = new DataView(ab);
                  const magic = dv.getUint32(0, true);
                  if (magic !== 0x46546C67) {
                    const first16 = Array.from(new Uint8Array(ab.slice(0, 16))).map((b) => b.toString(16).padStart(2, '0')).join(' ');
                    rejectRead(new Error('GLTFLoader: bad magic 0x' + magic.toString(16) + ', first 16 bytes: ' + first16));
                  } else {
                    resolveRead(ab);
                  }
                }
              } else {
                chunks.push(value);
                loaded += value.byteLength;
                if (onProgress) onProgress(loaded, total);
                pump();
              }
            }).catch(rejectRead);
          }
          pump();
        });
      })
      .then((ab) => {
        // Verify magic
        const dv = new DataView(ab);
        const magic = dv.getUint32(0, true);
        if (magic !== 0x46546C67) {
          const first16 = Array.from(new Uint8Array(ab.slice(0, 16))).map((b) => b.toString(16).padStart(2, '0')).join(' ');
          reject(new Error('Bad magic 0x' + magic.toString(16) + ', first 16 bytes: ' + first16));
        } else {
          resolve(ab);
        }
      })
      .catch((err) => {
        currentAbortController = null;
        reject(err);
      });
  });
}

function loadSPZ(url, onProgress) {
  return fetchBytes(url, onProgress).then((ab) => loadSparkSplatFromBuffer(ab));
}

function loadSplat(url, onProgress) {
  return fetchBytes(url, onProgress).then((ab) => parseSplat(ab));
}

function loadPly(url, onProgress) {
  return fetchBytes(url, onProgress).then((ab) => parsePly(ab));
}

function loadGlb(url, onProgress) {
  return fetchBytes(url, onProgress).then((ab) => parseGlb(ab));
}

function loadSparkSplatFromBuffer(ab) {
  return new Promise((resolve, reject) => {
    loadSpark().then((Cls) => {
      if (!Cls) reject(new Error('@sparkjsdev/spark not available'));
      else {
        // Spark may accept ArrayBuffer or URL; try loading from buffer via blob URL
        const blob = new Blob([ab], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        const inst = new Cls();
        const p = typeof inst.load === 'function' ? inst.load(blobUrl)
          : typeof inst.loadSplat === 'function' ? inst.loadSplat(blobUrl)
          : Promise.reject(new Error('No load method'));
        p.then(() => {
          URL.revokeObjectURL(blobUrl);
          if (inst.scene) scene.add(inst.scene);
          else if (inst.mesh) scene.add(inst.mesh);
          else if (typeof inst.add === 'function') inst.add(scene);
          resolve(inst);
        }).catch((e) => {
          URL.revokeObjectURL(blobUrl);
          reject(e);
        });
      }
    }).catch(reject);
  });
}

function parseGlb(ab) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(ab, '', (gltf) => {
      const root = gltf?.scene || gltf?.scenes?.[0];
      if (!root) reject(new Error('GLTF parsed but contains no scene nodes'));
      else resolve(gltf);
    }, (err) => {
      reject(new Error('GLTFLoader parse failed: ' + (err.message || String(err))));
    });
  });
}

function loadGlbFromBuffer(buf) {
  return parseGlb(buf);
}

// ---------------------------------------------------------------------------
// Scene init
// ---------------------------------------------------------------------------
function initScene() {
  scene = new THREE.Scene();
  // Warm Nordic sky gradient
  scene.background = new THREE.Color(0x1a222d);
  scene.fog = new THREE.FogExp2(0x060609, 0.006);

  camera = new THREE.PerspectiveCamera(FOV, container.clientWidth / container.clientHeight, NEAR, FAR);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x1a222d, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {
    const vsLog = gl.getShaderInfoLog(glVertexShader) || '(none)';
    const fsLog = gl.getShaderInfoLog(glFragmentShader) || '(none)';
    const progLog = gl.getProgramInfoLog(program) || '(none)';
    showError('GLSL shader error:\\nVERTEX: ' + vsLog + '\\nFRAGMENT: ' + fsLog + '\\nPROGRAM: ' + progLog);
  };

  // Lighting for .glb
  const ambientLight = new THREE.AmbientLight(0xffffff, 2.2);
  scene.add(ambientLight);
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x776655, 1.0);
  scene.add(hemiLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.5;
  controls.maxDistance = 4000;
  controls.autoRotate = false;
  controls.maxPolarAngle = Math.PI * 0.52;

  window.addEventListener('keydown', (e) => { keys[e.code] = true; markInteraction(); });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; markInteraction(); });
  window.addEventListener('resize', onResize);
  window.addEventListener('mousedown', markInteraction);
  window.addEventListener('mousemove', markInteraction);
  window.addEventListener('touchstart', markInteraction);
  window.addEventListener('touchmove', markInteraction);

  // Controls change → render
  controls.addEventListener('change', () => { needsRender = true; });

  btnAutoFly.addEventListener('click', () => {
    autoFly = !autoFly;
    if (btnAutoFly) btnAutoFly.classList.toggle('active', autoFly);
    controls.enabled = !autoFly;
    markInteraction();
  });
  let flipUpAxis = false;
  btnFlipAxis.addEventListener('click', () => {
    flipUpAxis = !flipUpAxis;
    if (btnFlipAxis) btnFlipAxis.classList.toggle('active', flipUpAxis);
    if (renderMode === 'gltf' && gltfScene) {
      gltfScene.traverse((obj) => {
        if (obj.isMesh && obj.geometry && obj.geometry.attributes.position) {
          const pos = obj.geometry.attributes.position.array;
          for (let i = 0; i < pos.length; i += 3) {
            const y = pos[i + 1];
            const z = pos[i + 2];
            pos[i + 1] = z;
            pos[i + 2] = y;
          }
          obj.geometry.attributes.position.needsUpdate = true;
          obj.geometry.computeBoundingBox();
          obj.geometry.computeBoundingSphere();
        }
      });
      gltfScene.updateMatrixWorld();
      resetView();
    } else if (renderMode === 'splat' && splats) {
      const positions = splats.geometry.attributes.position.array;
      const count = positions.length / 3;
      for (let i = 0; i < count; i++) {
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        positions[i * 3 + 1] = z;
        positions[i * 3 + 2] = y;
      }
      splats.geometry.attributes.position.needsUpdate = true;
      splats.geometry.computeBoundingSphere();
      resetView();
    }
    markInteraction();
  });
  btnSavePhoto.addEventListener('click', savePhoto);
  btnReload.addEventListener('click', () => start());
  btnErrorRetry.addEventListener('click', () => start());
  if (btnFile) btnFile.addEventListener('click', () => fileInput.click());
  if (fileInput) fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      if (!(buf instanceof ArrayBuffer)) return;
      const fmt = detectFormat(buf);
      if (fmt === 'glb' || fmt === 'gltf') {
        loadGlbFromBuffer(buf).then((gltf) => {
          renderMode = 'gltf';
          gltfScene = gltf.scene;
          buildGltf(gltf);
          setProgress(100, '100% — Ready');
          setState(uiStates.READY);
          lastTime = performance.now();
          animate();
        }).catch((err) => {
          console.error('GLB load failed:', err);
          if (splatCountEl) splatCountEl.textContent = 'Error loading file';
        });
      } else if (fmt === 'spz') {
        loadSparkSplatFromBuffer(buf).then((inst) => {
          sparkMesh = inst;
          renderMode = 'spark';
          finishLoad();
        }).catch((err) => {
          console.error('SPZ load failed:', err);
          if (splatCountEl) splatCountEl.textContent = 'Error loading file';
        });
      } else {
        loadSplats(buf, null, fmt).catch((err) => {
          console.error('Load failed:', err);
          if (splatCountEl) splatCountEl.textContent = 'Error loading file';
        });
      }
    };
    reader.onerror = () => { if (splatCountEl) splatCountEl.textContent = 'Error reading file'; };
    reader.readAsArrayBuffer(file);
  });
  if (btnTimeoutRetry) btnTimeoutRetry.addEventListener('click', () => {
    if (timeoutBanner) timeoutBanner.classList.remove('visible');
    start();
  });

  // Camera preset pills
  if (pillYard) pillYard.addEventListener('click', () => setPillActive(pillYard, camPresetYard));
  if (pillFront) pillFront.addEventListener('click', () => setPillActive(pillFront, camPresetFront));
  if (pillSide) pillSide.addEventListener('click', () => setPillActive(pillSide, camPresetSide));
  if (pillBird) pillBird.addEventListener('click', () => setPillActive(pillBird, camPresetBird));
}

// ---------------------------------------------------------------------------
// Camera presets (Memory Postcards)
// ---------------------------------------------------------------------------
function setPillActive(activeEl, preset) {
  [pillYard, pillFront, pillSide, pillBird].forEach((p) => {
    if (p) p.classList.remove('active');
  });
  if (activeEl) activeEl.classList.add('active');
  startCameraEase(preset.pos, preset.target);
  markInteraction();
}

const camPresetYard = { pos: [0, 1.6, 12], target: [0, 1.6, 0] };
const camPresetFront = { pos: [0, 1.6, -10], target: [0, 1.6, 0] };
const camPresetSide = { pos: [-10, 1.6, 0], target: [0, 1.6, 0] };
const camPresetBird = { pos: [0, 14, 6], target: [0, 1.6, 0] };

function startCameraEase(endPos, endTarget) {
  camEase = {
    startPos: camera.position.clone(),
    endPos: new THREE.Vector3(endPos[0], endPos[1], endPos[2]),
    startTarget: controls.target.clone(),
    endTarget: new THREE.Vector3(endTarget[0], endTarget[1], endTarget[2]),
    t: 0,
    duration: CAM_EASE_DURATION,
  };
}

function updateCameraEase(dt) {
  if (!camEase) return false;
  camEase.t += dt / camEase.duration;
  if (camEase.t >= 1) {
    camEase.t = 1;
  }
  const et = easeInOutCubic(camEase.t);
  camera.position.lerpVectors(camEase.startPos, camEase.endPos, et);
  controls.target.lerpVectors(camEase.startTarget, camEase.endTarget, et);
  camera.lookAt(controls.target);
  controls.update();
  if (camEase.t >= 1) {
    camEase = null;
    needsRender = true;
    return false;
  }
  needsRender = true;
  return true;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  if (splats && splats.material && splats.material.uniforms.uPixelRatio) {
    splats.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 1.5);
  }
  needsRender = true;
}

// ---------------------------------------------------------------------------
// Reset view
// ---------------------------------------------------------------------------
function resetView() {
  if (renderMode === 'gltf' && gltfScene) {
    const box = new THREE.Box3().setFromObject(gltfScene);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    controls.target.set(0, 0, 0);
    const r = Math.max(sphere.radius, 1);
    camera.position.set(0, r * 0.4, r * 1.8);
    camera.near = r * 0.005;
    camera.far = r * 50;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    controls.update();
    needsRender = true;
    return;
  }
  if (!splats) return;
  const geom = splats.geometry;
  if (!geom.boundingSphere) geom.computeBoundingSphere();
  const s = geom.boundingSphere;
  center.copy(s.center);
  radius = Math.max(s.radius, 3);
  const eyeLevel = center.y - radius + 1.6;
  const camDist = radius * 1.4;
  controls.target.copy(center);
  camera.position.set(center.x, eyeLevel, center.z + camDist);
  camera.lookAt(center);
  controls.update();
  needsRender = true;
}

// ---------------------------------------------------------------------------
// Fly controls
// ---------------------------------------------------------------------------
function updateFly(dt) {
  if (!controls.enabled || autoFly || !camera) return false;
  let moved = false;
  const move = new THREE.Vector3();
  camera.getWorldDirection(move);
  move.y = 0;
  move.normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, move).normalize();
  const speed = FLY_SPEED * dt;
  if (keys['KeyW'] || keys['ArrowUp']) { camera.position.addScaledVector(move, speed); moved = true; }
  if (keys['KeyS'] || keys['ArrowDown']) { camera.position.addScaledVector(move, -speed); moved = true; }
  if (keys['KeyD'] || keys['ArrowRight']) { camera.position.addScaledVector(right, speed); moved = true; }
  if (keys['KeyA'] || keys['ArrowLeft']) { camera.position.addScaledVector(right, -speed); moved = true; }
  if (keys['Space']) { camera.position.y += speed; moved = true; }
  if (keys['ShiftLeft'] || keys['ShiftRight']) { camera.position.y -= speed; moved = true; }
  if (moved) controls.update();
  return moved;
}

function updateAutoFly(dt) {
  if (!autoFly || !camera) return false;
  autoAngle += AUTO_SPEED * dt;
  const x = center.x + Math.cos(autoAngle) * radius;
  const z = center.z + Math.sin(autoAngle) * radius;
  camera.position.set(x, autoHeight, z);
  camera.lookAt(center);
  controls.update();
  needsRender = true;
  return true;
}

// ---------------------------------------------------------------------------
// Save Photo
// ---------------------------------------------------------------------------
function savePhoto() {
  const hudTop = document.getElementById('hud-top');
  const hudBottom = document.getElementById('hud-bottom');
  const flash = document.getElementById('hud-save-flash');
  if (hudTop) hudTop.style.display = 'none';
  if (hudBottom) hudBottom.style.display = 'none';
  if (flash) flash.classList.add('flash');
  // Render one clean frame
  renderer.render(scene, camera);
  needsRender = true;
  // Export PNG
  setTimeout(() => {
    try {
      const dataURL = renderer.domElement.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = 'mokki-memory.png';
      link.href = dataURL;
      link.click();
    } catch (e) {
      console.error('Save photo failed:', e);
    }
    // Restore HUD
    setTimeout(() => {
      if (hudTop) hudTop.style.display = '';
      if (hudBottom) hudBottom.style.display = '';
      if (flash) flash.classList.remove('flash');
    }, 100);
  }, 50);
}

// ---------------------------------------------------------------------------
// Render loop (on-demand)
// ---------------------------------------------------------------------------
let _firstRenderDone = false;

function updateSortOrder() {
  if (!splats || !camera) return;
  const positions = splats.geometry.attributes.position.array;
  const count = positions.length / 3;
  const camPos = camera.position;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  if (!viewZBuffer || viewZBuffer.length !== count) viewZBuffer = new Float32Array(count);
  const viewZ = viewZBuffer;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - camPos.x;
    const dy = positions[i * 3 + 1] - camPos.y;
    const dz = positions[i * 3 + 2] - camPos.z;
    viewZ[i] = dx * camDir.x + dy * camDir.y + dz * camDir.z;
  }
  if (!sortIndices || sortIndices.length !== count) {
    sortIndices = new Uint32Array(count);
    for (let i = 0; i < count; i++) sortIndices[i] = i;
  }
  sortIndices.sort((a, b) => viewZ[b] - viewZ[a]);
}

function applyProgressiveLOD() {
  if (!splats || !sortIndices) return;
  const totalCount = sortIndices.length;
  const cameraMoving =
    lastCameraPos === null ||
    lastCameraLook === null ||
    camera.position.distanceTo(lastCameraPos) > 0.5 ||
    Math.abs(camera.getWorldDirection(new THREE.Vector3()).angleTo(lastCameraLook)) > 0.02;
  if (cameraMoving) {
    updateSortOrder();
    lastCameraPos = camera.position.clone();
    lastCameraLook = camera.getWorldDirection(new THREE.Vector3());
    activeCount = Math.min(activeCount * 2, totalCount);
  } else if (frameCount % 2 === 0) {
    activeCount = Math.min(activeCount + 5000, totalCount);
  }
  frameCount++;
  const stride = Math.max(1, Math.ceil(totalCount / activeCount));
  const drawnCount = Math.ceil(totalCount / stride);
  if (!strideIndices || strideIndices.length < drawnCount) {
    strideIndices = new Uint32Array(drawnCount);
  }
  for (let i = 0; i < drawnCount; i++) {
    strideIndices[i] = sortIndices[i * stride];
  }
  splats.geometry.setIndex(strideIndices);
  splats.geometry.setDrawRange(0, drawnCount);
  splats.material.uniforms.uPointScale.value = Math.sqrt(totalCount / drawnCount);
}

function animate(now = 0) {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  if (lastTime === 0) { lastTime = now; return; }
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
  lastTime = now;

  let needsUpdate = false;
  updateFly(dt);
  if (updateAutoFly(dt)) needsUpdate = true;
  if (updateCameraEase(dt)) needsUpdate = true;

  if (splats) {
    applyProgressiveLOD();
    needsUpdate = true;
  }

  // Render if: interaction within RENDER_IDLE_MS, anything moved, or explicit needsRender
  const interactionFresh = (performance.now() - lastInteraction) < RENDER_IDLE_MS;
  if (needsUpdate || needsRender || interactionFresh) {
    renderer.render(scene, camera);
    needsRender = false;
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
  if (header === 'glTF') return 'glb';
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
      return await loadSplats(PLY_URL, onProgress, 'ply');
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
    activeCount = Math.min(60000, data.count);
    frameCount = 0;
    lastCameraPos = null;
    lastCameraLook = null;
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
    uniforms: {
      uPointScale: { value: 3.0 },
      uOpacity: { value: 0.6 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
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

// ---------------------------------------------------------------------------
// GLTF scene setup
// ---------------------------------------------------------------------------
function buildGltf(gltf) {
  const root = gltf?.scene || gltf?.scenes?.[0];
  if (!root) {
    throw new Error('GLTF parsed but contains no scene nodes');
  }
  if (gltfScene) {
    scene.remove(gltfScene);
  }
  gltfScene = root;
  scene.add(root);

  // Normalize materials: MeshBasicMaterial for guaranteed visibility
  let meshCount = 0;
  let triCount = 0;
  root.traverse((child) => {
    if (child.isMesh) {
      meshCount++;
      child.frustumCulled = false;
      const geo = child.geometry;
      if (geo.index) {
        triCount += geo.index.count / 3;
      } else if (geo.attributes.position) {
        triCount += geo.attributes.position.count / 3;
      }
      if (child.material) {
        const oldMat = child.material;
        child.material = new THREE.MeshBasicMaterial({
          map: oldMat.map || null,
          vertexColors: (geo.attributes.color) ? true : false,
          side: THREE.DoubleSide,
        });
        child.material.needsUpdate = true;
      }
    }
  });

  root.updateMatrixWorld(true);
  const box1 = new THREE.Box3().setFromObject(root);
  const size1 = box1.getSize(new THREE.Vector3());
  const maxDim = Math.max(size1.x, size1.y, size1.z);
  const s = maxDim > 0 ? 20 / maxDim : 1;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const center2 = box2.getCenter(new THREE.Vector3());
  root.position.sub(center2);
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  box3.getCenter(center);
  const size3 = box3.getSize(new THREE.Vector3());
  radius = Math.max(size3.x, size3.y, size3.z) * 0.6;
  if (radius < 2) radius = 2;

  const grid = new THREE.GridHelper(30, 30, 0x334455, 0x223344);
  grid.position.y = box3.min.y;
  scene.add(grid);

  const dims = size3.toArray().map((n) => n.toFixed(2));
  if (splatCountEl) splatCountEl.textContent = `GLB: ${meshCount} mesh${meshCount !== 1 ? 'es' : ''}, ${Math.round(triCount)} tris, box=[${dims.join(', ')}]`;
  if (controlHintEl) controlHintEl.textContent = 'Drag to look • Pinch to zoom • WASD to fly • GLB loaded ✓';

  resetView();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
start();
