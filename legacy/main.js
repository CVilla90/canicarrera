/* Canicarrera — 3D marble race proof of concept.
 * three.js r128 (vendored, UMD). No physics engine: marbles are constrained to a
 * procedurally generated tube track and simulated in 1-D along its arc length,
 * with per-race random traits + wander noise + bump collisions => random winner. */
(() => {
'use strict';

// ---------------------------------------------------------------- helpers
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// ---------------------------------------------------------------- config
const MARBLES = 8;
const MARBLE_R = 0.34;
const TUBE_R = 0.95;
const GRAVITY = 9.8;
const ROLL = 5 / 7;          // rolling solid sphere: only 5/7 of gravity accelerates it
const DT = 1 / 120;          // fixed physics substep
const NAMES = ['Rayo', 'Luna', 'Fuego', 'Jade', 'Cometa', 'Ambar',
               'Turbo', 'Bruma', 'Chispa', 'Trueno', 'Perla', 'Vega'];

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

// ---------------------------------------------------------------- dom
const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const clockEl = document.getElementById('clock');
const resultsEl = document.getElementById('results');
const resultsList = document.getElementById('results-list');

// ---------------------------------------------------------------- renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b16);
scene.fog = new THREE.Fog(0x070b16, 45, 170);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a14, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(30, 60, 20);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x222233, 0.6));

// starfield
{
  const n = 1500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const ph = Math.random() * Math.PI * 2;
    const r = rand(160, 320);
    const sq = Math.sqrt(1 - u * u);
    pos[3 * i] = r * sq * Math.cos(ph);
    pos[3 * i + 1] = r * u * 0.6 + 10;
    pos[3 * i + 2] = r * sq * Math.sin(ph);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xbfd0ff, size: 0.9, transparent: true, opacity: 0.85, fog: false,
  })));
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- track
let track = null; // { total, finishS, pos[], tan[], cum[], group }

function lookup(tb, s) {
  s = clamp(s, 0, tb.total);
  let lo = 0, hi = tb.cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (tb.cum[mid] <= s) lo = mid; else hi = mid;
  }
  const span = tb.cum[hi] - tb.cum[lo] || 1e-9;
  const f = (s - tb.cum[lo]) / span;
  return {
    p: new THREE.Vector3().lerpVectors(tb.pos[lo], tb.pos[hi], f),
    t: new THREE.Vector3().lerpVectors(tb.tan[lo], tb.tan[hi], f).normalize(),
  };
}

// local frame at arc length s: p position, t tangent, d "down" perpendicular
// to the tangent (where a marble rests inside the tube), side = lateral axis
function frameAt(tb, s) {
  const { p, t } = lookup(tb, s);
  const d = DOWN.clone().addScaledVector(t, -DOWN.dot(t));
  if (d.lengthSq() < 1e-6) d.set(0, -1, 0); else d.normalize();
  const side = new THREE.Vector3().crossVectors(t, d).normalize();
  return { p, t, d, side };
}

function buildTrack() {
  if (track) {
    scene.remove(track.group);
    track.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  // random winding descent: straight launch ramp, curvy middle, gentle run-out
  const pts = [];
  let x = 0, y = 0, z = 0;
  let heading = rand(0, Math.PI * 2);
  const push = () => pts.push(new THREE.Vector3(x, y, z));
  push();
  x += Math.cos(heading) * 9; z += Math.sin(heading) * 9; y -= 3.2; push();
  for (let i = 0; i < 13; i++) {
    heading += rand(-0.85, 0.85);
    const step = rand(6.5, 10);
    x += Math.cos(heading) * step;
    z += Math.sin(heading) * step;
    y -= rand(1.8, 3.4);
    push();
  }
  for (let k = 0; k < 2; k++) {
    heading += rand(-0.25, 0.25);
    x += Math.cos(heading) * 8; z += Math.sin(heading) * 8; y -= 0.6;
    push();
  }

  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');

  // arc-length lookup table
  const N = 2600;
  const pos = [], tan = [], cum = [0];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pos.push(curve.getPoint(t));
    tan.push(curve.getTangent(t).normalize());
    if (i > 0) cum.push(cum[i - 1] + pos[i].distanceTo(pos[i - 1]));
  }
  const total = cum[N];
  const tb = { total, pos, tan, cum };

  const group = new THREE.Group();

  // glass chute
  const tubeGeo = new THREE.TubeGeometry(curve, 600, TUBE_R, 14, false);
  group.add(new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({
    color: 0x9fd8ff, metalness: 0.1, roughness: 0.25,
    transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
  })));
  group.add(new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({
    color: 0x3f6fae, wireframe: true, transparent: true, opacity: 0.06, depthWrite: false,
  })));

  // checkpoint rings, alternating cyan / magenta
  const ringGeo = new THREE.TorusGeometry(TUBE_R + 0.22, 0.06, 10, 40);
  let ri = 0;
  for (let f = 0.12; f < 0.9; f += 0.13, ri++) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: ri % 2 ? 0xff4fd8 : 0x37e0ff, transparent: true, opacity: 0.85,
    }));
    const fr = frameAt(tb, f * total);
    ring.position.copy(fr.p);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fr.t);
    group.add(ring);
  }

  // gold finish arch
  const finishS = total - 12;
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(TUBE_R + 0.38, 0.13, 12, 48),
    new THREE.MeshBasicMaterial({ color: 0xffc23d }),
  );
  const fr = frameAt(tb, finishS);
  arch.position.copy(fr.p);
  arch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fr.t);
  group.add(arch);

  scene.add(group);
  track = { ...tb, finishS, group };
}

