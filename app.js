(() => {
'use strict';
const $ = id => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
};

if(!window.THREE){
  ['stepStage','playStage'].forEach(id => {
    const d = document.createElement('div'); d.className = 'gl-error';
    d.textContent = 'The 3D library could not load. Check your connection and reload the page.';
    $(id).appendChild(d);
  });
  return;
}
// Colours are authored in sRGB; let three.js convert them so lighting maths happens in linear space.
if(THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

/* ================= Notation ================= */
// Clockwise as seen looking at the face = negative rotation about the outward axis.
const FACES = {
  U:{axis:'y', layer: 1, sign:-1, name:'Up'},
  D:{axis:'y', layer:-1, sign: 1, name:'Down'},
  R:{axis:'x', layer: 1, sign:-1, name:'Right'},
  L:{axis:'x', layer:-1, sign: 1, name:'Left'},
  F:{axis:'z', layer: 1, sign:-1, name:'Front'},
  B:{axis:'z', layer:-1, sign: 1, name:'Back'},
};
// Middle slices follow the face named in their definition: M like L, E like D, S like F.
const SLICES = {
  M:{axis:'x', layer:0, sign: 1, name:'Middle'},
  E:{axis:'y', layer:0, sign: 1, name:'Equator'},
  S:{axis:'z', layer:0, sign:-1, name:'Standing'},
};
const LAYERS = Object.assign({}, FACES, SLICES);

const COLORS = {white:'#F2F3EE', yellow:'#FFC400', red:'#C8102E', orange:'#FF5F00', green:'#009B48', blue:'#0046AD'};
const SCHEMES = {
  yo:{U:'yellow', D:'white', F:'orange', B:'red', R:'blue', L:'green'},
  wg:{U:'white', D:'yellow', F:'green', B:'blue', R:'red', L:'orange'},
};
const isScheme = v => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SCHEMES, v);
let schemeKey = isScheme(store.get('scrambleScheme')) ? store.get('scrambleScheme') : 'yo';
function setFaceColors(){
  Object.keys(FACES).forEach(k => { const c = SCHEMES[schemeKey][k]; FACES[k].cname = c; FACES[k].color = COLORS[c]; });
}
setFaceColors();
const WHERE = {U:'on top', D:'underneath', R:'on the right', L:'on the left', F:'facing you', B:'at the back'};

function moveFrom(key, turns){
  const f = LAYERS[key];
  const t = Math.abs(turns) === 2 ? 2 : turns;
  return {face:key, axis:f.axis, layer:f.layer, turns:t, angle:f.sign * (Math.PI/2) * turns,
          label: key + (t === 2 ? '2' : t === -1 ? "'" : '')};
}
function makeMove(tok, allowSlices){
  const m = (allowSlices ? /^([UDLRFBMES])(2'|'2|2|')?$/ : /^([UDLRFB])(2'|'2|2|')?$/).exec(tok);
  if(!m) return null;
  const mod = m[2] || '';
  const turns = mod === "'" ? -1 : (mod === "2'" || mod === "'2") ? -2 : mod === '2' ? 2 : 1;
  return moveFrom(m[1], turns);
}
// q quarter turns about the +axis direction, for the layer at `layer` -> notation move
function moveFromAxis(axis, layer, q){
  const key = Object.keys(LAYERS).find(k => LAYERS[k].axis === axis && LAYERS[k].layer === layer);
  let t = (((q * LAYERS[key].sign) % 4) + 4) % 4;
  if(t === 0) return null;
  return moveFrom(key, t === 3 ? -1 : t);
}
const inverse = m => moveFrom(m.face, m.turns === 2 ? 2 : -m.turns);

function generate(n){
  const faces = 'UDLRFB', out = [];
  while(out.length < n){
    const f = faces[Math.floor(Math.random()*6)];
    const p = out[out.length-1], pp = out[out.length-2];
    if(p && p.face === f) continue;
    if(p && pp && FACES[p.face].axis === FACES[f].axis && FACES[pp.face].axis === FACES[f].axis) continue;
    out.push(makeMove(f + ['', "'", '2'][Math.floor(Math.random()*3)]));
  }
  return out;
}
const MAX_SCRAMBLE = 60;
// Accepts scrambles copied from most timers and sites: curly quotes, commas, and step numbers like "1." are ignored.
function parseScramble(text){
  const toks = String(text).slice(0, 600).replace(/[’‘`´′]/g, "'").replace(/[,;]+/g, ' ').trim().split(/\s+/)
    .filter(t => t && !/^\(?\d+[.):]?\)?$/.test(t));
  const moves = [], bad = [];
  toks.forEach(t => { const m = makeMove(t, false); m ? moves.push(m) : bad.push(t); });
  return {moves, bad};
}
// Returns an error sentence, or '' when the scramble is usable.
function scrambleProblem({moves, bad}){
  if(bad.length){
    const lower = bad.some(b => /^[udlrfbmesxyz]/.test(b));
    return `Couldn't read ${bad.slice(0, 4).map(b => `"${b.slice(0, 12)}"`).join(', ')}${bad.length > 4 ? ' and more' : ''}. Use face turns U D L R F B, with ' or 2${lower ? '. Wide turns, slices and rotations aren\'t supported in scrambles yet' : ''}.`;
  }
  if(!moves.length) return 'Paste at least one move, like R U\' F2.';
  if(moves.length > MAX_SCRAMBLE) return `That's ${moves.length} moves. The limit is ${MAX_SCRAMBLE}.`;
  return '';
}
const scrambleText = moves => moves.map(m => m.label).join(' ');

/* ================= Renderers ================= */
let renderer, thumbRenderer;
try{
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  thumbRenderer = new THREE.WebGLRenderer({antialias:true, alpha:true, preserveDrawingBuffer:true});
}catch(e){
  ['stepStage','playStage'].forEach(id => {
    const d = document.createElement('div'); d.className = 'gl-error';
    d.textContent = 'This browser could not start 3D graphics (WebGL). Try another browser or turn on hardware acceleration.';
    $(id).appendChild(d);
  });
  return;
}
[renderer, thumbRenderer].forEach(r => {
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const THUMB = 300;
thumbRenderer.setPixelRatio(1);
thumbRenderer.setSize(THUMB, THUMB, false);

/* ---- Studio lighting, generated in code: a dim room with a few bright softboxes.
        The softboxes are what show up as reflections on glossy plastic. ---- */
function makeStudioEnv(r){
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 14), new THREE.MeshBasicMaterial({color:'#3c4047', side:THREE.BackSide}));
  s.add(room);
  const soft = (w, h, power, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    m.material.color.setRGB(power, power, power);
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  soft(7, 4, 3.2,  0.5, 4.4,  0.8);   // overhead
  soft(3, 5, 4.5, -6.9, 1.2,  2.5);   // key, left
  soft(2.2, 6, 5,  6.9, 0.6, -1.5);   // strip, right
  soft(5, 2.4, 1.8, 1, -1.6,  6.9);   // low front fill
  soft(4, 3, 1.2, -2, -3,    -6.9);   // back
  // Strips placed where the default viewpoint sees them mirrored in each visible face,
  // so a glossy finish shows a streak of light sliding across the tiles.
  soft(0.8, 7, 2.4, -3.7, 3.0, -5.6);   // mirrored in the top face
  soft(6, 0.6, 1.8, -3.6, -3.1, 5.6);   // mirrored in the front face
  soft(0.7, 5, 1.6,  4.0, -2.4, -5.6);  // mirrored in the right face
  const pm = new THREE.PMREMGenerator(r);
  const tex = pm.fromScene(s, 0.04).texture;
  pm.dispose();
  s.traverse(o => { if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
  return tex;
}
const envMain = makeStudioEnv(renderer);
const envThumb = makeStudioEnv(thumbRenderer);

/* ---- Procedural surface textures (tileable value noise turned into a normal map) ---- */
function mulberry(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function valueNoise(size, cells, rand){
  const g = []; for(let i=0;i<cells*cells;i++) g.push(rand());
  const at = (x, y) => g[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
  const sm = t => t*t*(3 - 2*t);
  const out = new Float32Array(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const fx = x / size * cells, fy = y / size * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const a = at(ix, iy), b = at(ix+1, iy), c = at(ix, iy+1), d = at(ix+1, iy+1);
    out[y*size + x] = (a + (b - a)*tx) + ((c + (d - c)*tx) - (a + (b - a)*tx)) * ty;
  }
  return out;
}
function makeNormalTexture(size, octaves, strength, seed){
  const rand = mulberry(seed);
  const h = new Float32Array(size*size);
  octaves.forEach(([cells, amp]) => { const n = valueNoise(size, cells, rand); for(let i=0;i<h.length;i++) h[i] += n[i]*amp; });
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const dx = h[y*size + (x+1)%size] - h[y*size + (x-1+size)%size];
    const dy = h[((y+1)%size)*size + x] - h[((y-1+size)%size)*size + x];
    let nx = -dx*strength, ny = -dy*strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx/=l; ny/=l; nz/=l;
    const i = (y*size + x)*4;
    img.data[i] = (nx*0.5+0.5)*255; img.data[i+1] = (ny*0.5+0.5)*255; img.data[i+2] = (nz*0.5+0.5)*255; img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Gentle waviness of a UV lacquer layer ("orange peel"), and fine grain for frosted plastic.
const rippleTex = makeNormalTexture(256, [[5, 1], [13, 0.35]], 2.2, 7);
const grainTex  = makeNormalTexture(256, [[64, 1], [128, 0.5]], 3, 11);

/* ---- Geometry ---- */
function roundedSquareShape(w, r){
  const h = w/2, s = new THREE.Shape();
  s.moveTo(-h+r,-h); s.lineTo(h-r,-h); s.quadraticCurveTo(h,-h,h,-h+r);
  s.lineTo(h,h-r); s.quadraticCurveTo(h,h,h-r,h); s.lineTo(-h+r,h);
  s.quadraticCurveTo(-h,h,-h,h-r); s.lineTo(-h,-h+r); s.quadraticCurveTo(-h,-h,-h+r,-h);
  return s;
}
// Box with rounded edges and corners: extra grid lines are packed into the rounded band,
// then every vertex is pushed onto the rounded surface and given its exact normal.
function roundedBoxGeometry(size, r, k){
  const n = 2*k + 1, h = size/2, a = 1/n;
  const g = new THREE.BoxGeometry(size, size, size, n, n, n);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const map = c => { const t = c / h, at = Math.abs(t); return at <= a + 1e-6 ? (t / a) * (h - r) : Math.sign(t) * ((h - r) + (at - a) / (1 - a) * r); };
  const v = new THREE.Vector3(), inner = new THREE.Vector3(), d = new THREE.Vector3(), lim = h - r;
  for(let i=0;i<pos.count;i++){
    v.set(map(pos.getX(i)), map(pos.getY(i)), map(pos.getZ(i)));
    inner.set(THREE.MathUtils.clamp(v.x,-lim,lim), THREE.MathUtils.clamp(v.y,-lim,lim), THREE.MathUtils.clamp(v.z,-lim,lim));
    d.subVectors(v, inner).normalize();
    v.copy(inner).addScaledVector(d, r);
    pos.setXYZ(i, v.x, v.y, v.z); nor.setXYZ(i, d.x, d.y, d.z);
  }
  pos.needsUpdate = nor.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}
// A tile with soft bevelled edges; its back sits at z = 0.
function tileGeometry(outer, radius, depth, bevel){
  const inner = outer - 2*bevel;
  const g = new THREE.ExtrudeGeometry(roundedSquareShape(inner, Math.max(0.01, radius - bevel)),
    {depth, bevelEnabled:true, bevelThickness:bevel, bevelSize:bevel, bevelSegments:4, curveSegments:8});
  g.translate(0, 0, bevel);
  return g;
}
const HALF = 0.4875;
const GEO = {
  body: roundedBoxGeometry(HALF*2, 0.06, 3),
  tile: {
    stickerless: tileGeometry(0.905, 0.11, 0.010, 0.020),
    stickered:   tileGeometry(0.800, 0.09, 0.002, 0.006),
  },
};

/* ---- Materials ---- */
let look = {
  finish: store.get('cubeFinish') === 'matte' ? 'matte' : 'uv',
  style: store.get('cubeStyle') === 'stickered' ? 'stickered' : 'stickerless',
};
const bodyMat = new THREE.MeshPhysicalMaterial({color:'#121316'});
const allTiles = [];   // {mesh, mat, base, face, n}
function tileParams(finish){
  return finish === 'uv'
    ? {roughness:0.22, metalness:0, clearcoat:0.9, clearcoatRoughness:0.03, clearcoatNormalMap:rippleTex,
       clearcoatNormalScale:new THREE.Vector2(0.1, 0.1), normalMap:null, envMapIntensity:1}
    : {roughness:0.6, metalness:0, clearcoat:0, clearcoatRoughness:0, clearcoatNormalMap:null,
       normalMap:grainTex, normalScale:new THREE.Vector2(0.05, 0.05), envMapIntensity:0.8};
}
function applyLook(){
  const p = tileParams(look.finish);
  allTiles.forEach(t => {
    Object.assign(t.mat, p);
    t.mat.needsUpdate = true;
    t.mesh.geometry = GEO.tile[look.style];
  });
  Object.assign(bodyMat, look.finish === 'uv'
    ? {roughness:0.3, clearcoat:0.6, clearcoatRoughness:0.08}
    : {roughness:0.62, clearcoat:0, clearcoatRoughness:0});
  bodyMat.color.set(look.style === 'stickered' ? '#0d0e10' : '#1d1f23');
  bodyMat.needsUpdate = true;
  document.querySelectorAll('#segFinish button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === look.finish)));
  document.querySelectorAll('#segStyle button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === look.style)));
}

/* ================= Cube model ================= */
const AX = {x:new THREE.Vector3(1,0,0), y:new THREE.Vector3(0,1,0), z:new THREE.Vector3(0,0,1)};
const UV = {x:[AX.y, AX.z], y:[AX.z, AX.x], z:[AX.x, AX.y]}; // (u, v, axis) right-handed
const Z = new THREE.Vector3(0,0,1);
const OUTER = [
  {n:new THREE.Vector3( 1,0,0), f:'R'}, {n:new THREE.Vector3(-1,0,0), f:'L'},
  {n:new THREE.Vector3(0, 1,0), f:'U'}, {n:new THREE.Vector3(0,-1,0), f:'D'},
  {n:new THREE.Vector3(0,0, 1), f:'F'}, {n:new THREE.Vector3(0,0,-1), f:'B'},
];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

class Cube{
  constructor(scene){
    this.root = new THREE.Group(); scene.add(this.root);
    this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.cubies = []; this.tiles = []; this.turning = null;
    for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++){
      if(!x && !y && !z) continue;
      const g = new THREE.Group();
      const body = new THREE.Mesh(GEO.body, bodyMat);
      body.userData.cubie = g;
      g.add(body);
      const home = new THREE.Vector3(x, y, z), tiles = [];
      OUTER.forEach(o => {
        if(home.dot(o.n) !== 1) return;
        const base = new THREE.Color(FACES[o.f].color);
        const mat = new THREE.MeshPhysicalMaterial({color:base.clone()});
        const mesh = new THREE.Mesh(GEO.tile[look.style], mat);
        mesh.quaternion.setFromUnitVectors(Z, o.n);
        mesh.rotateZ(Math.floor(Math.random()*4) * Math.PI/2); // vary the surface texture between tiles
        mesh.position.copy(o.n).multiplyScalar(HALF);
        mesh.userData.cubie = g;
        g.add(mesh);
        const t = {mesh, mat, base, face:o.f, n:o.n.clone()};
        tiles.push(t); this.tiles.push(t); allTiles.push(t);
      });
      g.position.copy(home);
      g.userData = {home, tiles};
      this.root.add(g);
      this.cubies.push(g);
    }
  }
  static snap(c){
    c.position.set(Math.round(c.position.x), Math.round(c.position.y), Math.round(c.position.z));
    _m.makeRotationFromQuaternion(c.quaternion);
    const e = _m.elements;
    [0,1,2,4,5,6,8,9,10].forEach(i => e[i] = Math.round(e[i]));
    c.quaternion.setFromRotationMatrix(_m);
  }
  inLayer(c, axis, layer){ return Math.round(c.position[axis]) === layer; }
  reset(){ this.cancelTurn(); this.cubies.forEach(c => { c.position.copy(c.userData.home); c.quaternion.identity(); }); }
  applyInstant(m){
    _q.setFromAxisAngle(AX[m.axis], m.angle);
    this.cubies.forEach(c => {
      if(!this.inLayer(c, m.axis, m.layer)) return;
      c.position.applyQuaternion(_q);
      c.quaternion.premultiply(_q);
      Cube.snap(c);
    });
  }
  setState(moves, n){ this.reset(); for(let k=0;k<n;k++) this.applyInstant(moves[k]); }
  beginTurn(axis, layer){
    this.pivot.rotation.set(0,0,0); this.pivot.updateMatrixWorld(true);
    this.turning = {axis, layer, cubies:this.cubies.filter(c => this.inLayer(c, axis, layer))};
    this.turning.cubies.forEach(c => this.pivot.attach(c));
  }
  setTurn(angle){ if(this.turning) this.pivot.setRotationFromAxisAngle(AX[this.turning.axis], angle); }
  endTurn(){
    if(!this.turning) return;
    this.pivot.updateMatrixWorld(true);
    this.turning.cubies.forEach(c => { this.root.attach(c); Cube.snap(c); });
    this.pivot.rotation.set(0,0,0);
    this.turning = null;
  }
  cancelTurn(){ if(this.turning){ this.setTurn(0); this.endTurn(); } }
  isSolved(){
    const seen = {};
    for(const c of this.cubies) for(const t of c.userData.tiles){
      _v.copy(t.n).applyQuaternion(c.quaternion);
      const key = `${Math.round(_v.x)},${Math.round(_v.y)},${Math.round(_v.z)}`;
      if(seen[key] && seen[key] !== t.face) return false;
      seen[key] = t.face;
    }
    return true;
  }
  recolor(){ this.tiles.forEach(t => { t.base.set(FACES[t.face].color); t.mat.color.copy(t.base); }); }
}

/* ================= Scenes and views ================= */
function makeScene(){
  const s = new THREE.Scene();
  s.environment = envMain;
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(4, 8, 6); s.add(key);
  return s;
}
const DEFAULT_DIR = new THREE.Vector3(1.05, 0.95, 1.35).normalize();
function dirToOrbit(d){ return {theta:Math.atan2(d.x, d.z), phi:Math.acos(THREE.MathUtils.clamp(d.y / d.length(), -1, 1))}; }
function orbitToDir(o){ return new THREE.Vector3(Math.sin(o.phi)*Math.sin(o.theta), Math.cos(o.phi), Math.sin(o.phi)*Math.cos(o.theta)); }
function fitDist(aspect, radius){
  const v = THREE.MathUtils.degToRad(34) / 2;
  const h = Math.atan(Math.tan(v) * aspect);
  return radius / Math.sin(Math.min(v, h));
}
function makeView(stageId, fitRadius){
  const scene = makeScene();
  return {stage:$(stageId), scene, cube:new Cube(scene), camera:new THREE.PerspectiveCamera(34, 1, 0.1, 100),
          orbit:Object.assign({zoom:1}, dirToOrbit(DEFAULT_DIR)), fitRadius};
}
const V = {step:makeView('stepStage', 2.75), play:makeView('playStage', 2.7)};
const stepCube = V.step.cube, playCube = V.play.cube;
const arrowGroup = new THREE.Group(); V.step.scene.add(arrowGroup);
applyLook();

let mode = 'step';
function placeCamera(view){
  view.camera.position.copy(orbitToDir(view.orbit)).multiplyScalar(fitDist(view.camera.aspect, view.fitRadius) * view.orbit.zoom);
  view.camera.lookAt(0,0,0);
}
function resize(){
  const v = V[mode];
  if(!v) return;
  const w = v.stage.clientWidth, h = v.stage.clientHeight;
  if(!w || !h) return;
  renderer.setSize(w, h, false);
  v.camera.aspect = w / h;
  v.camera.updateProjectionMatrix();
}
const ro = new ResizeObserver(resize);
ro.observe(V.step.stage); ro.observe(V.play.stage);

/* ================= Tweens + render loop ================= */
const tweens = new Set();
const easeInOut = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
function tween(dur, update){
  return new Promise(res => {
    if(dur <= 0){ update(1); res(); return; }
    tweens.add({t0:performance.now(), dur, update, res});
  });
}
async function animateMove(cube, m, dur){
  if(dur <= 0){ cube.applyInstant(m); return; }
  cube.beginTurn(m.axis, m.layer);
  await tween(dur * (m.turns === 2 ? 1.6 : 1), t => cube.setTurn(m.angle * easeInOut(t)));
  cube.endTurn();
}

let camTween = null;
function frame(now){
  requestAnimationFrame(frame);
  for(const tw of [...tweens]){
    const t = Math.min(1, (now - tw.t0) / tw.dur);
    tw.update(t);
    if(t >= 1){ tweens.delete(tw); tw.res(); }
  }
  if(camTween){
    const t = Math.min(1, (now - camTween.t0) / camTween.dur), e = easeOut(t), o = V.step.orbit;
    o.theta = camTween.from.theta + camTween.dTheta * e;
    o.phi = camTween.from.phi + camTween.dPhi * e;
    if(t >= 1) camTween = null;
  }
  if(P.phase === 'solving' || P.phase === 'free') renderTimer(now - P.t0);
  if(T.state === 'running') $('tDisp').textContent = fmtTime(now - T.t0);
  const v = V[mode];
  if(!v) return;               // the Timer tab has no 3D view
  placeCamera(v);
  renderer.render(v.scene, v.camera);
}

/* ================= Pointer input ================= */
const cv = renderer.domElement;
const pts = new Map();
let drag = null, pinch = null, tdrag = null;
const raycaster = new THREE.Raycaster();
const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

function pickPlayCube(e){
  const r = cv.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, V.play.camera);
  const hit = raycaster.intersectObject(playCube.root, true).find(h => h.object.userData.cubie && h.face);
  if(!hit) return null;
  const nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const axis = ['x','y','z'].reduce((a, b) => Math.abs(nw[b]) > Math.abs(nw[a]) ? b : a);
  const n = new THREE.Vector3(); n[axis] = Math.sign(nw[axis]);
  const cubie = hit.object.userData.cubie;
  if(Math.round(cubie.position[axis]) !== n[axis]) return null; // not an outside face
  return {cubie, n, point:hit.point.clone()};
}
function screenVec(p, dir, cam){
  const a = p.clone().project(cam), b = p.clone().addScaledVector(dir, 0.5).project(cam);
  return {x:(b.x - a.x) * cv.clientWidth / 2, y:-(b.y - a.y) * cv.clientHeight / 2};
}

cv.addEventListener('pointerdown', e => {
  pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
  try{ cv.setPointerCapture(e.pointerId); }catch(err){}
  camTween = null;
  if(pts.size === 2){
    if(tdrag) abortTurnDrag();
    pinch = {d:spread(), zoom:V[mode].orbit.zoom}; drag = null;
    return;
  }
  if(pts.size > 2) return;
  if(mode === 'play' && playIdle()){
    const hit = pickPlayCube(e);
    if(hit){ tdrag = {id:e.pointerId, x0:e.clientX, y0:e.clientY, hit, decided:false, angle:0}; return; }
  }
  drag = {x:e.clientX, y:e.clientY};
  cv.classList.add('dragging');
});
cv.addEventListener('pointermove', e => {
  if(!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
  const o = V[mode].orbit;
  if(pinch && pts.size >= 2){ o.zoom = THREE.MathUtils.clamp(pinch.zoom * pinch.d / spread(), 0.6, 1.7); return; }
  if(tdrag && e.pointerId === tdrag.id){ moveTurnDrag(e); return; }
  if(!drag) return;
  o.theta -= (e.clientX - drag.x) * 0.009;
  o.phi = THREE.MathUtils.clamp(o.phi - (e.clientY - drag.y) * 0.009, 0.12, Math.PI - 0.12);
  drag = {x:e.clientX, y:e.clientY};
});
const endPointer = e => {
  pts.delete(e.pointerId);
  if(tdrag && e.pointerId === tdrag.id) finishTurnDrag();
  if(pts.size < 2) pinch = null;
  if(pts.size === 1 && !tdrag){ const p = [...pts.values()][0]; drag = {x:p.x, y:p.y}; }
  else if(pts.size === 0){ drag = null; cv.classList.remove('dragging'); }
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', e => { e.preventDefault(); const o = V[mode].orbit; o.zoom = THREE.MathUtils.clamp(o.zoom * (1 + e.deltaY*0.001), 0.6, 1.7); }, {passive:false});

// Drag-to-turn: pick which way the finger is going across the grabbed face, turn that layer live.
function moveTurnDrag(e){
  const td = tdrag, dx = e.clientX - td.x0, dy = e.clientY - td.y0;
  if(!td.decided){
    const dist = Math.hypot(dx, dy);
    if(dist < 8) return;
    const n = td.hit.n;
    let best = null;
    ['x','y','z'].filter(a => n[a] === 0).forEach(a => {
      const sv = screenVec(td.hit.point, AX[a], V.play.camera), len = Math.hypot(sv.x, sv.y);
      if(len < 1e-3) return;
      const along = (dx*sv.x + dy*sv.y) / len, score = Math.abs(along) / dist;
      if(!best || score > best.score) best = {a, sv, len, along, score};
    });
    if(!best) return;
    const s = Math.sign(best.along) || 1;
    const d = AX[best.a].clone().multiplyScalar(s);           // world direction the surface point moves
    const rot = new THREE.Vector3().crossVectors(n, d);        // rotating +90° about this moves the point along d
    const axis = ['x','y','z'].find(a => rot[a] !== 0);
    const p = td.hit.point, radius = Math.max(1, Math.sqrt(Math.max(0, p.lengthSq() - p[axis]*p[axis])));
    Object.assign(td, {decided:true, axis, asign:Math.sign(rot[axis]), layer:Math.round(td.hit.cubie.position[axis]),
      sdir:{x:best.sv.x / best.len * s, y:best.sv.y / best.len * s}, k:1 / ((best.len / 0.5) * radius)});
    playCube.beginTurn(axis, td.layer);
    hideBanner();
  }
  const along = dx*td.sdir.x + dy*td.sdir.y;
  td.angle = td.asign * along * td.k;
  playCube.setTurn(td.angle);
}
function abortTurnDrag(){
  if(tdrag && tdrag.decided) playCube.cancelTurn();
  tdrag = null;
}
async function finishTurnDrag(){
  const td = tdrag; tdrag = null;
  if(!td || !td.decided) return;
  const q = Math.round(td.angle / (Math.PI/2)), target = q * Math.PI/2, from = td.angle;
  P.snapping = true;
  await tween(reduceMotion ? 0 : 90 + 140 * Math.min(1, Math.abs(target - from)), t => playCube.setTurn(from + (target - from) * easeOut(t)));
  playCube.endTurn();
  P.snapping = false;
  const m = moveFromAxis(td.axis, td.layer, q);
  if(m) afterPlayerMove(m);
}

/* ================= Step-through mode ================= */
let seq = generate(20), idx = 0, busy = false, playing = false, playId = 0;
let speed = reduceMotion ? 0 : 400;
if(reduceMotion) $('speed').value = 0;
// Still layers fade to a near-grey of their own colour (and lose most of their gloss),
// so a dimmed orange can never be mistaken for red, or a dimmed yellow for white.
const _hsl = {};
function highlight(m, allowDim = true){
  const dimOn = allowDim && $('dim').checked, coat = tileParams(look.finish).clearcoat;
  stepCube.cubies.forEach(c => {
    const lit = !m || !dimOn || stepCube.inLayer(c, m.axis, m.layer);
    c.userData.tiles.forEach(t => {
      if(lit){ t.mat.color.copy(t.base); t.mat.clearcoat = coat; return; }
      t.base.getHSL(_hsl);
      t.mat.color.setHSL(_hsl.h, _hsl.s * 0.15, 0.045 + _hsl.l * 0.1);
      t.mat.clearcoat = coat ? 0.25 : 0;
    });
  });
}
function signalColor(){ return getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#A80EBF'; }
const arrowMat = new THREE.MeshBasicMaterial({color:signalColor(), toneMapped:false});
const ringMat = new THREE.MeshBasicMaterial({color:signalColor(), transparent:true, opacity:0.3, depthWrite:false, toneMapped:false});

class Arc extends THREE.Curve{
  constructor(c,u,v,r,a0,a1){ super(); this.c=c; this.u=u; this.v=v; this.r=r; this.a0=a0; this.a1=a1; }
  getPoint(t, target = new THREE.Vector3()){
    const a = this.a0 + (this.a1 - this.a0)*t;
    return target.copy(this.c).addScaledVector(this.u, this.r*Math.cos(a)).addScaledVector(this.v, this.r*Math.sin(a));
  }
}
function clearArrow(){ while(arrowGroup.children.length){ const o = arrowGroup.children.pop(); if(o.geometry) o.geometry.dispose(); } }
function buildArrow(m, viewDir){
  clearArrow();
  if(!m) return;
  const axis = AX[m.axis], [u, v] = UV[m.axis];
  const s = Math.sign(m.angle), half = m.turns === 2, R = 2.3;
  const center = axis.clone().multiplyScalar(m.layer);
  const phi = Math.atan2(viewDir.dot(v), viewDir.dot(u));
  const sweep = THREE.MathUtils.degToRad(half ? 230 : 125);
  const a0 = phi - s*sweep/2, a1 = phi + s*sweep/2, headLen = 0.5, headAng = headLen / R;
  const pointAt = a => center.clone().addScaledVector(u, R*Math.cos(a)).addScaledVector(v, R*Math.sin(a));
  const tangentAt = a => u.clone().multiplyScalar(-Math.sin(a)).addScaledVector(v, Math.cos(a)).multiplyScalar(s).normalize();
  arrowGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new Arc(center,u,v,R,a0,a1 - s*headAng*0.85), 72, 0.07, 12, false), arrowMat));
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), arrowMat);
  tail.position.copy(pointAt(a0)); arrowGroup.add(tail);
  const heads = [a1 - s*headAng];
  if(half) heads.push(phi - s*headAng*0.5);
  heads.forEach(a => {
    const g = new THREE.ConeGeometry(0.2, headLen, 24); g.translate(0, headLen/2, 0);
    const cone = new THREE.Mesh(g, arrowMat);
    cone.position.copy(pointAt(a));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tangentAt(a));
    arrowGroup.add(cone);
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.02, 8, 128), ringMat);
  ring.quaternion.setFromUnitVectors(Z, axis);
  ring.position.copy(center);
  arrowGroup.add(ring);
}
function viewDirFor(m){
  if(!m) return DEFAULT_DIR.clone();
  const d = DEFAULT_DIR.clone();
  if(Math.sign(d[m.axis]) !== m.layer && m.layer !== 0) d[m.axis] *= -1;
  return d;
}
function tweenCameraTo(dir){
  const o = V.step.orbit, target = dirToOrbit(dir);
  const dt = Math.atan2(Math.sin(target.theta - o.theta), Math.cos(target.theta - o.theta));
  if(Math.abs(dt) < 1e-3 && Math.abs(target.phi - o.phi) < 1e-3) return;
  if(reduceMotion){ o.theta += dt; o.phi = target.phi; return; }
  camTween = {t0:performance.now(), dur:520, from:{theta:o.theta, phi:o.phi}, dTheta:dt, dPhi:target.phi - o.phi};
}
function decorate(){
  const m = seq[idx] || null, auto = $('autoCam').checked;
  const target = auto ? viewDirFor(m) : orbitToDir(V.step.orbit);
  buildArrow(m, target);
  highlight(m);
  if(auto) tweenCameraTo(target);
}

let thumbUrls = [];
const thumbCam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
let thumbsStale = false;
function buildThumbs(){
  if(mode !== 'step'){ thumbsStale = true; return; }
  if(stepCube.turning) return;
  thumbsStale = false;
  thumbUrls = [];
  const sc = V.step.scene;
  sc.environment = envThumb;
  thumbCam.position.copy(DEFAULT_DIR).multiplyScalar(fitDist(1, 2.75) * 0.92);
  thumbCam.lookAt(0,0,0);
  for(let i=0;i<=seq.length;i++){
    stepCube.setState(seq, i);
    const m = seq[i] || null;
    buildArrow(m, DEFAULT_DIR);   // one fixed viewpoint for every card
    highlight(m, false);          // cards always show true colours so they can be matched against a real cube
    thumbRenderer.render(sc, thumbCam);
    thumbUrls.push(thumbRenderer.domElement.toDataURL('image/png'));
  }
  sc.environment = envMain;
  stepCube.setState(seq, idx);
  decorate();
  renderFilm();
}

const pad = n => String(n).padStart(2, '0');
function renderSeq(){
  const box = $('seq'); box.innerHTML = '';
  seq.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'tok'; b.textContent = m.label; b.dataset.i = i;
    b.setAttribute('aria-label', `Go to move ${i+1}, ${m.label}`);
    box.appendChild(b);
  });
}
function renderFilm(){
  const film = $('film'); film.innerHTML = '';
  for(let i=0;i<=seq.length;i++){
    const m = seq[i];
    const b = document.createElement('button');
    b.className = 'card'; b.dataset.i = i;
    b.setAttribute('aria-label', m ? `Step ${i+1}: ${m.label}` : 'Final scrambled state');
    const img = document.createElement('img');
    img.alt = ''; img.width = THUMB; img.height = THUMB;
    if(thumbUrls[i]) img.src = thumbUrls[i];
    const meta = document.createElement('div'); meta.className = 'meta';
    const ii = document.createElement('span'); ii.className = 'i'; ii.textContent = m ? pad(i+1) : 'End';
    const mm = document.createElement('span'); mm.className = 'm'; mm.textContent = m ? m.label : '✓';
    meta.append(ii, mm);
    const d = document.createElement('span'); d.className = 'd';
    d.textContent = m ? `${LAYERS[m.face].name}, ${m.turns === 2 ? 'half turn' : m.turns === 1 ? 'clockwise' : 'counter-clockwise'}` : 'Scrambled';
    b.append(img, meta, d);
    film.appendChild(b);
  }
  updateStepUI();
}
function updateStepUI(){
  const N = seq.length, m = seq[idx];
  if(m){
    const f = FACES[m.face];
    $('count').textContent = `Move ${pad(idx+1)} of ${N}`;
    $('nota').textContent = m.label;
    $('swatch').style.background = f.color;
    $('faceName').textContent = `${f.name} face (${f.cname} centre)`;
    $('dir').innerHTML = m.turns === 2 ? '<strong>Half turn</strong>, 180° either way'
      : m.turns === 1 ? '<strong>Clockwise</strong>, quarter turn' : '<strong>Counter-clockwise</strong>, quarter turn';
    $('tip').textContent = m.turns === 2
      ? `Turn the face ${WHERE[m.face]} twice. The arrow's double head marks a half turn.`
      : `Picture looking straight at the ${f.cname} centre ${WHERE[m.face]}, then turn that face ${m.turns === 1 ? 'clockwise' : 'counter-clockwise'} a quarter turn.`;
  }else{
    $('count').textContent = `All ${N} moves done`;
    $('nota').textContent = 'Done';
    $('swatch').style.background = 'transparent';
    $('faceName').textContent = 'Scramble complete';
    $('dir').textContent = 'Your cube should now match this model.';
    $('tip').textContent = 'Drag the model to check every side against your cube.';
  }
  document.querySelectorAll('#seq .tok').forEach((t, i) => { t.classList.toggle('done', i < idx); t.classList.toggle('now', i === idx); });
  const film = $('film'); let active = null;
  film.querySelectorAll('.card').forEach((c, i) => { c.classList.toggle('active', i === idx); if(i === idx) active = c; });
  $('miniCount').textContent = `${pad(Math.min(idx+1, N))} / ${pad(N)}`;
  $('miniNota').textContent = m ? m.label : 'Done';
  if(active && film.scrollWidth > film.clientWidth + 1){
    film.scrollTo({left: active.offsetLeft - film.offsetLeft - (film.clientWidth - active.offsetWidth)/2, behavior: reduceMotion ? 'auto' : 'smooth'});
  }
  $('bStart').disabled = $('bPrev').disabled = idx === 0;
  $('bNext').disabled = $('bEnd').disabled = idx >= N;
  $('playLabel').textContent = playing ? 'Pause' : (idx >= N ? 'Replay' : 'Play');
  $('playIcon').innerHTML = playing
    ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
    : '<path d="M7 4.9v14.2a1 1 0 0 0 1.5.86l11.3-7.1a1 1 0 0 0 0-1.72L8.5 4.04A1 1 0 0 0 7 4.9z"/>';
}
function goTo(i){
  if(busy) return;
  playing = false;
  idx = THREE.MathUtils.clamp(i, 0, seq.length);
  stepCube.setState(seq, idx);
  decorate(); updateStepUI();
}
async function next(){
  if(busy || idx >= seq.length) return;
  busy = true;
  await animateMove(stepCube, seq[idx], speed);
  idx++; busy = false;
  decorate(); updateStepUI();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function play(){
  if(playing){ playing = false; updateStepUI(); return; }
  if(busy) return;
  if(idx >= seq.length) goTo(0);
  const my = ++playId;
  playing = true; updateStepUI();
  await sleep(speed > 0 ? 450 : 600);
  while(playing && my === playId && idx < seq.length){
    await next();
    if(!playing || my !== playId) break;
    await sleep(speed > 0 ? Math.max(350, speed) : 600);
  }
  if(my !== playId) return;
  playing = false; updateStepUI();
}
function loadSequence(moves){
  if(busy) return;
  playing = false; seq = moves; idx = 0;
  renderSeq(); stepCube.setState(seq, 0); buildThumbs();
  rememberScramble(seq);
}

/* ================= Saved in this browser ================= */
function loadList(key){
  try{ const v = JSON.parse(store.get(key) || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; }
}
const RECENT_KEY = 'recentScrambles';
function rememberScramble(moves){
  const text = scrambleText(moves);
  if(!text) return;
  const list = loadList(RECENT_KEY).slice(0, 20).filter(x => typeof x === 'string' && x !== text);
  list.unshift(text);
  store.set(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  renderRecent();
}
function renderRecent(){
  const list = loadList(RECENT_KEY).slice(0, 8).filter(x => typeof x === 'string' && !scrambleProblem(parseScramble(x)));
  const ul = $('recentList'); ul.textContent = '';
  list.forEach(text => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = text; b.dataset.s = text;
    li.append(b); ul.append(li);
  });
  $('recentWrap').hidden = !list.length;
}
function copyText(btn, text, selectEl){
  if(!btn.dataset.label) btn.dataset.label = btn.textContent;
  const label = btn.dataset.label;
  const done = () => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = label, 1400); };
  const fallback = () => {
    if(selectEl){ const r = document.createRange(); r.selectNodeContents(selectEl); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    btn.textContent = 'Selected, press Ctrl+C'; setTimeout(() => btn.textContent = label, 2400);
  };
  try{ navigator.clipboard.writeText(text).then(done, fallback); }catch(e){ fallback(); }
}

/* ================= Play mode ================= */
const P = {phase:'solved', history:[], scramble:[], t0:0, elapsed:0, pending:0, chain:Promise.resolve(), snapping:false, shuffling:false};
const playIdle = () => P.pending === 0 && !P.snapping && !P.shuffling && !playCube.turning;
const STATUS = {solved:['Solved',''], ready:['Scrambled · timer starts on your first turn','go'], solving:['Solving','go'], done:['Solved!','win'], free:['Free play · timing','go']};
const SOLVES_KEY = 'playSolves';

function fmtTime(ms){
  const s = ms / 1000;
  if(s < 60) return s.toFixed(2);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m*60).toFixed(2).padStart(5, '0')}`;
}
function renderTimer(ms){ const t = fmtTime(ms); $('pTimer').textContent = t; $('pMiniTimer').textContent = t; }
function hideBanner(){ $('pBanner').hidden = true; }
function updatePlayUI(){
  const n = P.history.length, txt = `${n} ${n === 1 ? 'move' : 'moves'}`;
  $('pMoves').textContent = txt; $('pMiniMoves').textContent = txt;
  const [label, cls] = STATUS[P.phase];
  const chip = $('pStatus'); chip.textContent = label; chip.className = 'chip' + (cls ? ' ' + cls : '');
  if(P.phase !== 'solving' && P.phase !== 'free') renderTimer(P.elapsed);
  $('pHist').textContent = n ? P.history.map(m => m.label).join(' ') : 'No turns yet.';
  $('pHist').scrollTop = 1e6;
  $('pUndo').disabled = !n || P.shuffling;
  $('pReset').disabled = P.shuffling;
  $('pShuffle').disabled = P.shuffling;
  const sc = $('pScramble');
  if(P.scramble.length) sc.textContent = scrambleText(P.scramble);
  else sc.innerHTML = '<span class="muted">None yet. Press Shuffle to mix the cube up.</span>';
  $('pCopy').disabled = !P.scramble.length;
}
function renderSolves(){
  const list = loadList(SOLVES_KEY).slice(-100).filter(x => x && Number.isFinite(x.t) && x.t > 0 && Number.isFinite(x.n));
  const ol = $('pSolves'); ol.textContent = '';
  const best = list.reduce((a, x) => Math.min(a, x.t), Infinity);
  list.slice().reverse().slice(0, 12).forEach(x => {
    const li = document.createElement('li');
    const v = document.createElement('span'); v.className = 'v'; v.textContent = `${fmtTime(x.t)} · ${x.n} moves`;
    li.append(v);
    if(x.t === best){ const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'Best'; li.append(tag); }
    if(typeof x.s === 'string') li.title = x.s;
    ol.append(li);
  });
  $('pSolvesEmpty').hidden = list.length > 0;
}
// Queue animated turns so fast key presses play out in order.
function queueTurn(m, dur){
  P.pending++;
  P.chain = P.chain.then(() => animateMove(playCube, m, dur)).finally(() => { P.pending--; });
  return P.chain;
}
function afterPlayerMove(m){
  const now = performance.now();
  // The timer starts on the first turn of any session: after a shuffle, or turning a solved cube in free play.
  if(P.phase === 'ready'){ P.phase = 'solving'; P.t0 = now; }
  else if(P.phase === 'solved' || P.phase === 'done'){ Object.assign(P, {phase:'free', t0:now, elapsed:0, history:[], scramble:[]}); }
  P.history.push(m);
  if(playCube.isSolved()){
    P.elapsed = now - P.t0;
    if(P.phase === 'solving'){
      P.phase = 'done';
      $('pBannerSub').textContent = `${fmtTime(P.elapsed)} · ${P.history.length} moves`;
      $('pBanner').hidden = false;
      const list = loadList(SOLVES_KEY);
      list.push({t:Math.round(P.elapsed), n:P.history.length, s:scrambleText(P.scramble), at:Date.now()});
      store.set(SOLVES_KEY, JSON.stringify(list.slice(-100)));
      renderSolves();
    }else{ P.phase = 'solved'; }   // free play back to solved: the timer stops, nothing is recorded
  }
  updatePlayUI();
}
async function playerTurn(m){
  if(P.shuffling || P.snapping || tdrag) return;
  hideBanner();
  await queueTurn(m, reduceMotion ? 0 : 150);
  afterPlayerMove(m);
}
async function undo(){
  if(!P.history.length || !playIdle()) return;
  hideBanner();
  const m = P.history.pop();
  await queueTurn(inverse(m), reduceMotion ? 0 : 150);
  if(P.phase === 'done') P.phase = 'solving';
  if(P.phase === 'solved' && P.history.length && !playCube.isSolved()) P.phase = 'free';
  if(P.phase === 'free' && playCube.isSolved()){ P.phase = 'solved'; P.elapsed = P.history.length ? performance.now() - P.t0 : 0; }
  updatePlayUI();
}
function resetPlay(){
  if(P.shuffling || P.pending) return;
  abortTurnDrag();
  playCube.reset();
  Object.assign(P, {phase:'solved', history:[], scramble:[], elapsed:0});
  hideBanner(); updatePlayUI();
}
async function shuffleWith(moves){
  if(P.shuffling || P.pending || P.snapping) return;
  abortTurnDrag();
  P.shuffling = true;
  playCube.reset();
  Object.assign(P, {history:[], scramble:moves, elapsed:0, phase:'ready'});
  hideBanner(); updatePlayUI();
  for(const m of moves) await animateMove(playCube, m, reduceMotion ? 0 : 95);
  P.shuffling = false;
  updatePlayUI();
}

/* ================= Timer tab ================= */
// States: idle -> holding (red) -> ready (green) -> running -> stopped. Hold-to-start avoids false starts.
const HOLD_MS = 300, TIMES_KEY = 'timerTimes';
const T = {state:'idle', t0:0, elapsed:0, holdTimer:0, scramble:generate(20), times:[], swallowRelease:false, clearArmed:0};
const T_LABEL = {idle:'Ready', holding:'Keep holding…', ready:'Let go to start', running:'Solving', stopped:'Done'};
const PLAY_ICON = '<path d="M7 4.9v14.2a1 1 0 0 0 1.5.86l11.3-7.1a1 1 0 0 0 0-1.72L8.5 4.04A1 1 0 0 0 7 4.9z"/>';
const STOP_ICON = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
function loadTimes(){
  T.times = loadList(TIMES_KEY).slice(-500).filter(x => x && Number.isFinite(x.t) && x.t > 0 && x.t < 864e5)
    .map(x => ({t:x.t, s:typeof x.s === 'string' ? x.s.slice(0, 300) : '', at:Number.isFinite(x.at) ? x.at : 0}));
}
function saveTimes(){ store.set(TIMES_KEY, JSON.stringify(T.times.slice(-500))); }
function setTState(st){
  T.state = st;
  const el = $('tStage');
  el.classList.toggle('holding', st === 'holding');
  el.classList.toggle('ready', st === 'ready');
  el.classList.toggle('done', st === 'stopped');
  $('tLabel').textContent = T_LABEL[st];
  const running = st === 'running';
  $('tStartLbl').textContent = running ? 'Stop' : 'Start';
  $('tStartIcon').innerHTML = running ? STOP_ICON : PLAY_ICON;
  $('tStart').setAttribute('aria-label', running ? 'Stop timer' : 'Start timer');
}
function tPress(){                       // Space down or finger down on the timer
  if(T.state === 'running'){ stopTimer(); T.swallowRelease = true; return; }
  if(T.state !== 'idle' && T.state !== 'stopped') return;
  setTState('holding');
  $('tDisp').textContent = fmtTime(0);
  clearTimeout(T.holdTimer);
  T.holdTimer = setTimeout(() => { if(T.state === 'holding') setTState('ready'); }, HOLD_MS);
}
function tRelease(){                     // Space up or finger up
  if(T.swallowRelease){ T.swallowRelease = false; return; }
  clearTimeout(T.holdTimer);
  if(T.state === 'ready') startTimer();
  else if(T.state === 'holding'){        // let go too early: put the last result back
    setTState(T.elapsed ? 'stopped' : 'idle');
    $('tDisp').textContent = fmtTime(T.elapsed);
  }
}
function startTimer(){ T.t0 = performance.now(); setTState('running'); }
function stopTimer(){
  const t = performance.now() - T.t0;
  T.elapsed = t;
  T.times.push({t:Math.round(t), s:scrambleText(T.scramble), at:Date.now()});
  saveTimes();
  setTState('stopped');
  $('tDisp').textContent = fmtTime(t);
  newTimerScramble();
  renderTimes();
}
function resetTimer(){                   // also cancels a running solve without recording it
  clearTimeout(T.holdTimer);
  T.elapsed = 0; T.swallowRelease = false;
  setTState('idle');
  $('tDisp').textContent = fmtTime(0);
}
function newTimerScramble(){ T.scramble = generate(20); $('tScramble').textContent = scrambleText(T.scramble); }
function trimmedAverage(n){
  if(T.times.length < n) return null;
  const last = T.times.slice(-n).map(x => x.t).sort((a, b) => a - b).slice(1, -1);
  return last.reduce((a, b) => a + b, 0) / last.length;
}
function renderTimes(){
  const ts = T.times, best = ts.length ? ts.reduce((a, x) => Math.min(a, x.t), Infinity) : null;
  const show = v => v == null ? '–' : fmtTime(v);
  $('tBest').textContent = show(best);
  $('tMiniBest').textContent = show(best);
  $('tAo5').textContent = show(trimmedAverage(5));
  $('tAo12').textContent = show(trimmedAverage(12));
  $('tMean').textContent = ts.length ? fmtTime(ts.reduce((a, x) => a + x.t, 0) / ts.length) : '–';
  $('tTimesLabel').textContent = ts.length ? `Times (${ts.length})` : 'Times';
  const ol = $('tTimes'); ol.textContent = '';
  for(let i = ts.length - 1; i >= 0 && i >= ts.length - 100; i--){
    const x = ts[i], li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${i + 1}.`;
    const v = document.createElement('span'); v.className = 'v'; v.textContent = fmtTime(x.t);
    li.append(n, v);
    if(x.t === best){ const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'Best'; li.append(tag); }
    const del = document.createElement('button');
    del.className = 'x'; del.type = 'button'; del.dataset.i = i; del.textContent = '×';
    del.setAttribute('aria-label', `Delete time ${i + 1}`);
    li.append(del);
    if(x.s) li.title = x.s + (x.at ? `\n${new Date(x.at).toLocaleString()}` : '');
    ol.append(li);
  }
  $('tTimesEmpty').hidden = ts.length > 0;
  $('tClear').hidden = !ts.length;
  $('tClear').textContent = 'Clear all times';
  T.clearArmed = 0;
}

/* ================= Mode switching ================= */
const MODES = ['step', 'play', 'timer'];
let booted = false;
function setMode(next){
  if(!MODES.includes(next)) next = 'step';
  if(next === mode && booted) return;
  booted = true;
  if(tdrag) abortTurnDrag();
  drag = null; pinch = null; pts.clear();
  mode = next;
  document.querySelectorAll('[data-mode]').forEach(el => { el.hidden = !el.dataset.mode.split(' ').includes(mode); });
  $('tabStep').setAttribute('aria-selected', String(mode === 'step'));
  $('tabPlay').setAttribute('aria-selected', String(mode === 'play'));
  $('tabTimer').setAttribute('aria-selected', String(mode === 'timer'));
  if(V[mode]) V[mode].stage.insertBefore(cv, V[mode].stage.firstChild);
  store.set('scrambleMode', mode);
  resize();
  if(mode === 'step' && thumbsStale && !busy) buildThumbs();
}

/* ================= Wiring ================= */
$('tabStep').onclick = () => setMode('step');
$('tabPlay').onclick = () => setMode('play');
$('tabTimer').onclick = () => setMode('timer');

$('bStart').onclick = () => goTo(0);
$('bPrev').onclick = () => goTo(idx - 1);
$('bNext').onclick = () => { playing = false; next(); };
$('bEnd').onclick = () => goTo(seq.length);
$('bPlay').onclick = play;
$('seq').addEventListener('click', e => { const t = e.target.closest('.tok'); if(t) goTo(+t.dataset.i); });
$('film').addEventListener('click', e => { const c = e.target.closest('.card'); if(c) goTo(+c.dataset.i); });
$('bNew').onclick = () => loadSequence(generate(+$('len').value));
$('len').addEventListener('input', () => { $('lenOut').textContent = `${$('len').value} moves`; });
$('len').addEventListener('change', () => loadSequence(generate(+$('len').value)));
function speedText(){ speed = +$('speed').value; $('speedOut').textContent = speed === 0 ? 'Instant' : `${(speed/1000).toFixed(2)} s`; }
$('speed').addEventListener('input', speedText);
speedText();
$('dim').addEventListener('change', () => highlight(seq[idx]));
$('autoCam').addEventListener('change', decorate);
$('bToPlay').onclick = () => { setMode('play'); shuffleWith(seq.slice()); };

$('bCopy').onclick = () => copyText($('bCopy'), scrambleText(seq), $('seq'));
$('ownForm').addEventListener('submit', e => {
  e.preventDefault();
  const parsed = parseScramble($('ownInput').value), err = $('ownErr'), problem = scrambleProblem(parsed);
  err.textContent = problem; err.hidden = !problem;
  if(problem) return;
  $('ownInput').value = '';
  loadSequence(parsed.moves);
});
$('recentList').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  const parsed = parseScramble(b.dataset.s || '');
  if(!scrambleProblem(parsed)) loadSequence(parsed.moves);
});

