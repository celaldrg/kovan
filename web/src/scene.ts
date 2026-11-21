// The hive, cinematic edition: bloom-lit honeycomb, glowing vault core, fluttering bees,
// glowing data trails and a fly-in intro. Everything is procedural (no external assets).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Dept, Worker, Pulse } from './types';
import { icon } from './icons';

type WState = 'idle' | 'working' | 'approval' | 'stuck';
interface Bee {
  w: Worker; rig: THREE.Group; body: THREE.Group; wings: THREE.Object3D[]; cellRing: THREE.Mesh; arc: THREE.Mesh; alert: THREE.Mesh;
  home: THREE.Vector3; state: WState; phase: number; flash: number; hoverK: number; lift: number;
}
interface Zone { dept: Dept; center: THREE.Vector3; banner: THREE.Sprite; plate: THREE.Mesh; rim: THREE.Mesh; mast: THREE.Mesh; chip: HTMLElement; load: number; target: number; seed: number }
interface Flight { head: THREE.Sprite; trail: THREE.Points; hist: THREE.Vector3[]; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; t: number; dur: number }

const HEX = 1, SQ3 = Math.sqrt(3);
const axial = (q: number, r: number) => new THREE.Vector3(HEX * 1.5 * q, 0, HEX * SQ3 * (r + q / 2));
const RING = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const HOME_CAM = new THREE.Vector3(0, 19.5, 24.5);
const HOME_TARGET = new THREE.Vector3(0, 0, -1.4); // look a touch past the core so the far signs clear the top bar
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const PALETTES = {
  dark: { bg: 0x0a0c10, fog: 0x0a0c10, floor: 0x1a1e26, cell: 0x1d212a, glow: 0xffb224, hemiSky: 0xdfe8ff, hemiGround: 0x07090d, hemi: 0.75, exposure: 1.0, bloom: 0.7, fogD: 0.022 },
  light: { bg: 0xe9edf2, fog: 0xe9edf2, floor: 0xc9d0da, cell: 0xb9c2ce, glow: 0xe0920a, hemiSky: 0xffffff, hemiGround: 0x7d8696, hemi: 0.9, exposure: 0.92, bloom: 0.12, fogD: 0.009 },
};

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function stripeTexture(color: string) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d')!;
  const stops = [[0, color], [0.2, color], [0.2, '#16100a'], [0.34, '#16100a'], [0.34, color], [0.52, color], [0.52, '#16100a'], [0.66, '#16100a'], [0.66, color], [0.84, color], [0.84, '#16100a'], [1, '#16100a']] as const;
  const gr = g.createLinearGradient(0, 0, 0, 256); stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const GLOW_TEX = () => radialTexture('rgba(255,255,255,1)');

export class Hive {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  bees = new Map<string, Bee>();
  deptCenters = new Map<string, THREE.Vector3>();
  zones = new Map<string, Zone>();
  flights: Flight[] = [];
  clock = new THREE.Clock();
  labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2(-9, -9);
  hovered: Bee | null = null;
  camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  intro = { t: 0, dur: 4.6, on: true, started: false };
  lastInteract = 0;
  uniforms = { uTime: { value: 0 }, uGlow: { value: new THREE.Color(0xffb224) }, uWave: { value: 0 } };
  theme: 'dark' | 'light' = 'dark';
  onBeeClick: (id: string) => void = () => {};
  onBeeHover: (id: string | null, x: number, y: number) => void = () => {};
  onDeptClick: (id: string) => void = () => {};
  onReady: () => void = () => {};
  private floor!: THREE.InstancedMesh;
  private pop: THREE.Object3D[] = [];
  private popLabels: HTMLElement[] = [];
  private hemi!: THREE.HemisphereLight;
  private core = new THREE.Group();
  private gem!: THREE.Mesh;
  private shards!: THREE.InstancedMesh;
  private dust!: THREE.Points;
  private glowTex = GLOW_TEX();
  private frames = 0;
  private lastT: number | undefined;

