// Procedural low-poly mesh builders. Geometries and materials are module-level
// and shared across every instance — builders only compose Groups/Meshes.
import * as THREE from 'three';

const mat = (color, extra = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

const MATS = {
  skin: mat(0xe0ac69),
  shirt: mat(0x2e86de),
  sleeve: mat(0x1b6ec2),
  pants: mat(0x2d3436),
  shoe: mat(0xf5f0e6),
  shoeSole: mat(0x40342a),
  cap: mat(0xd63031),
  hair: mat(0x3a2a1a),
  deck: mat(0x6c3f18),
  grip: mat(0x232323),
  wheel: mat(0xf5f0e6),
  truck: mat(0x95a5a6),
  coneOrange: mat(0xe8641b),
  coneWhite: mat(0xf5f5f5),
  barrierRed: mat(0xc0392b),
  barrierWhite: mat(0xecf0f1),
  crate: mat(0x8e6e3a),
  crateDark: mat(0x6b5227),
  containerDoor: mat(0x2c3e50),
  signPost: mat(0x7f8c8d),
  signPanel: mat(0x27ae60),
  rail: mat(0xb0b8bf),
  railPost: mat(0x7f8c8d),
  coin: mat(0xf1c40f, { emissive: 0x8a6d00 }),
  building: mat(0xa8b8c8),
  building2: mat(0xc8a8a0),
  building3: mat(0x9fb89a),
  roof: mat(0x6e7a86),
  door: mat(0x5a4632),
  windowDark: mat(0x3a4a5a), // emissive lerps warm at night (see world.js)
  tree: mat(0x2e8b57),
  treeLight: mat(0x3fa06a),
  trunk: mat(0x6b4f2a),
  // Cars
  carGlass: mat(0x9fc4d8),
  carTire: mat(0x1f1f22),
  carHub: mat(0xc9ced4),
  carLight: mat(0xfff3c4, { emissive: 0xbba75a }),
  carTail: mat(0xd63031, { emissive: 0x5a0d0d }),
  bumper: mat(0x8f979d),
  // Bike
  bikeFrame: mat(0xd35400),
  bikeSeat: mat(0x2d3436),
  // Hole
  holeDark: mat(0x0d0d10),
  hazard: mat(0xe8b41b),
  // Streetlight (lamp emissive lerps on at night)
  lampPost: mat(0x4a5258),
  lamp: mat(0xfff2cc, { emissive: 0x000000 }),
  // Park
  ramp: mat(0xc8ccd2),
  rampSide: mat(0x9aa1a8),
  fence: mat(0x7a8a5a),
  bench: mat(0x8a5f30),
  bush: mat(0x3c8f4e),
  // Subway
  tunnelWall: mat(0x6a6258),
  tunnelTile: mat(0x8d8478),
  pillar: mat(0x4e4a44),
};

// Materials the world theme animates at runtime (night window/lamp glow).
export const THEME_MATS = { window: MATS.windowDark, lamp: MATS.lamp };

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  wheel: new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10),
  carWheel: new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12),
  carHub: new THREE.CylinderGeometry(0.14, 0.14, 0.24, 8),
  bikeWheel: new THREE.TorusGeometry(0.34, 0.045, 8, 16),
  tube: new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
  cone: new THREE.CylinderGeometry(0.06, 0.32, 0.75, 10),
  coneBand: new THREE.CylinderGeometry(0.19, 0.24, 0.14, 10),
  post: new THREE.CylinderGeometry(0.07, 0.07, 1, 8),
  railBar: new THREE.CylinderGeometry(0.06, 0.06, 1, 10),
  coin: new THREE.CylinderGeometry(0.35, 0.35, 0.09, 14),
  head: new THREE.SphereGeometry(0.22, 10, 8),
  crown: new THREE.SphereGeometry(0.8, 7, 5),
  lampHead: new THREE.SphereGeometry(0.16, 8, 6),
};