// ---------------------------------------------------------------- marbles
const sphereGeo = new THREE.SphereGeometry(MARBLE_R, 28, 20);
const dotGeo = new THREE.SphereGeometry(0.09, 10, 8);
let marbles = [];

function makeMarbles() {
  for (const m of marbles) {
    scene.remove(m.mesh);
    m.mesh.material.dispose();
  }
  marbles = [];
  const hueOff = Math.random();
  const names = shuffle(NAMES.slice()).slice(0, MARBLES);
  const slots = shuffle([...Array(MARBLES).keys()]); // random starting grid => grid luck too

  for (let i = 0; i < MARBLES; i++) {
    const color = new THREE.Color().setHSL((hueOff + i / MARBLES) % 1, 0.72, 0.55);
    const mat = new THREE.MeshStandardMaterial({
      color, metalness: 0.35, roughness: 0.2,
      emissive: color.clone().multiplyScalar(0.22),
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    // white cap so the rolling spin is visible
    const cap = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    cap.position.set(0, MARBLE_R * 0.8, 0);
    mesh.add(cap);
    scene.add(mesh);

    const slot = slots[i];
    marbles.push({
      name: names[i], color, mesh,
      s: 2.2 + Math.floor(slot / 2) * -0.95, // grid: staggered rows of two
      v: 0,
      lane: slot % 2 === 0 ? 1 : -1,
      swayF: rand(0.5, 1.3), swayP: rand(0, Math.PI * 2), swayA: rand(0.25, 0.4),
      mu: 0.115 * rand(0.92, 1.08),   // rolling resistance, per race
      cd: 0.012 * rand(0.88, 1.12),   // aero drag, per race
      mass: rand(0.9, 1.15),
      wander: 0,                       // Ornstein-Uhlenbeck luck term
      finished: false, finishTime: 0, place: 0,
    });
  }
}

const thetaOf = (m) => m.lane * 0.55 + Math.sin(raceTime * m.swayF + m.swayP) * m.swayA;

// ---------------------------------------------------------------- race state
let phase = 'countdown'; // countdown | racing | finished
let raceTime = 0;
let countdownT = 0;
let finishOrder = [];
let banner = { text: '', color: '', t: 0 };
let orbitA = 0;
const camLook = new THREE.Vector3();
const camTargetPos = new THREE.Vector3();

function resetRace(newTrack) {
  if (newTrack || !track) buildTrack();
  makeMarbles();
  finishOrder = [];
  raceTime = 0;
  countdownT = 2.999;
  phase = 'countdown';
  banner = { text: '', color: '', t: 0 };
  orbitA = 0;
  resultsEl.classList.add('hidden');
  buildBoard();

  // snap camera behind the grid
  const fr = frameAt(track, 0);
  camera.position.copy(fr.p).addScaledVector(UP, 4.2).addScaledVector(fr.t, -6);
  camLook.copy(frameAt(track, 8).p);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------- physics
function step(dt) {
  if (phase === 'countdown') {
    countdownT -= dt;
    if (countdownT <= 0) {
      phase = 'racing';
      banner = { text: '¡GO!', color: '#ffffff', t: 0.9 };
    }
    return;
  }
  if (phase === 'finished') return;

  raceTime += dt;
  for (const m of marbles) {
    const { t } = lookup(track, m.s);
    let a = -GRAVITY * t.y * ROLL;   // downhill component
    a -= m.mu * m.v;                 // rolling resistance
    a -= m.cd * m.v * Math.abs(m.v); // drag
    m.wander += (Math.random() * 2 - 1) * 9 * dt;
    m.wander *= Math.exp(-1.1 * dt);
    m.wander = clamp(m.wander, -1.6, 1.6);
    if (m.finished) a -= 2.2 * m.v;  // brake after the line
    else a += m.wander;

    m.v = Math.max(0, m.v + a * dt);
    m.s += m.v * dt;
    if (m.s > track.total - 0.8) { m.s = track.total - 0.8; m.v = 0; }

    if (!m.finished && m.s >= track.finishS) {
      m.finished = true;
      m.finishTime = raceTime;
      m.place = finishOrder.length + 1;
      finishOrder.push(m);
      if (m.place === 1) {
        banner = { text: `\u{1F3C6} ${m.name}!`, color: '#' + m.color.getHexString(), t: 4 };
        spawnConfetti(frameAt(track, track.finishS).p);
      }
    }
  }

  collide();

  if (finishOrder.length === marbles.length) endRace();
  // failsafe: close the race if stragglers dawdle too long after the win
  else if (finishOrder.length > 0 && raceTime > finishOrder[0].finishTime + 25) endRace();
}

function collide() {
  const arr = [...marbles].sort((a, b) => a.s - b.s);
  const rOff = TUBE_R - MARBLE_R - 0.05;
  const minD = MARBLE_R * 2 * 0.96;
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    const ds = b.s - a.s;
    if (ds >= minD) continue;
    const dLat = Math.abs(thetaOf(a) - thetaOf(b)) * rOff;
    const gap2 = ds * ds + dLat * dLat;
    if (gap2 >= minD * minD) continue;
    if (a.v > b.v) { // rear catching the front: restitution exchange
      const e = 0.85, u1 = a.v, u2 = b.v, m1 = a.mass, m2 = b.mass;
      a.v = ((m1 - e * m2) * u1 + (1 + e) * m2 * u2) / (m1 + m2);
      b.v = ((m2 - e * m1) * u2 + (1 + e) * m1 * u1) / (m1 + m2);
    }
    if (dLat < MARBLE_R * 1.2) { // directly in line: push apart
      const need = (minD - Math.sqrt(gap2)) * 0.5;
      a.s -= need;
      b.s += need;
    }
  }
}

function endRace() {
  phase = 'finished';
  banner.t = 0; // results panel replaces the winner banner
  const rest = marbles.filter((m) => !m.finished).sort((a, b) => b.s - a.s);
  for (const m of rest) {
    m.place = finishOrder.length + 1;
    finishOrder.push(m);
  }
  resultsList.innerHTML = '';
  for (const m of finishOrder) {
    const li = document.createElement('li');
    const time = m.finishTime ? m.finishTime.toFixed(2) + ' s' : 'DNF';
    li.innerHTML = `<span class="pos">${m.place}</span>` +
      `<span class="dot" style="background:#${m.color.getHexString()};color:#${m.color.getHexString()}"></span>` +
      `<span>${m.name}</span><span class="t">${time}</span>`;
    resultsList.appendChild(li);
  }
  resultsEl.classList.remove('hidden');
}

// ---------------------------------------------------------------- confetti
let confetti = null;

function spawnConfetti(center) {
  if (confetti) { scene.remove(confetti.points); confetti.points.geometry.dispose(); }
  const n = 260;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = [];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos[3 * i] = center.x + rand(-0.4, 0.4);
    pos[3 * i + 1] = center.y + rand(-0.2, 0.6);
    pos[3 * i + 2] = center.z + rand(-0.4, 0.4);
    vel.push(new THREE.Vector3(rand(-1, 1), rand(0.4, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(2, 8)));
    c.setHSL(Math.random(), 0.85, 0.6);
    col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, opacity: 1,
  }));
  scene.add(points);
  confetti = { points, vel, life: 2.8 };
}