$('pShuffle').onclick = () => shuffleWith(generate(20));
$('pReset').onclick = resetPlay;
$('pUndo').onclick = undo;
$('pLoadStep').onclick = () => shuffleWith(seq.slice());
$('pCopy').onclick = () => copyText($('pCopy'), scrambleText(P.scramble), $('pScramble'));
$('pOwnForm').addEventListener('submit', e => {
  e.preventDefault();
  const parsed = parseScramble($('pOwnInput').value), err = $('pOwnErr'), problem = scrambleProblem(parsed);
  err.textContent = problem; err.hidden = !problem;
  if(problem) return;
  $('pOwnInput').value = '';
  rememberScramble(parsed.moves);
  shuffleWith(parsed.moves);
});

// Timer tab
const tStage = $('tStage');
tStage.addEventListener('pointerdown', e => {
  if(e.button !== 0) return;
  e.preventDefault();
  try{ tStage.setPointerCapture(e.pointerId); }catch(err){}
  tPress();
});
tStage.addEventListener('pointerup', () => tRelease());
tStage.addEventListener('pointercancel', () => { T.swallowRelease = false; if(T.state === 'holding' || T.state === 'ready'){ clearTimeout(T.holdTimer); setTState(T.elapsed ? 'stopped' : 'idle'); $('tDisp').textContent = fmtTime(T.elapsed); } });
tStage.addEventListener('contextmenu', e => e.preventDefault());
$('tStart').onclick = e => { e.currentTarget.blur(); T.state === 'running' ? stopTimer() : startTimer(); };
$('tReset').onclick = e => { e.currentTarget.blur(); resetTimer(); };
$('tNewScr').onclick = newTimerScramble;
$('tCopy').onclick = () => copyText($('tCopy'), scrambleText(T.scramble), $('tScramble'));
$('tToStep').onclick = () => { if(busy) return; loadSequence(T.scramble.slice()); setMode('step'); };
$('tTimes').addEventListener('click', e => {
  const b = e.target.closest('button.x'); if(!b) return;
  T.times.splice(+b.dataset.i, 1); saveTimes(); renderTimes();
});
$('tClear').onclick = () => {
  if(T.clearArmed && Date.now() - T.clearArmed < 4000){ T.times = []; saveTimes(); renderTimes(); return; }
  T.clearArmed = Date.now();
  $('tClear').textContent = `Click again to delete all ${T.times.length} times`;
  setTimeout(() => { if(T.clearArmed && Date.now() - T.clearArmed >= 4000) renderTimes(); }, 4100);
};