function box(material, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(GEO.box, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

function tube(material, length, x, y, z, rx = 0, rz = 0) {
  const m = new THREE.Mesh(GEO.tube, material);
  m.scale.y = length;
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  return m;
}

// ---------------------------------------------------------------- skater ---
// Default skater palette; a selected character/board overrides these.
export const DEFAULT_SKATER_PALETTE = {
  skin: 0xe0ac69, shirt: 0x2e86de, sleeve: 0x1b6ec2, pants: 0x2d3436,
  cap: 0xd63031, hair: 0x3a2a1a, shoe: 0xf5f0e6, deck: 0x6c3f18,
  glow: 0x2ee6ff, // hoverboard under-glow (emissive)
};

// Returns { group, parts, mats } — `parts` are the sub-groups player.js
// animates; `mats` are the per-instance materials player.applyPalette()
// recolors so the skater/board can be re-skinned live without a rebuild.
export function buildSkater(palette = {}) {
  const p = { ...DEFAULT_SKATER_PALETTE, ...palette };
  // Per-instance materials for the customizable parts (few skaters exist).
  // `glow` is emissive so the hoverboard underside shines regardless of light.
  const M = {
    skin: mat(p.skin), shirt: mat(p.shirt), sleeve: mat(p.sleeve), pants: mat(p.pants),
    cap: mat(p.cap), hair: mat(p.hair), shoe: mat(p.shoe), deck: mat(p.deck),
    glow: new THREE.MeshLambertMaterial({ color: p.glow, emissive: p.glow }),
  };

  const group = new THREE.Group();

  // Board (deck + grip + trucks + wheels), origin at ground level.
  const board = new THREE.Group();
  const deck = box(M.deck, 0.32, 0.05, 1.05, 0, 0.26, 0);
  const grip = box(MATS.grip, 0.3, 0.015, 1.0, 0, 0.29, 0);
  const nose = box(M.deck, 0.3, 0.05, 0.16, 0, 0.3, -0.56);
  nose.rotation.x = -0.45;
  const tail = box(M.deck, 0.3, 0.05, 0.16, 0, 0.3, 0.56);
  tail.rotation.x = 0.45;
  board.add(deck, grip, nose, tail);

  // Skate gear: wheels + trucks. Hidden when riding a hoverboard.
  const skateGear = new THREE.Group();
  const wheels = [];
  for (const [x, z] of [
    [-0.14, -0.32],
    [0.14, -0.32],
    [-0.14, 0.32],
    [0.14, 0.32],
  ]) {
    const w = new THREE.Mesh(GEO.wheel, MATS.wheel);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.09, z);
    skateGear.add(w);
    wheels.push(w);
  }
  skateGear.add(
    box(MATS.truck, 0.22, 0.07, 0.1, 0, 0.18, -0.32),
    box(MATS.truck, 0.22, 0.07, 0.1, 0, 0.18, 0.32)
  );
  board.add(skateGear);

  // Hover gear: glowing underside plate + twin thruster pods. Hidden on a
  // skateboard; the glow material recolors per selected hoverboard.
  const hoverGear = new THREE.Group();
  hoverGear.add(
    box(M.glow, 0.26, 0.04, 0.95, 0, 0.21, 0), // under-glow plate
    box(MATS.truck, 0.2, 0.09, 0.24, 0, 0.17, -0.34), // pods
    box(MATS.truck, 0.2, 0.09, 0.24, 0, 0.17, 0.34),
    box(M.glow, 0.14, 0.05, 0.06, 0, 0.14, -0.46), // thruster exhausts
    box(M.glow, 0.14, 0.05, 0.06, 0, 0.14, 0.46)
  );
  hoverGear.visible = false;
  board.add(hoverGear);

  group.add(board);

  // Body, origin at board deck level; slight skate stance (feet apart on z).
  const body = new THREE.Group();
  body.position.y = 0.29;

  const legs = new THREE.Group();
  const legL = new THREE.Group();
  legL.position.set(-0.09, 0, -0.18);
  legL.add(
    box(M.pants, 0.14, 0.55, 0.14, 0, 0.275, 0),
    box(M.shoe, 0.15, 0.09, 0.3, 0, 0.045, 0.04),
    box(MATS.shoeSole, 0.16, 0.03, 0.31, 0, 0.015, 0.04)
  );
  const legR = new THREE.Group();
  legR.position.set(0.09, 0, 0.2);
  legR.add(
    box(M.pants, 0.14, 0.55, 0.14, 0, 0.275, 0),
    box(M.shoe, 0.15, 0.09, 0.3, 0, 0.045, -0.04),
    box(MATS.shoeSole, 0.16, 0.03, 0.31, 0, 0.015, -0.04)
  );
  legs.add(legL, legR);

  const torso = new THREE.Group();
  torso.position.y = 0.55;
  torso.add(
    box(M.shirt, 0.36, 0.5, 0.22, 0, 0.25, 0),
    box(M.sleeve, 0.38, 0.12, 0.24, 0, 0.44, 0) // shoulder band
  );

  const arms = new THREE.Group();
  arms.position.y = 0.45;
  const armL = new THREE.Group();
  armL.position.x = -0.24;
  armL.add(
    box(M.sleeve, 0.1, 0.2, 0.1, 0, -0.08, 0),
    box(M.skin, 0.09, 0.24, 0.09, 0, -0.28, 0),
    box(M.skin, 0.11, 0.1, 0.11, 0, -0.44, 0) // hand
  );
  const armR = new THREE.Group();
  armR.position.x = 0.24;
  armR.add(
    box(M.sleeve, 0.1, 0.2, 0.1, 0, -0.08, 0),
    box(M.skin, 0.09, 0.24, 0.09, 0, -0.28, 0),
    box(M.skin, 0.11, 0.1, 0.11, 0, -0.44, 0)
  );
  arms.add(armL, armR);
  torso.add(arms);

  const head = new THREE.Group();
  head.position.y = 0.62;
  const skull = new THREE.Mesh(GEO.head, M.skin);
  const hair = box(M.hair, 0.36, 0.1, 0.36, 0, 0.05, 0.06);
  const capTop = box(M.cap, 0.34, 0.1, 0.34, 0, 0.14, 0);
  const capBrim = box(M.cap, 0.3, 0.04, 0.18, 0, 0.1, -0.26);
  head.add(skull, hair, capTop, capBrim);
  torso.add(head);

  body.add(legs, torso);
  group.add(body);

  return {
    group,
    parts: { board, wheels, skateGear, hoverGear, body, legs, torso, arms, head },
    mats: M,
  };
}

// ------------------------------------------------------------- obstacles ---
export function buildCone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.cone, MATS.coneOrange);
  body.position.y = 0.42;
  const band = new THREE.Mesh(GEO.coneBand, MATS.coneWhite);
  band.position.y = 0.5;
  g.add(box(MATS.coneOrange, 0.55, 0.06, 0.55, 0, 0.03, 0), body, band);
  return g;
}