function updateConfetti(dt) {
  if (!confetti) return;
  confetti.life -= dt;
  if (confetti.life <= 0) {
    scene.remove(confetti.points);
    confetti.points.geometry.dispose();
    confetti.points.material.dispose();
    confetti = null;
    return;
  }
  const attr = confetti.points.geometry.attributes.position;
  for (let i = 0; i < confetti.vel.length; i++) {
    const v = confetti.vel[i];
    v.y -= 6.5 * dt;
    attr.array[3 * i] += v.x * dt;
    attr.array[3 * i + 1] += v.y * dt;
    attr.array[3 * i + 2] += v.z * dt;
  }
  attr.needsUpdate = true;
  confetti.points.material.opacity = clamp(confetti.life / 2.8, 0, 1);
}

// ---------------------------------------------------------------- visuals
function updateVisuals(dt) {
  const rOff = TUBE_R - MARBLE_R - 0.05;
  for (const m of marbles) {
    const fr = frameAt(track, m.s);
    const th = thetaOf(m);
    m.mesh.position.copy(fr.p)
      .addScaledVector(fr.d, Math.cos(th) * rOff)
      .addScaledVector(fr.side, Math.sin(th) * rOff);
    if (m.v > 0.01) m.mesh.rotateOnWorldAxis(fr.side, (m.v * dt) / MARBLE_R);
  }

  // camera: chase the leader; slow orbit of the finish once it's over
  if (phase === 'finished' && finishOrder.length) {
    orbitA += dt * 0.35;
    const c = frameAt(track, track.finishS);
    camTargetPos.set(c.p.x + Math.cos(orbitA) * 13, c.p.y + 6, c.p.z + Math.sin(orbitA) * 13);
    var lookPt = c.p;
  } else {
    const leader = marbles.reduce((a, b) => (b.s > a.s ? b : a), marbles[0]);
    const behind = frameAt(track, Math.max(leader.s - 7.5, 0));
    camTargetPos.copy(behind.p).addScaledVector(UP, 4.2).addScaledVector(behind.t, -1.5);
    var lookPt = frameAt(track, Math.min(leader.s + 6, track.total)).p;
  }
  const k = 1 - Math.pow(0.0015, dt);
  camera.position.lerp(camTargetPos, k);
  camLook.lerp(lookPt, k);
  camera.lookAt(camLook);

  updateConfetti(dt);
  updateHud(dt);
}