  constructor(private host: HTMLElement, private overlay: HTMLElement, depts: Dept[], workers: Worker[], noteCount: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    (this.scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);
    this.camera.position.set(-38, 46, 52);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.43; this.controls.minDistance = 5; this.controls.maxDistance = 55;
    this.controls.enabled = false; this.controls.autoRotateSpeed = 0.18;
    this.controls.addEventListener('start', () => { this.camGoal = null; this.lastInteract = performance.now(); this.controls.autoRotate = false; });

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.8, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildLights();
    this.buildFloor();
    this.buildCore(noteCount);
    this.buildDepts(depts, workers);
    this.buildDust();
    this.applyTheme('dark');

    addEventListener('resize', () => this.resize());
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    el.addEventListener('pointerleave', () => this.pointer.set(-9, -9));
    let down = 0;
    el.addEventListener('pointerdown', () => (down = performance.now()));
    el.addEventListener('pointerup', () => { if (performance.now() - down < 250 && this.hovered) this.onBeeClick(this.hovered.w.id); });
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- build ----------
  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x07090d, 0.35);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-14, 24, 12); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd8ff, 0.55); rim.position.set(16, 10, -18); this.scene.add(rim);
    const core = new THREE.PointLight(0xffa21a, 16, 13, 1.9); core.position.set(0, 3.4, 0); core.castShadow = false; this.scene.add(core);
  }

  private buildFloor() {
    const geo = new THREE.CylinderGeometry(HEX * 0.965, HEX * 0.965, 1, 6, 1);
    geo.rotateY(Math.PI / 6);
    const cells: { p: THREE.Vector3; h: number }[] = [];
    const N = 13;
    for (let q = -N; q <= N; q++) for (let r = -N; r <= N; r++) {
      const p = axial(q, r); const d = p.length();
      if (d > 19) continue;
      const h = 0.3 + (d > 13 ? Math.pow(d - 13, 1.6) * 0.16 : 0) + Math.random() * 0.05;
      cells.push({ p, h });
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 0.55, metalness: 0.2 });
    const u = this.uniforms;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vCenter;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position; vCenter = (instanceMatrix * vec4(0.,0.,0.,1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uGlow; uniform float uWave; varying vec3 vLocal; varying vec3 vCenter;\nfloat hexd(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float top = step(0.49, vLocal.y);
          float e = hexd(vLocal.xz) / 0.965 * 1.1547;
          float edge = smoothstep(0.8, 0.97, e) * top;
          float side = (1.0 - top) * smoothstep(0.0, 0.5, vLocal.y + 0.5) * 0.08;
          float dist = length(vCenter.xz);
          float wave = pow(0.5 + 0.5 * sin(dist * 0.55 - uTime * 1.6), 6.0);
          float ring = exp(-pow((dist - uWave) * 0.9, 2.0)) * step(0.01, uWave);
          float fade = smoothstep(19.0, 6.0, dist);
          totalEmissiveRadiance += uGlow * (edge * (0.07 + wave * 0.45 + ring * 2.2) * fade + side * wave * fade * 0.6);`);
    };
    this.floor = new THREE.InstancedMesh(geo, mat, cells.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    cells.forEach(({ p, h }, i) => {
      m.compose(new THREE.Vector3(p.x, h / 2 - 0.35, p.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      this.floor.setMatrixAt(i, m);
      this.floor.setColorAt(i, c.setScalar(0.85 + Math.random() * 0.3));
    });
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  private buildCore(noteCount: number) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.35, metalness: 0.8 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 0.7, 6), metal);
    ped.rotation.y = Math.PI / 6; ped.position.y = 0.2; ped.castShadow = ped.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.035, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffb224 }));
    lip.rotation.x = Math.PI / 2; lip.rotation.z = Math.PI / 6; lip.position.y = 0.56;
    this.gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), new THREE.MeshPhysicalMaterial({
      color: 0xffc24a, emissive: 0xff9a00, emissiveIntensity: 0.75, roughness: 0.18, metalness: 0.1, clearcoat: 1, flatShading: true,
    }));
    this.gem.position.y = 2.7; this.gem.castShadow = true;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffa21a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32 }));
    halo.scale.setScalar(4.6); halo.position.y = 2.7; halo.name = 'halo';
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, emissive: 0xffb224, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.3 });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.04, 6, 6), ringMat); r1.name = 'r1';
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.025, 6, 6), ringMat); r2.name = 'r2';
    r1.position.y = r2.position.y = 2.7;
    // soft light column
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.uniforms.uTime, uColor: { value: new THREE.Color(0xffa21a) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform float uTime; uniform vec3 uColor; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.6) * (0.16 + 0.05 * sin(uTime * 2.0 + vUv.y * 12.0)); float s = sin(vUv.x * 3.14159 * 6.0 + uTime) * 0.08 + 0.92; gl_FragColor = vec4(uColor * a * s, a * s); }',
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 9, 6, 1, true), beamMat);
    beam.position.y = 5; beam.rotation.y = Math.PI / 6;
    const n = Math.max(12, Math.min(90, noteCount * 3));
    this.shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.075), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), n);
    this.core.add(ped, lip, this.gem, halo, r1, r2, beam, this.shards);
    this.scene.add(this.core);
    this.addLabel('<b>KNOWLEDGE VAULT</b>', new THREE.Vector3(0, 4.6, 0), 'lbl core');
  }

  private buildDepts(depts: Dept[], workers: Worker[]) {
    const dist = 9.2;
    depts.forEach((dept, i) => {
      const a = (i / depts.length) * Math.PI * 2 - Math.PI / 2;
      const center = new THREE.Vector3(Math.cos(a) * dist, 0, Math.sin(a) * dist);
      this.deptCenters.set(dept.id, center);
      const color = new THREE.Color(dept.color);
      const team = workers.filter(w => w.dept === dept.id).sort((x, y) => Number(!!y.lead) - Number(!!x.lead));
      const spots: [number, number][] = [[0, 0], ...(RING as [number, number][]), ...RING.map(([q, r]) => [q * 2, r * 2] as [number, number])];
      team.slice(0, spots.length).forEach((w, k) => this.addBee(w, center.clone().add(axial(spots[k][0], spots[k][1]).multiplyScalar(team.length > 7 ? 0.92 : 1.1)), color, dept.color, !!w.lead));

      // zone: a soft tinted floor plate with a glowing hex rim that brightens with workload
      const plateMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: color.clone() }, uLoad: { value: 0 }, uTime: this.uniforms.uTime },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: `uniform vec3 uColor; uniform float uLoad; uniform float uTime; varying vec2 vP;
          float hexd(vec2 p){ p = abs(p); return max(dot(p, vec2(0.8660254, 0.5)), p.y); }
          void main(){ float d = hexd(vP) / 3.15; float body = smoothstep(1.0, 0.2, d) * (0.05 + uLoad * 0.12);
            float scan = smoothstep(0.03, 0.0, abs(d - fract(uTime * 0.18 + uLoad * 0.0))) * smoothstep(1.0, 0.6, d) * (0.06 + uLoad * 0.18);
            float a = body + scan; gl_FragColor = vec4(uColor * a, a); }`,
      });
      const plate = new THREE.Mesh(new THREE.CircleGeometry(3.3, 6), plateMat);
      plate.rotation.x = -Math.PI / 2; plate.position.copy(center).setY(0.4);
      const rim = new THREE.Mesh(new THREE.RingGeometry(3.12, 3.22, 6, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      rim.rotation.x = -Math.PI / 2; rim.position.copy(center).setY(0.41);
      // mast + floating banner
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      const banner = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bannerTexture(dept), transparent: true, depthWrite: false }));
      banner.center.set(0.5, 0); banner.scale.set(4.2, 1.05, 1); banner.renderOrder = 5;
      banner.position.copy(center).setY(3.9);
      mast.position.copy(banner.position).setY(2.3 + (3.9 - 2.3) / 2); mast.scale.y = 3.9 - 2.3;
      this.own(plate); this.own(rim); this.own(mast); this.own(banner);
      // live status chip under the banner
      const chip = this.addLabel(`<i></i><b data-zone-text>idle · ${team.length}</b>`, banner.position.clone().setY(3.55), 'lbl dept', true);
      chip.style.setProperty('--c', dept.color);
      chip.title = `${dept.name} · ${dept.tr}`;
      chip.addEventListener('click', () => this.onDeptClick(dept.id));
      this.zones.set(dept.id, { dept, center, banner, plate, rim, mast, chip, load: 0, target: 0, seed: Math.random() * 10 });
      // light bridge to the core
      const len = dist - 4.4 - 3.1;
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, len), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      bridge.position.copy(center.clone().normalize().multiplyScalar(4.3 + len / 2)).setY(0.0);
      bridge.lookAt(center.x, 0.0, center.z);
      this.own(bridge);
    });
    // fonts may still be loading on first paint: redraw the banners once they are in
    document.fonts?.ready.then(() => { for (const z of this.zones.values()) { const m = z.banner.material as THREE.SpriteMaterial; m.map?.dispose(); m.map = this.bannerTexture(z.dept); m.needsUpdate = true; } });
  }

  /** A glassy department sign: icon tile, name, Turkish name and code. */
  private bannerTexture(d: Dept) {
    const W = 840, H = 210, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const rr = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.font = '600 64px "Space Grotesk", Inter, sans-serif';
    const nameW = g.measureText(d.name).width;
    g.font = '500 30px Inter, sans-serif';
    const subW = g.measureText(d.tr).width + 30 + 80;
    const w = Math.min(W - 8, Math.max(nameW, subW) + 200), x = (W - w) / 2, y = 14, h = 150;
    // panel
    const bg = g.createLinearGradient(0, y, 0, y + h); bg.addColorStop(0, 'rgba(34,26,18,0.92)'); bg.addColorStop(1, 'rgba(16,12,8,0.92)');
    rr(x, y, w, h, 34); g.fillStyle = bg; g.fill();
    g.lineWidth = 3; g.strokeStyle = d.color + '99'; g.stroke();
    // top sheen
    rr(x + 3, y + 3, w - 6, h / 2, 31); const sh = g.createLinearGradient(0, y, 0, y + h / 2); sh.addColorStop(0, 'rgba(255,255,255,0.08)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fill();
    // icon tile
    rr(x + 26, y + 27, 96, 96, 24); g.fillStyle = d.color + '26'; g.fill(); g.strokeStyle = d.color + 'aa'; g.lineWidth = 2.5; g.stroke();
    // pointer notch
    g.beginPath(); g.moveTo(W / 2 - 16, y + h - 1); g.lineTo(W / 2, y + h + 22); g.lineTo(W / 2 + 16, y + h - 1); g.closePath(); g.fillStyle = 'rgba(16,12,8,0.92)'; g.fill();
    g.beginPath(); g.moveTo(W / 2 - 16, y + h + 0.5); g.lineTo(W / 2, y + h + 22); g.lineTo(W / 2 + 16, y + h + 0.5); g.strokeStyle = d.color + '99'; g.lineWidth = 3; g.stroke();
    // text
    g.textBaseline = 'alphabetic'; g.fillStyle = '#f6ecdc'; g.font = '600 64px "Space Grotesk", Inter, sans-serif';
    g.fillText(d.name, x + 146, y + 82);
    g.font = '500 24px "JetBrains Mono", monospace'; g.fillStyle = d.color;
    g.fillText(d.code, x + 146, y + 124);
    g.font = '500 30px Inter, sans-serif'; g.fillStyle = 'rgba(246,236,220,0.6)';
    g.fillText(d.tr, x + 146 + 80, y + 124);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    // the icon arrives asynchronously as an SVG image
    const img = new Image();
    img.onload = () => { g.drawImage(img, x + 46, y + 47, 56, 56); tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(icon(d.icon || 'Hexagon', 56, 1.9).replace(/currentColor/g, d.color));
    return tex;
  }

  private beeParts?: { abdomen: THREE.BufferGeometry; wing: THREE.BufferGeometry; antenna: THREE.BufferGeometry };
  private parts() {
    if (this.beeParts) return this.beeParts;
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.24 * (1 - t * 0.25) + 0.001, t * 0.62)); }
    const abdomen = new THREE.LatheGeometry(prof, 24);
    abdomen.rotateX(-Math.PI / 2); // along -z (backwards)
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(0.12, 0.06, 0.5, 0.1, 0.56, -0.02); s.bezierCurveTo(0.58, -0.12, 0.2, -0.14, 0, 0);
    const wing = new THREE.ShapeGeometry(s, 12);
    wing.rotateX(-Math.PI / 2);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.12, 0.06), new THREE.Vector3(0.08, 0.2, 0.16)]);
    const antenna = new THREE.TubeGeometry(curve, 8, 0.01, 5, false);
    return (this.beeParts = { abdomen, wing, antenna });
  }

  private addBee(w: Worker, home: THREE.Vector3, color: THREE.Color, hex: string, lead: boolean) {
    const P = this.parts();
    // cell
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(HEX * 0.98, HEX * 1.0, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5, metalness: 0.35, emissive: color, emissiveIntensity: 0.04 }));
    cell.rotation.y = Math.PI / 6; cell.position.copy(home).setY(0.1); cell.receiveShadow = cell.castShadow = true; cell.name = 'cell';
    this.own(cell);
    const cellRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.95, 6, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    cellRing.rotation.x = -Math.PI / 2; cellRing.rotation.z = Math.PI / 6; cellRing.position.copy(home).setY(0.36);
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.66, 48, 1, 0, Math.PI * 0.6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    arc.rotation.x = -Math.PI / 2; arc.position.copy(home).setY(0.37);
    const alert = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.06, 6, 1), new THREE.MeshBasicMaterial({ color: 0x3ee6c8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    alert.rotation.x = -Math.PI / 2; alert.rotation.z = Math.PI / 6; alert.position.copy(home).setY(0.38);
    this.own(cellRing); this.own(arc); this.own(alert);
    if (lead) { // the department head stands on a gilded cell
      const gild = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 6, 1), new THREE.MeshBasicMaterial({ color: 0xffc85a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      gild.rotation.x = -Math.PI / 2; gild.rotation.z = Math.PI / 6; gild.position.copy(home).setY(0.37); this.own(gild);
    }

    // bee
    const rig = new THREE.Group(); const body = new THREE.Group(); rig.add(body);
    const furry = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.15), roughness: 0.85 });
    const shell = new THREE.MeshPhysicalMaterial({ map: stripeTexture(hex), roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x0d0907, roughness: 0.25, clearcoat: 1, metalness: 0.2 });
    const abdomen = new THREE.Mesh(P.abdomen, shell); abdomen.position.z = -0.12; abdomen.castShadow = true;
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), furry); thorax.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 16), black); head.position.set(0, 0.03, 0.2); head.castShadow = true;
    const eyeG = new THREE.SphereGeometry(0.075, 16, 12);
    for (const sgn of [1, -1]) {
      const eye = new THREE.Mesh(eyeG, black); eye.position.set(0.085 * sgn, 0.06, 0.25); eye.scale.set(0.8, 1.1, 0.9); body.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); glint.position.set(0.1 * sgn, 0.1, 0.31); body.add(glint);
      const ant = new THREE.Mesh(P.antenna, black); ant.position.set(0.045 * sgn, 0.13, 0.25); ant.scale.x = sgn; body.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2) }));
      tip.position.set(0.045 * sgn + 0.08 * sgn, 0.33, 0.41); body.add(tip);
    }
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 8), black); sting.rotation.x = -Math.PI / 2; sting.position.z = -0.78;
    body.add(abdomen, thorax, head, sting);
    const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.3, roughness: 0.1, iridescence: 1, iridescenceIOR: 1.4, side: THREE.DoubleSide, depthWrite: false });
    const wings: THREE.Object3D[] = [];
    for (const sgn of [1, -1]) for (const [scale, z] of [[1, 0.02], [0.68, -0.08]] as const) {
      const hinge = new THREE.Group(); hinge.position.set(0.08 * sgn, 0.14, z);
      const m = new THREE.Mesh(P.wing, wingMat); m.scale.set(sgn * scale, 1, scale); m.rotation.y = sgn * -0.35;
      hinge.add(m); body.add(hinge); wings.push(hinge);
    }
    if (lead) {
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
      crown.rotation.x = Math.PI / 2; crown.position.set(0, 0.42, 0.18); crown.name = 'crown'; body.add(crown);
      rig.scale.setScalar(1.18);
    }
    body.scale.setScalar(1.3);
    rig.position.copy(home).setY(0.9);
    rig.rotation.y = Math.atan2(-home.x, -home.z);
    rig.traverse(o => (o.userData.bee = w.id));
    this.own(rig);
    this.bees.set(w.id, { w, rig, body, wings, cellRing, arc, alert, home, state: 'idle', phase: Math.random() * 10, flash: 0, hoverK: 0, lift: 0.9 });
  }

  private buildDust() {
    const n = 420, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * 17, a = Math.random() * Math.PI * 2;
      pos.set([Math.cos(a) * r, Math.random() * 9, Math.sin(a) * r], i * 3); seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uniforms.uTime, uColor: { value: new THREE.Color(0xffc56a) }, uPx: { value: this.renderer.getPixelRatio() } },
      vertexShader: `uniform float uTime; uniform float uPx; attribute float aSeed; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.15 + aSeed * 0.25), 9.0); p.x += sin(uTime * 0.4 + aSeed * 20.0) * 0.4; p.z += cos(uTime * 0.3 + aSeed * 13.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (2.0 + aSeed * 3.0) * uPx * (14.0 / -mv.z);
          vA = smoothstep(0.0, 1.5, p.y) * smoothstep(9.0, 6.0, p.y) * (0.25 + aSeed * 0.5); }`,
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor * a, a); }',
    });
    this.dust = new THREE.Points(g, mat);
    this.scene.add(this.dust);
  }

  private own(obj: THREE.Object3D) { this.pop.push(obj); this.scene.add(obj); return obj; }
  /** Drop department zones and bees so the live hive can change shape. The floor and core stay. */
  syncPopulation(depts: Dept[], workers: Worker[]) {
    for (const obj of this.pop) {
      this.scene.remove(obj);
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mats = !mat ? [] : Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const map = (m as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    }
    this.pop = [];
    for (const el of this.popLabels) el.remove();
    this.labels = this.labels.filter(l => !this.popLabels.includes(l.el));
    this.popLabels = [];
    this.bees.clear(); this.zones.clear(); this.deptCenters.clear(); this.hovered = null;
    this.buildDepts(depts, workers);
  }
  setCoreLabel(text: string) {
    const el = this.overlay.querySelector('.lbl.core b');
    if (el) el.textContent = text;
  }
  private addLabel(html: string, pos: THREE.Vector3, cls: string, owned = false) {
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html;
    this.overlay.appendChild(el);
    this.labels.push({ el, pos });
    if (owned) this.popLabels.push(el);
    return el;
  }

  // ---------- public API ----------
  applyTheme(t: 'dark' | 'light') {
    this.theme = t;
    const P = PALETTES[t];
    this.scene.background = new THREE.Color(P.bg);
    this.scene.fog = new THREE.FogExp2(P.fog, P.fogD);
    (this.floor.material as THREE.MeshStandardMaterial).color.set(P.floor);
    this.hemi.color.set(P.hemiSky); this.hemi.groundColor.set(P.hemiGround); this.hemi.intensity = P.hemi;
    this.uniforms.uGlow.value.set(P.glow);
    this.renderer.toneMappingExposure = P.exposure; this.bloom.strength = P.bloom;
    this.scene.traverse(o => { if (o.name === 'cell') ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(P.cell); });
  }
  setDim(on: boolean) { this.renderer.toneMappingExposure = on ? 0.6 : PALETTES[this.theme].exposure; this.bloom.strength = on ? 1.3 : PALETTES[this.theme].bloom; }
  setStates(states: Record<string, WState>) {
    for (const [id, b] of this.bees) {
      b.state = states[id] || 'idle';
      (b.alert.material as THREE.MeshBasicMaterial).color.set(b.state === 'stuck' ? 0xff6b6b : 0x3ee6c8);
    }
  }
  /** Send a radial shock-wave across the floor (e.g. when a task lands). */
  ripple() { this.uniforms.uWave.value = 0.01; }

  pulse(p: Pulse) {
    const corePos = new THREE.Vector3(0, 2.7, 0);
    const beePos = (id?: string) => { const b = id ? this.bees.get(id) : undefined; return b ? b.rig.position.clone().add(new THREE.Vector3(0, 0.15, 0)) : null; };
    let a: THREE.Vector3 | null = null, b: THREE.Vector3 | null = null, color = 0x3ee6c8;
    if (p.type === 'read') { a = corePos; b = beePos(p.worker); color = 0x5ff0d6; }
    else if (p.type === 'write') { a = beePos(p.worker); b = corePos; color = 0xffb224; const bee = p.worker && this.bees.get(p.worker); if (bee) bee.flash = 1; }
    else if (p.type === 'handoff') { a = beePos(p.from); b = beePos(p.to); color = 0xff7ab8; }
    else if (p.worker) { const bee = this.bees.get(p.worker); if (bee) bee.flash = 1; return; }
    if (!a || !b) return;
    const mid = a.clone().lerp(b, 0.5); mid.y += 2.2 + a.distanceTo(b) * 0.18;
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    head.scale.setScalar(0.42);
    const N = 28, pos = new Float32Array(N * 3), alpha = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos.set([a.x, a.y, a.z], i * 3); alpha[i] = 1 - i / N; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(alpha, 1));
    const trail = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.6) }, uPx: { value: this.renderer.getPixelRatio() } },
      vertexShader: 'uniform float uPx; attribute float aA; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = (3.0 + 9.0 * aA) * uPx * (12.0 / -mv.z); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * vA; gl_FragColor = vec4(uColor * a, a); }',
    }));
    trail.frustumCulled = false;
    this.scene.add(head, trail);
    this.flights.push({ head, trail, hist: Array.from({ length: N }, () => a!.clone()), a, b, c: mid, t: 0, dur: 1.15 + Math.random() * 0.35 });
  }

  focusedDept: string | null = null;
  focusDept(id: string | null) {
    this.intro.on = false; this.controls.enabled = true; this.lastInteract = performance.now(); this.controls.autoRotate = false;
    this.focusedDept = id;
    if (!id) { this.camGoal = { pos: HOME_CAM.clone().add(HOME_TARGET), target: HOME_TARGET.clone() }; return; }
    const c = this.deptCenters.get(id); if (!c) return;
    const dir = c.clone().normalize();
    // stand on the core side, a little off-axis, looking out over the department and its sign
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.4);
    this.camGoal = { pos: c.clone().sub(dir.clone().multiplyScalar(7.6)).add(side).setY(8.6), target: c.clone().add(dir.multiplyScalar(0.4)).setY(2.0) };
  }
  /** Live workload per department: drives the zone glow and the status chip. */
  setDeptLoad(id: string, info: { working: number; queued: number; approval: number; size: number; stuck?: number }) {
    const z = this.zones.get(id); if (!z) return;
    const stuck = info.stuck || 0;
    z.target = Math.min(1, (info.working + info.approval * 0.5 + stuck * 0.4) / Math.max(1, info.size) * 1.4 + Math.min(info.queued, 3) * 0.05);
    const txt = info.working || info.queued || info.approval || stuck
      ? [info.working ? `${info.working} working` : '', stuck ? `${stuck} stuck` : '', info.queued ? `${info.queued} queued` : '', info.approval ? `${info.approval} needs you` : ''].filter(Boolean).join(' · ')
      : `idle · ${info.size}`;
    const b = z.chip.querySelector('[data-zone-text]')!; if (b.textContent !== txt) b.textContent = txt;
    z.chip.classList.toggle('busy', info.working > 0); z.chip.classList.toggle('waiting', info.approval > 0);
  }
  focusBee(id: string) {
    const b = this.bees.get(id); if (!b) return;
    this.focusedDept = null;
    this.intro.on = false; this.controls.enabled = true; this.lastInteract = performance.now(); this.controls.autoRotate = false;
    const dir = b.home.clone().normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.2);
    this.camGoal = { pos: b.home.clone().sub(dir.multiplyScalar(4.2)).add(side).setY(3.6), target: b.home.clone().setY(1.0) };
  }
  skipIntro() { this.intro.started = true; this.intro.t = this.intro.dur; }
  startIntro() { this.intro.started = true; }

  // ---------- loop ----------
  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / Math.max(1, h);
    const shift = w > 980 ? Math.min(170, w * 0.11) : 0;
    this.camera.setViewOffset(w, h, -shift, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.lastT = this.lastT ?? t;
    this.uniforms.uTime.value = t;
    if (this.uniforms.uWave.value > 0) { this.uniforms.uWave.value += dt * 14; if (this.uniforms.uWave.value > 26) this.uniforms.uWave.value = 0; }

    // camera: intro fly-in → free orbit → slow cinematic drift when idle
    if (this.intro.on) {
      if (this.intro.started) this.intro.t += Math.min(0.25, this.clock.elapsedTime - (this.lastT ?? this.clock.elapsedTime));
      const k = ease(Math.min(1, this.intro.t / this.intro.dur));
      const az = THREE.MathUtils.lerp(-1.25, 0, k), rad = THREE.MathUtils.lerp(78, HOME_CAM.length(), k);
      const pol = THREE.MathUtils.lerp(0.62, Math.acos(HOME_CAM.y / HOME_CAM.length()), k);
      this.camera.position.set(Math.sin(az) * Math.sin(pol) * rad, Math.cos(pol) * rad, Math.cos(az) * Math.sin(pol) * rad).addScaledVector(HOME_TARGET, k);
      this.controls.target.set(0, THREE.MathUtils.lerp(2, 0, k), 0).addScaledVector(HOME_TARGET, k);
      this.camera.lookAt(this.controls.target);
      if (k >= 1) { this.intro.on = false; this.controls.enabled = true; this.lastInteract = performance.now(); this.ripple(); }
    } else {
      if (this.camGoal) {
        const f = 1 - Math.pow(0.015, Math.min(0.25, t - (this.lastT ?? t)) || dt); // real time, so slow machines still arrive
        this.camera.position.lerp(this.camGoal.pos, f); this.controls.target.lerp(this.camGoal.target, f);
        if (this.camera.position.distanceTo(this.camGoal.pos) < 0.03) this.camGoal = null;
      }
      if (!this.camGoal && performance.now() - this.lastInteract > 18000) this.controls.autoRotate = true;
      this.controls.update();
    }

    // core
    this.gem.rotation.y += dt * 0.45; this.gem.rotation.x = Math.sin(t * 0.5) * 0.2; this.gem.position.y = 2.7 + Math.sin(t * 1.3) * 0.12;
    (this.gem.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.72 + Math.sin(t * 2.1) * 0.14;
    const r1 = this.core.getObjectByName('r1')!, r2 = this.core.getObjectByName('r2')!;
    r1.rotation.set(Math.PI / 2 + Math.sin(t * 0.6) * 0.35, t * 0.4, 0); r2.rotation.set(Math.PI / 2 + Math.cos(t * 0.45) * 0.3, -t * 0.25, Math.sin(t * 0.3) * 0.2);
    r1.position.y = r2.position.y = this.gem.position.y;
    const halo = this.core.getObjectByName('halo')!; halo.scale.setScalar(4.4 + Math.sin(t * 2.1) * 0.3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.shards.count; i++) {
      const ring = i % 3, k = i / this.shards.count;
      const ang = k * Math.PI * 2 * 3 + t * (0.22 + ring * 0.1) * (ring === 1 ? -1 : 1);
      const rad = 2.5 + ring * 0.55;
      q.setFromEuler(new THREE.Euler(t + i, t * 0.7 + i, 0));
      m.compose(new THREE.Vector3(Math.cos(ang) * rad, 2.7 + Math.sin(ang * 2 + ring) * 0.4 + (ring - 1) * 0.35, Math.sin(ang) * rad), q, s);
      this.shards.setMatrixAt(i, m);
    }
    this.shards.instanceMatrix.needsUpdate = true;

    // bees
    for (const b of this.bees.values()) {
      const working = b.state === 'working', waiting = b.state === 'approval', stuck = b.state === 'stuck';
      b.hoverK += ((this.hovered === b ? 1 : 0) - b.hoverK) * Math.min(1, dt * 10);
      b.flash = Math.max(0, b.flash - dt * 1.2);
      const targetLift = waiting ? 1.75 : stuck ? 0.7 : working ? 1.25 : 0.95;
      b.lift += (targetLift - b.lift) * Math.min(1, dt * 3);
      let x = b.home.x, z = b.home.z, y = b.lift + Math.sin(t * 2.2 + b.phase) * 0.06;
      let yaw = Math.atan2(-b.home.x, -b.home.z), pitch = 0, roll = 0;
      if (working) {
        const ang = t * 2.2 + b.phase, r = 0.38;
        x += Math.cos(ang) * r; z += Math.sin(ang) * r; y += Math.sin(t * 5 + b.phase) * 0.05;
        yaw = -ang; roll = -0.35; pitch = 0.1;
      } else if (waiting) {
        y += Math.abs(Math.sin(t * 3.2 + b.phase)) * 0.18; pitch = -0.25;
        yaw += Math.sin(t * 2 + b.phase) * 0.35;
      } else if (stuck) {
        pitch = 0.35; roll = Math.sin(t * 1.4 + b.phase) * 0.2;
      } else {
        x += Math.sin(t * 0.7 + b.phase) * 0.06; z += Math.cos(t * 0.6 + b.phase) * 0.06;
        yaw += Math.sin(t * 0.5 + b.phase) * 0.25;
      }
      b.rig.position.set(x, y, z);
      // smooth yaw (shortest arc)
      let dy = yaw - b.rig.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.rig.rotation.y += dy * Math.min(1, dt * (working ? 12 : 4));
      b.body.rotation.x += (pitch - b.body.rotation.x) * Math.min(1, dt * 5);
      b.body.rotation.z += (roll - b.body.rotation.z) * Math.min(1, dt * 5);
      b.rig.scale.setScalar((b.w.lead ? 1.18 : 1) * (1 + b.hoverK * 0.15 + b.flash * 0.12));
      const freq = working || waiting ? 52 : 34;
      const flap = 0.15 + Math.abs(Math.sin(t * freq + b.phase)) * (working ? 0.95 : 0.7);
      b.wings.forEach((wg, i) => { const sgn = i < 2 ? 1 : -1; wg.rotation.z = sgn * flap; wg.rotation.x = Math.sin(t * freq + b.phase) * 0.15; });
      const crown = b.body.getObjectByName('crown'); if (crown) crown.rotation.z = t;
      // cell glows
      const ringMat = b.cellRing.material as THREE.MeshBasicMaterial;
      ringMat.opacity += ((working ? 0.95 : waiting ? 0.5 : 0.28) + b.hoverK * 0.5 + b.flash - ringMat.opacity) * Math.min(1, dt * 6);
      const arcMat = b.arc.material as THREE.MeshBasicMaterial;
      arcMat.opacity += ((working ? 0.9 : 0) - arcMat.opacity) * Math.min(1, dt * 5);
      b.arc.rotation.z = -t * 3 + b.phase;
      const al = b.alert.material as THREE.MeshBasicMaterial;
      al.opacity = waiting ? 0.35 + Math.sin(t * 5) * 0.35 : stuck ? 0.3 + Math.sin(t * 3) * 0.25 : 0;
      b.alert.scale.setScalar(waiting || stuck ? 1 + ((t * (waiting ? 0.9 : 0.45)) % 1) * 0.35 : 1);
    }

    // department zones
    for (const z of this.zones.values()) {
      z.load += (z.target - z.load) * Math.min(1, dt * 2.5);
      const focus = this.focusedDept === z.dept.id ? 1 : 0;
      (z.plate.material as THREE.ShaderMaterial).uniforms.uLoad.value = z.load + focus * 0.35;
      (z.rim.material as THREE.MeshBasicMaterial).opacity = 0.22 + z.load * 0.55 + focus * 0.25 + Math.sin(t * 2 + z.seed) * 0.04;
      z.banner.position.y = 3.9 + Math.sin(t * 0.9 + z.seed) * 0.08;
      // keep signs readable: far ones grow a little, near ones shrink (clamped)
      const k = THREE.MathUtils.clamp(this.camera.position.distanceTo(z.banner.position) / 23, 0.5, 1.55);
      z.banner.scale.set(4.2 * k, 1.05 * k, 1);
      (z.mast.material as THREE.MeshBasicMaterial).opacity = 0.25 + z.load * 0.5;
    }

    // flights with glowing trails
    this.flights = this.flights.filter(f => {
      f.t += dt / f.dur;
      const u = ease(Math.min(1, f.t)), v = 1 - u;
      const p = new THREE.Vector3(v * v * f.a.x + 2 * v * u * f.c.x + u * u * f.b.x, v * v * f.a.y + 2 * v * u * f.c.y + u * u * f.b.y, v * v * f.a.z + 2 * v * u * f.c.z + u * u * f.b.z);
      f.head.position.copy(p);
      f.hist.pop(); f.hist.unshift(p);
      const attr = f.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      f.hist.forEach((h, i) => attr.setXYZ(i, h.x, h.y, h.z)); attr.needsUpdate = true;
      if (f.t >= 1.35) { this.scene.remove(f.head, f.trail); f.trail.geometry.dispose(); (f.trail.material as THREE.Material).dispose(); f.head.material.dispose(); return false; }
      if (f.t >= 1) (f.head.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - (f.t - 1) * 3);
      return true;
    });

    // hover picking (every other frame is plenty)
    if (++this.frames % 2 === 0 && !this.intro.on) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects([...this.bees.values()].map(b => b.rig), true)[0];
      const hb = hit ? this.bees.get(hit.object.userData.bee) || null : null;
      if (hb !== this.hovered) { this.hovered = hb; this.renderer.domElement.style.cursor = hb ? 'pointer' : ''; }
    }
    if (this.hovered) { const sp = this.project(this.hovered.rig.position.clone().setY(this.hovered.rig.position.y + 0.9)); this.onBeeHover(this.hovered.w.id, sp.x, sp.y); } else this.onBeeHover(null, 0, 0);

    for (const l of this.labels) {
      const sp = this.project(l.pos);
      l.el.style.transform = `translate3d(${sp.x}px,${sp.y}px,0) translate(-50%,-50%)`;
      l.el.style.opacity = sp.behind ? '0' : '';
    }
    this.composer.render(dt);
    this.lastT = t;
    if (this.frames === 3) this.onReady();
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight, behind: v.z > 1 };
  }
}