export function buildBarrier() {
  const g = new THREE.Group();
  g.add(
    box(MATS.barrierRed, 1.5, 0.3, 0.16, 0, 0.95, 0),
    box(MATS.barrierWhite, 1.5, 0.22, 0.14, 0, 0.62, 0),
    box(MATS.barrierWhite, 0.3, 0.3, 0.17, -0.45, 0.95, 0), // reflective patches
    box(MATS.barrierWhite, 0.3, 0.3, 0.17, 0.45, 0.95, 0),
    box(MATS.barrierRed, 0.12, 0.85, 0.12, -0.65, 0.42, 0),
    box(MATS.barrierRed, 0.12, 0.85, 0.12, 0.65, 0.42, 0),
    box(MATS.barrierRed, 0.4, 0.06, 0.3, -0.65, 0.03, 0), // feet
    box(MATS.barrierRed, 0.4, 0.06, 0.3, 0.65, 0.03, 0)
  );
  return g;
}

export function buildCrate() {
  const g = new THREE.Group();
  g.add(
    box(MATS.crate, 1.4, 2.2, 1.0, 0, 1.1, 0),
    box(MATS.crateDark, 1.46, 0.14, 1.06, 0, 0.55, 0),
    box(MATS.crateDark, 1.46, 0.14, 1.06, 0, 1.65, 0),
    box(MATS.crateDark, 0.14, 2.26, 1.06, -0.63, 1.1, 0), // corner braces
    box(MATS.crateDark, 0.14, 2.26, 1.06, 0.63, 1.1, 0)
  );
  return g;
}