// ---------------------------------------------------------------- hud
let boardRows = [];

function buildBoard() {
  boardEl.innerHTML = '';
  boardRows = [];
  for (let i = 0; i < marbles.length; i++) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="row"><span class="pos"></span><span class="dot"></span>' +
      '<span class="name"></span><span class="val"></span></div><div class="bar"></div>';
    boardEl.appendChild(li);
    boardRows.push({
      li,
      pos: li.querySelector('.pos'),
      dot: li.querySelector('.dot'),
      name: li.querySelector('.name'),
      val: li.querySelector('.val'),
      bar: li.querySelector('.bar'),
    });
  }
}

let boardTimer = 0;

function updateHud(dt) {
  // status banner
  if (phase === 'countdown') {
    statusEl.textContent = String(Math.ceil(countdownT));
    statusEl.style.color = '#e8eef8';
    statusEl.style.opacity = 1;
    statusEl.classList.remove('small');
  } else if (banner.t > 0) {
    banner.t -= dt;
    statusEl.textContent = banner.text;
    statusEl.style.color = banner.color;
    statusEl.style.opacity = 1;
    statusEl.classList.toggle('small', banner.text.length > 6);
  } else {
    statusEl.style.opacity = 0;
  }

  clockEl.textContent = raceTime.toFixed(1) + ' s';

  boardTimer -= dt;
  if (boardTimer > 0) return;
  boardTimer = 0.2;

  const order = [...marbles].sort(
    (a, b) => (a.place || 99) - (b.place || 99) || b.s - a.s,
  );
  for (let i = 0; i < order.length; i++) {
    const m = order[i], r = boardRows[i];
    const hex = '#' + m.color.getHexString();
    r.pos.textContent = i + 1;
    r.dot.style.background = hex;
    r.dot.style.color = hex;
    r.name.textContent = m.name;
    if (m.finished) {
      r.val.textContent = m.finishTime.toFixed(2);
      r.val.classList.add('done');
    } else {
      r.val.textContent = Math.round(clamp(m.s / track.finishS, 0, 1) * 100) + '%';
      r.val.classList.remove('done');
    }
    r.bar.style.background = hex;
    r.bar.style.width = clamp(m.s / track.finishS, 0.02, 1) * 100 + '%';
  }
}

// ---------------------------------------------------------------- main loop
document.getElementById('btn-race').addEventListener('click', () => resetRace(false));
document.getElementById('btn-track').addEventListener('click', () => resetRace(true));

resetRace(true);

// Physics advances on wall-clock time, driven by BOTH rAF and a timer, so the
// race keeps running (throttled but correct) when the tab is in the background.
let lastSim = performance.now();
let lastFrame = performance.now();
let acc = 0;

function advance() {
  const now = performance.now();
  acc += Math.min((now - lastSim) / 1000, 1.0);
  lastSim = now;
  let guard = 150;
  while (acc >= DT && guard-- > 0) {
    step(DT);
    acc -= DT;
  }
  if (guard <= 0) acc = 0;
}
setInterval(advance, 250);

function loop(now) {
  requestAnimationFrame(loop);
  const frameDt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  advance();
  updateVisuals(frameDt);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

})();