$('segFinish').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b || b.dataset.v === look.finish) return;
  look.finish = b.dataset.v; store.set('cubeFinish', look.finish); applyLook(); if(!busy) buildThumbs();
});
$('segStyle').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b || b.dataset.v === look.style) return;
  look.style = b.dataset.v; store.set('cubeStyle', look.style); applyLook(); if(!busy) buildThumbs();
});

const KEYMAP = {KeyU:'U', KeyD:'D', KeyL:'L', KeyR:'R', KeyF:'F', KeyB:'B', KeyM:'M', KeyE:'E', KeyS:'S'};
document.addEventListener('keydown', e => {
  if(e.target.closest('input, textarea, select')) return;
  if(mode === 'timer'){
    if(e.code === 'Space'){ e.preventDefault(); if(!e.repeat) tPress(); return; }
    if(e.key === 'Escape'){ resetTimer(); return; }
    if(T.state === 'running' && !['Shift','Control','Alt','Meta','Tab'].includes(e.key)){ e.preventDefault(); stopTimer(); }
    return;
  }
  if(mode === 'play'){
    if((e.ctrlKey || e.metaKey) && e.code === 'KeyZ'){ e.preventDefault(); undo(); return; }
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYMAP[e.code];
    if(k){ e.preventDefault(); playerTurn(moveFrom(k, e.shiftKey ? -1 : 1)); }
    return;
  }
  if(e.key === 'ArrowRight'){ e.preventDefault(); playing = false; next(); }
  else if(e.key === 'ArrowLeft'){ e.preventDefault(); goTo(idx - 1); }
  else if(e.key === 'Home'){ e.preventDefault(); goTo(0); }
  else if(e.key === 'End'){ e.preventDefault(); goTo(seq.length); }
  else if(e.key === ' ' && !e.target.closest('button')){ e.preventDefault(); play(); }
});