export function buildSign() {
  const g = new THREE.Group();
  for (const x of [-1.1, 1.1]) {
    const post = new THREE.Mesh(GEO.post, MATS.signPost);
    post.scale.y = 2.4;
    post.position.set(x, 1.2, 0);
    g.add(post);
  }
  g.add(
    box(MATS.signPanel, 2.5, 0.85, 0.1, 0, 1.85, 0),
    box(MATS.barrierWhite, 2.1, 0.12, 0.12, 0, 1.85, 0.06)
  );
  return g;
}

export function buildRail(length) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(GEO.railBar, MATS.rail);
  bar.rotation.x = Math.PI / 2;
  bar.scale.y = length;
  bar.position.y = 0.9;
  g.add(bar);
  const postCount = Math.max(2, Math.round(length / 5));
  for (let i = 0; i < postCount; i++) {
    const post = new THREE.Mesh(GEO.post, MATS.railPost);
    post.scale.y = 0.88;
    post.position.set(0, 0.44, -length / 2 + (i / (postCount - 1)) * length);
    g.add(post);
  }
  return g;
}

// A parked car blocking the lane (full-height, must dodge).
const CAR_BODY_MATS = [mat(0xc0392b), mat(0x2980b9), mat(0xf39c12), mat(0x7f8c8d), mat(0x27ae60)];

// Shipping-container body colors (weathered industrial hues).
const MATS_CONTAINER = [mat(0xb7472a), mat(0x2f6f8f), mat(0xd9a441), mat(0x3f7d4f), mat(0x8a8f94)];

export function buildCar() {
  const g = new THREE.Group();
  const body = CAR_BODY_MATS[Math.floor(Math.random() * CAR_BODY_MATS.length)];

  g.add(
    box(body, 1.7, 0.52, 3.4, 0, 0.58, 0), // main shell
    box(body, 1.6, 0.3, 0.9, 0, 0.95, -1.15), // hood
    box(body, 1.6, 0.34, 0.7, 0, 0.97, 1.3), // trunk
    box(MATS.bumper, 1.74, 0.2, 0.25, 0, 0.42, -1.72), // bumpers
    box(MATS.bumper, 1.74, 0.2, 0.25, 0, 0.42, 1.72)
  );
  // Cabin with glass.
  g.add(
    box(MATS.carGlass, 1.42, 0.44, 1.5, 0, 1.32, 0.15),
    box(body, 1.5, 0.08, 1.7, 0, 1.56, 0.15), // roof
    box(body, 0.1, 0.44, 1.55, -0.72, 1.32, 0.15), // pillars
    box(body, 0.1, 0.44, 1.55, 0.72, 1.32, 0.15)
  );
  // Lights.
  g.add(
    box(MATS.carLight, 0.34, 0.14, 0.08, -0.55, 0.78, -1.78),
    box(MATS.carLight, 0.34, 0.14, 0.08, 0.55, 0.78, -1.78),
    box(MATS.carTail, 0.34, 0.14, 0.08, -0.55, 0.85, 1.78),
    box(MATS.carTail, 0.34, 0.14, 0.08, 0.55, 0.85, 1.78)
  );
  // Wheels with hubcaps.
  for (const [x, z] of [[-0.82, -1.05], [0.82, -1.05], [-0.82, 1.15], [0.82, 1.15]]) {
    const tire = new THREE.Mesh(GEO.carWheel, MATS.carTire);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, 0.32, z);
    const hub = new THREE.Mesh(GEO.carHub, MATS.carHub);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, 0.32, z);
    g.add(tire, hub);
  }
  return g;
}

