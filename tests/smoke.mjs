import { CONFIG } from '../src/config.js';
import * as meshes from '../src/meshes.js';
import { ChunkManager } from '../src/chunks.js';
import { CoinManager } from '../src/coins.js';
import { Player } from '../src/player.js';
import { checkCollisions } from '../src/collision.js';

import * as THREE from 'three';
import { World } from '../src/world.js';

const scene = { add() {}, remove() {} };

// 0. Level grid: 12 levels, increasing distances, all fields present.
if (CONFIG.levels.length !== 12) throw new Error(`expected 12 levels, got ${CONFIG.levels.length}`);
let prev = -1;
for (const lv of CONFIG.levels) {
  if (lv.distance <= prev) throw new Error(`level distances not increasing at ${lv.name}`);
  prev = lv.distance;
  for (const k of ['sky', 'ground', 'sunIntensity', 'fogNear', 'scenery', 'banned'])
    if (lv[k] === undefined) throw new Error(`level ${lv.name} missing ${k}`);
}
console.log('level grid OK:', CONFIG.levels.map((l) => `${l.name}@${l.distance}`).join(', '));

// 0b. World builds all scenery pools and switches themes without errors.
const world = new World(new THREE.Scene());
for (const lv of CONFIG.levels) {
  world.setTheme(lv);
  world.update(1 / 60, 20);
}
console.log('world theme/location switching OK');

// 1. Every mesh builder runs.
for (const [name, fn] of Object.entries(meshes)) {
  if (typeof fn !== 'function') continue;
  const out = name === 'buildRail' || name === 'buildFence' ? fn(14) : fn(1);
  if (!out) throw new Error(`${name} returned nothing`);
}
console.log('mesh builders OK');

// 1b. Banned types never spawn (subway bans cars and bikes).
{
  const cm = new ChunkManager(scene, new CoinManager(scene));
  cm.setBanned(['car', 'bike']);
  cm.reset();
  for (let i = 0; i < 2000; i++) cm.update(1 / 60, 30, 5000);
  const types = new Set(cm.active.map((m) => m.userData.collider.type));
  if (types.has('car') || types.has('bike'))
    throw new Error(`banned type spawned: ${[...types]}`);
  console.log('banned filtering OK, spawned types:', [...types].join(', '));
}

// 2. Chunk manager spawns patterns for all levels without errors, and every
// spawned obstacle has a valid collider.
const coins = new CoinManager(scene);
const chunks = new ChunkManager(scene, coins);
for (const dist of [0, 400, 1000, 2000]) {
  chunks.reset();
  for (let i = 0; i < 300; i++) chunks.update(1 / 60, 30, dist);
  for (const m of chunks.active) {
    const c = m.userData.collider;
    if (!c || !Number.isFinite(c.halfDepth) || !Number.isFinite(c.x))
      throw new Error(`bad collider at dist ${dist}: ${JSON.stringify(c)}`);
  }
  console.log(`chunks OK at distance ${dist}, tier ${chunks.currentTier(dist)}, active ${chunks.active.length}`);
}

// 3. Player: jump → trick completes mid-air → event fires.
const p = new Player(scene);
p.jump();
p.tryTrick('kickflip') || (() => { throw new Error('trick rejected in air') })();
for (let i = 0; i < 60; i++) p.update(1 / 60);
if (p.airborne) throw new Error('still airborne after full jump arc');
const evs = p.popEvents();
if (!evs.some((e) => e.type === 'trick' && e.name === 'kickflip'))
  throw new Error(`no trick event: ${JSON.stringify(evs)}`);
if (p.tryTrick('shuvit')) throw new Error('trick allowed on the ground');
console.log('air trick OK');

// 4. Grind: enter, balance drifts, no input → balanceBail eventually.
p.reset();
const fakeRail = {
  position: { x: 0, y: 0, z: -5 },
  userData: { collider: { type: 'rail', band: 'rail', lane: 1, x: 0, top: CONFIG.railTop, clearance: 0, halfDepth: 7 } },
};
p.enterGrind(fakeRail);
let bailed = false;
for (let i = 0; i < 600 && !bailed; i++) {
  p.update(1 / 60);
  bailed = p.popEvents().some((e) => e.type === 'balanceBail');
}
if (!bailed) throw new Error('balance never tipped without input');
console.log('balance bail OK');

// 5. Grind survives with corrective input.
p.reset();
p.enterGrind(fakeRail);
let survived = 0;
for (let i = 0; i < 240; i++) {
  if (Math.abs(p.balance) > 0.4) p.moveLane(-Math.sign(p.balance));
  p.update(1 / 60);
  if (p.popEvents().some((e) => e.type === 'balanceBail')) break;
  survived = i;
}
if (survived < 230) throw new Error(`bailed too early with input: ${survived} frames`);
console.log('balance correction OK');

// 6. Hole collision: on ground = hit, airborne = safe.
const hole = {
  position: { x: 0, y: 0, z: 0 },
  userData: { collider: { type: 'hole', band: 'gap', lane: 1, x: 0, top: 0, clearance: 0, halfDepth: 0.75 } },
};
p.reset();
if (checkCollisions(p, [hole])?.kind !== 'hit') throw new Error('hole did not hit grounded player');
p.y = 1.2; p.airborne = true;
if (checkCollisions(p, [hole])) throw new Error('hole hit airborne player');
console.log('hole collision OK');

console.log('ALL SMOKE TESTS PASSED');