document.addEventListener('keyup', e => {
  if(mode !== 'timer' || e.code !== 'Space' || e.target.closest('input, textarea, select')) return;
  e.preventDefault();
  tRelease();
});

function retheme(){
  const c = signalColor();
  arrowMat.color.set(c); ringMat.color.set(c);
  if(!busy) buildThumbs();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
new MutationObserver(retheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

function applyScheme(key){
  schemeKey = key;
  store.set('scrambleScheme', key);
  setFaceColors();
  stepCube.recolor(); playCube.recolor();
  const S = SCHEMES[key];
  const bold = t => { const b = document.createElement('b'); b.textContent = t; return b; };
  $('hold').replaceChildren('Hold your cube with ', bold(S.U), ' on top, ', bold(S.F), ' facing you and ', bold(S.R), ' on the right.');
  $('logoU').setAttribute('fill', COLORS[S.U]);
  $('logoF').setAttribute('fill', COLORS[S.F]);
  $('logoR').setAttribute('fill', COLORS[S.R]);
  $('scheme').value = key;
}
$('scheme').addEventListener('change', () => {
  if(busy){ $('scheme').value = schemeKey; return; }
  if(!isScheme($('scheme').value)) return;
  applyScheme($('scheme').value); highlight(seq[idx]); buildThumbs();
});

/* ================= Boot ================= */
applyScheme(schemeKey);
// A self-hosted link like ?scramble=R+U2+F' opens that scramble.
try{
  const q = new URLSearchParams(location.search).get('scramble');
  if(q){ const parsed = parseScramble(q); if(!scrambleProblem(parsed)) seq = parsed.moves; }
}catch(e){}
renderSeq();
stepCube.setState(seq, 0);
rememberScramble(seq);
loadTimes(); newTimerScramble(); renderTimes(); renderSolves();
const hashMode = location.hash.slice(1);
setMode(MODES.includes(hashMode) ? hashMode : (MODES.includes(store.get('scrambleMode')) ? store.get('scrambleMode') : 'step'));
buildThumbs();
updatePlayUI();
requestAnimationFrame(frame);
})();