// A fallen bike lying across the lane — low, jump it.
export function buildBike() {
  const g = new THREE.Group();
  const bike = new THREE.Group();

  for (const z of [-0.62, 0.62]) {
    const wheel = new THREE.Mesh(GEO.bikeWheel, MATS.carTire);
    wheel.position.set(0, 0.34, z);
    const hub = new THREE.Mesh(GEO.carHub, MATS.carHub);
    hub.rotation.z = Math.PI / 2;
    hub.scale.set(0.5, 0.3, 0.5);
    hub.position.set(0, 0.34, z);
    bike.add(wheel, hub);
  }
  bike.add(
    tube(MATS.bikeFrame, 0.95, 0, 0.5, 0, Math.PI / 2 - 0.25, 0), // top tube
    tube(MATS.bikeFrame, 0.7, 0, 0.42, -0.28, 0.6, 0), // down tube
    tube(MATS.bikeFrame, 0.55, 0, 0.55, 0.45, 0.35, 0), // seat tube
    tube(MATS.bikeFrame, 0.6, 0, 0.55, -0.55, -0.3, 0) // fork
  );
  bike.add(
    box(MATS.bikeSeat, 0.12, 0.06, 0.3, 0, 0.85, 0.42), // seat
    box(MATS.bikeFrame, 0.5, 0.05, 0.05, 0, 0.9, -0.62), // handlebar
    box(MATS.bikeSeat, 0.08, 0.06, 0.08, -0.24, 0.9, -0.62),
    box(MATS.bikeSeat, 0.08, 0.06, 0.08, 0.24, 0.9, -0.62)
  );
  // Lie it across the lane, tipped over like it was dropped.
  bike.rotation.y = Math.PI / 2;
  bike.rotation.z = 0.9;
  bike.position.y = -0.05;
  g.add(bike);
  return g;
}

// An open road hole with hazard edging — jump it or fall in.
export function buildHole() {
  const g = new THREE.Group();
  g.add(box(MATS.holeDark, 1.5, 0.02, 1.7, 0, 0.035, 0));
  // Hazard-striped frame.
  const frame = [
    [1.7, 0.12, -0.88, 0],
    [1.7, 0.12, 0.88, 0],
  ];
  for (const [w, d, z] of frame) {
    g.add(box(MATS.hazard, w, 0.03, d, 0, 0.04, z));
  }
  for (const x of [-0.81, 0.81]) {
    g.add(box(MATS.hazard, 0.12, 0.03, 1.9, x, 0.04, 0));
  }
  // A leaning warning cone on the corner sells it.
  const cone = new THREE.Mesh(GEO.cone, MATS.coneOrange);
  cone.scale.setScalar(0.7);
  cone.position.set(0.75, 0.3, -1.05);
  cone.rotation.z = 0.35;
  g.add(cone);
  return g;
}

// A shipping container: a long corrugated box with a flat, ride-able top at
// y ≈ CONFIG.containerTop. Ollie onto it (off a kicker) and roll along.
export function buildContainer(length) {
  const g = new THREE.Group();
  const top = MATS_CONTAINER[Math.floor(Math.random() * MATS_CONTAINER.length)];
  const h = 2.0;
  const w = 1.9;
  g.add(box(top, w, h, length, 0, h / 2, 0));
  // Corrugated ribs down the long sides.
  const ribs = Math.max(2, Math.round(length / 0.7));
  for (let i = 0; i < ribs; i++) {
    const z = -length / 2 + 0.35 + (i / (ribs - 1)) * (length - 0.7);
    g.add(
      box(MATS.crateDark, w + 0.04, h * 0.86, 0.12, 0, h / 2, z),
    );
  }
  // Rails top and bottom, and end doors with vertical bars.
  g.add(
    box(MATS.crateDark, w + 0.08, 0.16, length + 0.06, 0, h - 0.08, 0),
    box(MATS.crateDark, w + 0.08, 0.16, length + 0.06, 0, 0.08, 0),
    box(MATS.containerDoor, w * 0.94, h * 0.9, 0.1, 0, h / 2, length / 2 + 0.02),
    box(MATS.crateDark, 0.1, h * 0.9, 0.12, 0, h / 2, length / 2 + 0.06),
  );
  return g;
}

