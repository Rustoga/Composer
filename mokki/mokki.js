import * as THREE from 'https://esm.sh/three@0.164.1';
import { PointerLockControls } from 'https://esm.sh/three@0.164.1/addons/controls/PointerLockControls.js?dep=three@0.164.1';

const container = document.getElementById('canvas-container');
const loading = document.getElementById('loading');
const splatCountEl = document.getElementById('splat-count');
const fileBtn = document.getElementById('file-btn');
const fileInput = document.getElementById('file-input');

const DEFAULT_URL = '/mokki/splats.ply';
const FOV = 75;
const NEAR = 0.01;
const FAR = 800;
const MOVE_SPEED = 5.5;

let scene, camera, renderer, controls, splats, clock;
const keys = {};

const vertexShader = `
attribute vec3 position;
attribute vec3 color;
attribute float size;
attribute float opacity;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec3 vColor;
varying float vOpacity;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = size * (150.0 / -mvPosition.z);
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
  float gauss = exp(-(dist * dist) / (2.0 * 0.17 * 0.17));
  float alpha = vOpacity * gauss;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b0f);
  scene.fog = new THREE.FogExp2(0x0b0b0f, 0.012);

  camera = new THREE.PerspectiveCamera(FOV, container.clientWidth / container.clientHeight, NEAR, FAR);
  camera.position.set(0, 1.6, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, document.body);

  container.addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => {
    document.querySelector('.sub').style.opacity = '0';
  });
  controls.addEventListener('unlock', () => {
    document.querySelector('.sub').style.opacity = '0.7';
  });

  window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Escape') controls.unlock(); });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('resize', onResize);

  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadSplats(url).then(() => URL.revokeObjectURL(url));
  });

  clock = new THREE.Clock();

  loadSplats(DEFAULT_URL).then(() => {
    loading.classList.add('hidden');
    animate();
  });
}

function onResize() {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function updateControls(dt) {
  if (!controls.isLocked) return;
  const speed = MOVE_SPEED * dt;
  if (keys['KeyW'] || keys['ArrowUp']) controls.moveForward(speed);
  if (keys['KeyS'] || keys['ArrowDown']) controls.moveForward(-speed);
  if (keys['KeyD'] || keys['ArrowRight']) controls.moveRight(speed);
  if (keys['KeyA'] || keys['ArrowLeft']) controls.moveRight(-speed);
  if (keys['Space']) camera.position.y += speed;
  if (keys['ShiftLeft'] || keys['ShiftRight']) camera.position.y -= speed;
}

async function loadSplats(url) {
  let data = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      data = parsePly(text);
    }
  } catch (e) {
    console.warn('PLY load failed:', e);
  }
  if (!data || data.count === 0) {
    console.log('Using fallback splat cloud');
    data = generateFallback();
  }
  buildPoints(data);
  splatCountEl.textContent = `Splats: ${data.count.toLocaleString()}`;
  return data;
}

function parsePly(text) {
  const lines = text.split(/\r?\n/);
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
  if (format !== 'ascii') return null;
  const vertex = elements.find((e) => e.name === 'vertex');
  if (!vertex) return null;
  const idx = {};
  let off = 0;
  for (const pr of vertex.props) idx[pr.name] = off++;
  const count = vertex.count;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);
  const hasR = idx['red'] !== undefined;
  const hasFdc = idx['f_dc_0'] !== undefined;
  const hasOpacity = idx['opacity'] !== undefined;
  const hasScale = idx['scale_0'] !== undefined;
  const get = (vals, name) => { const o = idx[name]; return o === undefined ? NaN : parseFloat(vals[o]); };
  let written = 0;
  while (i < lines.length && written < count) {
    const line = lines[i++];
    if (!line.trim()) continue;
    const vals = line.trim().split(/\s+/);
    const x = get(vals, 'x'), y = get(vals, 'y'), z = get(vals, 'z');
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    const pi = written * 3;
    positions[pi] = x; positions[pi + 1] = y; positions[pi + 2] = z;
    let r, g, b;
    if (hasR) { r = get(vals, 'red') / 255; g = get(vals, 'green') / 255; b = get(vals, 'blue') / 255; }
    else if (hasFdc) { r = 0.5 + get(vals, 'f_dc_0'); g = 0.5 + get(vals, 'f_dc_1'); b = 0.5 + get(vals, 'f_dc_2'); }
    else { r = 0.7; g = 0.8; b = 1.0; }
    colors[pi] = r; colors[pi + 1] = g; colors[pi + 2] = b;
    sizes[written] = hasScale ? (get(vals, 'scale_0') + get(vals, 'scale_1') + get(vals, 'scale_2')) / 3 : 0.1;
    opacities[written] = hasOpacity ? get(vals, 'opacity') : 0.9;
    written++;
  }
  return {
    count: written,
    positions: positions.slice(0, written * 3),
    colors: colors.slice(0, written * 3),
    sizes: sizes.slice(0, written),
    opacities: opacities.slice(0, written),
  };
}

function generateFallback() {
  const count = 16000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);
  const rnd = () => Math.random();
  for (let i = 0; i < count; i++) {
    const pi = i * 3;
    if (i < count * 0.65) {
      positions[pi] = (rnd() - 0.5) * 24;
      positions[pi + 1] = 0.05;
      positions[pi + 2] = (rnd() - 0.5) * 24;
      colors[pi] = 0.34 + rnd() * 0.14;
      colors[pi + 1] = 0.52 + rnd() * 0.18;
      colors[pi + 2] = 0.34 + rnd() * 0.14;
      sizes[i] = 0.12 + rnd() * 0.22;
    } else {
      const t = rnd() * Math.PI * 2;
      const radius = 1 + rnd() * 7;
      positions[pi] = Math.cos(t) * radius + (rnd() - 0.5) * 2;
      positions[pi + 1] = 0.5 + rnd() * 4.5;
      positions[pi + 2] = Math.sin(t) * radius + (rnd() - 0.5) * 2;
      colors[pi] = 0.6 + rnd() * 0.4;
      colors[pi + 1] = 0.5 + rnd() * 0.4;
      colors[pi + 2] = 0.85 + rnd() * 0.15;
      sizes[i] = 0.07 + rnd() * 0.16;
    }
    opacities[i] = 0.7 + rnd() * 0.3;
  }
  return { count, positions, colors, sizes, opacities };
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

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  updateControls(dt);
  renderer.render(scene, camera);
}

init();