// A kicker ramp: a wedge that rises toward the player's approach so rolling
// over it pops you into the air. Obstacles approach from -z toward +z, so the
// high lip faces +z (the near side).
export function buildKicker() {
  const g = new THREE.Group();
  const w = 1.7;
  const len = 1.4;
  const lip = 0.9;
  // Slanted top face (low at the far side, high at the near lip).
  const face = box(MATS.ramp, w, 0.14, len * 1.5, 0, lip / 2, 0);
  face.rotation.x = Math.atan2(lip, len);
  g.add(
    face,
    box(MATS.rampSide, w, lip, 0.16, 0, lip / 2, len / 2), // back wall under the lip
    box(MATS.rail, w, 0.08, 0.08, 0, lip + 0.02, len / 2), // coping at the lip
  );
  // Solid side triangles (approximated with two stacked boxes) sell the wedge.
  for (const x of [-w / 2, w / 2]) {
    g.add(box(MATS.rampSide, 0.06, lip * 0.6, len, x, lip * 0.3, 0));
  }
  return g;
}

export function buildCoin() {
  const coin = new THREE.Mesh(GEO.coin, MATS.coin);
  coin.rotation.x = Math.PI / 2; // face the camera, spin around world y
  const g = new THREE.Group();
  g.add(coin);
  return g;
}

// --------------------------------------------------------------- scenery ---
const BUILDING_MATS = [MATS.building, MATS.building2, MATS.building3];

export function buildBuilding(seed) {
  const g = new THREE.Group();
  const w = 4 + (seed % 3) * 1.5;
  const h = 5 + ((seed * 7) % 5) * 2;
  const d = 5 + ((seed * 3) % 3) * 2;
  const m = BUILDING_MATS[seed % BUILDING_MATS.length];
  g.add(box(m, w, h, d, 0, h / 2, 0));
  // Window strips crossed with mullions read as a lit grid at night.
  const strips = 2 + (seed % 3);
  for (let i = 1; i <= strips; i++) {
    g.add(box(MATS.windowDark, w * 0.8, 0.55, d + 0.06, 0, (h * i) / (strips + 1), 0));
  }
  const cols = 2 + ((seed * 5) % 3);
  for (let i = 1; i <= cols; i++) {
    g.add(box(m, 0.35, h * 0.9, d + 0.12, -w * 0.4 + (w * 0.8 * i) / (cols + 1), h * 0.45, 0));
  }
  // Roof parapet and a street door.
  g.add(
    box(MATS.roof, w + 0.3, 0.35, d + 0.3, 0, h + 0.12, 0),
    box(MATS.door, 1.0, 1.7, 0.15, 0, 0.85, d / 2 + 0.02)
  );
  return g;
}

export function buildTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(GEO.post, MATS.trunk);
  trunk.scale.set(1.6, 1.4, 1.6);
  trunk.position.y = 0.7;
  const crown = new THREE.Mesh(GEO.crown, MATS.tree);
  crown.scale.set(1, 1.1, 1);
  crown.position.y = 2.1;
  const crownTop = new THREE.Mesh(GEO.crown, MATS.treeLight);
  crownTop.scale.setScalar(0.55);
  crownTop.position.set(0.25, 2.9, 0.1);
  g.add(trunk, crown, crownTop);
  return g;
}

// ---- park scenery ----
export function buildRamp() {
  const g = new THREE.Group();
  // Quarter-pipe silhouette: slanted face against a platform.
  const face = box(MATS.ramp, 3.4, 0.18, 3.2, 0, 1.05, 0.55);
  face.rotation.x = -0.72;
  g.add(
    face,
    box(MATS.rampSide, 3.4, 2.1, 1.4, 0, 1.05, 1.9), // back block
    box(MATS.ramp, 3.6, 0.15, 1.5, 0, 2.15, 1.9), // top deck
    box(MATS.rail, 3.4, 0.07, 0.07, 0, 2.6, 1.3), // coping rail
    box(MATS.railPost, 0.08, 0.4, 0.08, -1.6, 2.4, 1.3),
    box(MATS.railPost, 0.08, 0.4, 0.08, 1.6, 2.4, 1.3)
  );
  return g;
}

export function buildFence(length = 8) {
  const g = new THREE.Group();
  g.add(
    box(MATS.fence, 0.08, 0.1, length, 0, 1.15, 0),
    box(MATS.fence, 0.08, 0.1, length, 0, 0.65, 0)
  );
  const posts = Math.max(2, Math.round(length / 2));
  for (let i = 0; i < posts; i++) {
    g.add(box(MATS.fence, 0.1, 1.3, 0.1, 0, 0.65, -length / 2 + (i / (posts - 1)) * length));
  }
  return g;
}

export function buildBench() {
  const g = new THREE.Group();
  g.add(
    box(MATS.bench, 0.6, 0.08, 2.0, 0, 0.55, 0),
    box(MATS.bench, 0.1, 0.5, 2.0, 0.32, 0.85, 0), // backrest
    box(MATS.lampPost, 0.08, 0.55, 0.1, -0.2, 0.27, -0.8),
    box(MATS.lampPost, 0.08, 0.55, 0.1, -0.2, 0.27, 0.8),
    box(MATS.lampPost, 0.08, 0.8, 0.1, 0.28, 0.4, -0.8),
    box(MATS.lampPost, 0.08, 0.8, 0.1, 0.28, 0.4, 0.8)
  );
  return g;
}

export function buildBush() {
  const g = new THREE.Group();
  const b1 = new THREE.Mesh(GEO.crown, MATS.bush);
  b1.scale.set(0.9, 0.6, 0.9);
  b1.position.y = 0.45;
  const b2 = new THREE.Mesh(GEO.crown, MATS.tree);
  b2.scale.set(0.55, 0.45, 0.55);
  b2.position.set(0.6, 0.35, 0.3);
  g.add(b1, b2);
  return g;
}

// ---- subway scenery ----
// Tall tiled wall section hugging the track, with a glowing light strip.
export function buildTunnelWall(side) {
  const g = new THREE.Group();
  g.add(
    box(MATS.tunnelWall, 0.6, 5.2, 14, 0, 2.6, 0),
    box(MATS.tunnelTile, 0.15, 1.6, 14, side * -0.35, 1.4, 0), // tile band
    box(MATS.lamp, 0.12, 0.25, 12, side * -0.38, 3.4, 0) // light strip
  );
  for (const z of [-5.5, 0, 5.5]) {
    g.add(box(MATS.pillar, 0.9, 5.4, 0.7, 0, 2.7, z));
  }
  return g;
}

// Overhead beam spanning the track — repeated, it reads as a tunnel roof.
export function buildTunnelArch() {
  const g = new THREE.Group();
  g.add(
    box(MATS.pillar, 0.8, 5.0, 0.8, -6.6, 2.5, 0),
    box(MATS.pillar, 0.8, 5.0, 0.8, 6.6, 2.5, 0),
    box(MATS.tunnelWall, 14.4, 0.7, 1.6, 0, 5.2, 0),
    box(MATS.lamp, 3.0, 0.12, 0.4, 0, 4.8, 0) // ceiling light
  );
  return g;
}

export function buildStreetlight() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(GEO.post, MATS.lampPost);
  post.scale.set(0.9, 4.4, 0.9);
  post.position.y = 2.2;
  const arm = box(MATS.lampPost, 0.1, 0.1, 1.4, 0, 4.35, -0.6);
  const lampHead = new THREE.Mesh(GEO.lampHead, MATS.lamp);
  lampHead.scale.set(1.4, 0.8, 1.4);
  lampHead.position.set(0, 4.25, -1.25);
  g.add(post, arm, lampHead);
  return g;
}
