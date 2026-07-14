import { CONFIG, computeStats, DEFAULT_LOADOUT } from '../src/config.js';
import { LocalLedger } from '../src/ledger.js';
import { PowerupManager } from '../src/powerups.js';
import * as meshes from '../src/meshes.js';
import { ChunkManager } from '../src/chunks.js';
import { CoinManager } from '../src/coins.js';
import { Player } from '../src/player.js';
import { checkCollisions, queryFloor } from '../src/collision.js';

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

// 7. Verticality: kicker launches a grounded player; ignored while airborne.
const kicker = {
  position: { x: 0, y: 0, z: 0 },
  userData: { collider: { type: 'kicker', band: 'kicker', lane: 1, x: 0, top: 0.9, clearance: 0, halfDepth: 0.7, launch: CONFIG.kickerLaunch } },
};
p.reset();
{
  const ev = checkCollisions(p, [kicker]);
  if (ev?.kind !== 'launch' || ev.power !== CONFIG.kickerLaunch)
    throw new Error(`kicker did not launch grounded player: ${JSON.stringify(ev)}`);
}
p.y = 1.0; p.vy = 5; p.airborne = true;
if (checkCollisions(p, [kicker])) throw new Error('kicker fired while airborne');
console.log('kicker launch OK');

// 8. Container: queryFloor supports a player above the top; land-on-top vs
// side-hit; riding then rolling off the end falls back to the ground.
const container = {
  position: { x: 0, y: 0, z: 0 },
  userData: { collider: { type: 'container', band: 'platform', lane: 1, x: 0, top: CONFIG.containerTop, clearance: 0, halfDepth: CONFIG.containerLength / 2 } },
};
p.reset();
// Descending onto the top → floor is the container top, and it's not a hit.
p.y = CONFIG.containerTop + 0.1; p.vy = -2; p.airborne = true;
if (queryFloor(p, [container]) !== CONFIG.containerTop)
  throw new Error('queryFloor did not report container top when overhead');
if (checkCollisions(p, [container])) throw new Error('clearing the top counted as a hit');
// Running into the side low (descending short) → hit.
p.reset();
if (checkCollisions(p, [container])?.kind !== 'hit')
  throw new Error('grounded run into container side did not hit');
// Rising off a kicker in front of the container → not a hit (pass up onto it).
p.reset(); p.y = 0.8; p.vy = 6; p.airborne = true;
if (checkCollisions(p, [container])) throw new Error('rising player bonked the container side');
// A player at ground level (below the top) is beside it, not on it → floor 0.
p.reset();
if (queryFloor(p, [container]) !== 0)
  throw new Error('grounded player below the top should not be supported by it');
console.log('container platform OK');

// 8a. A plain ollie can land on the container — the jump apex must clear the
// landing margin (regression: containerTop 2.0 was un-ollieable).
{
  const apex = CONFIG.jumpVelocity ** 2 / (2 * CONFIG.gravity);
  if (apex < CONFIG.containerTop - CONFIG.landMargin)
    throw new Error(`ollie apex ${apex.toFixed(2)} cannot reach container landing window`);
  p.reset();
  container.position.z = 0;
  p.jump();
  let landedTop = false;
  for (let i = 0; i < 120 && !landedTop; i++) {
    const floorY = queryFloor(p, [container]);
    p.update(1 / 60, floorY);
    const ev = checkCollisions(p, [container]);
    if (ev?.kind === 'hit') throw new Error('ollie onto container side-hit');
    if (!p.airborne && Math.abs(p.y - CONFIG.containerTop) < 1e-6) landedTop = true;
  }
  if (!landedTop) throw new Error('plain ollie never landed on the container top');
  console.log('ollie-onto-container OK');
}

// 8b. Ride then roll off: standing on the top stays put; once the container
// passes behind, the floor drops and the player steps off into a fall.
p.reset();
p.y = CONFIG.containerTop; p.vy = 0; p.airborne = false;
p.update(1 / 60, queryFloor(p, [container]));
if (p.airborne || Math.abs(p.y - CONFIG.containerTop) > 1e-6)
  throw new Error('player did not stay planted on the container top');
container.position.z = 20; // container now well behind the player
p.update(1 / 60, queryFloor(p, [container]));
if (!p.airborne) throw new Error('player did not step off the end of the container');
console.log('container ride/step-off OK');

// 9. Hoverboard: ride switch toggles gear; glide slows the fall; magnet grind
// widens the rail snap window and slows balance drift.
p.reset();
p.setRide('hover');
if (!p.parts.hoverGear.visible || p.parts.skateGear.visible)
  throw new Error('setRide(hover) did not swap board gear');
if (p.grindSnapWindow <= CONFIG.grindSnapWindow)
  throw new Error('hover grind snap window is not wider than skate');
// Glide: identical fall with jump held loses less height on a hoverboard.
const fallDrop = (ride, held) => {
  p.reset();
  p.setRide(ride);
  p.y = 3; p.vy = 0; p.airborne = true;
  for (let i = 0; i < 20; i++) p.update(1 / 60, 0, held);
  return 3 - p.y;
};
const glideDrop = fallDrop('hover', true);
const plainDrop = fallDrop('hover', false);
const skateDrop = fallDrop('skate', true); // held jump must NOT glide a skateboard
if (glideDrop >= plainDrop * 0.7) throw new Error(`glide too weak: ${glideDrop} vs ${plainDrop}`);
if (Math.abs(skateDrop - plainDrop) > 1e-9) throw new Error('skateboard glided');
// Hover tricks exist and map from the classic inputs.
for (const [from, to] of Object.entries(CONFIG.hoverTrickFor)) {
  if (!CONFIG.tricks[from] || !CONFIG.tricks[to])
    throw new Error(`hover trick mapping ${from}→${to} references unknown trick`);
}
// Magnet grind survives noticeably longer than skate with no input.
const framesUntilBail = (ride) => {
  p.reset();
  p.setRide(ride);
  p.enterGrind(fakeRail);
  for (let i = 0; i < 2000; i++) {
    p.update(1 / 60);
    if (p.popEvents().some((e) => e.type === 'balanceBail')) return i;
  }
  return 2000;
};
const skateFrames = framesUntilBail('skate');
const hoverFrames = framesUntilBail('hover');
if (hoverFrames <= skateFrames)
  throw new Error(`magnet grind not longer: hover ${hoverFrames} vs skate ${skateFrames}`);
p.setRide('skate');
console.log(`hoverboard OK (glide ${glideDrop.toFixed(2)} vs ${plainDrop.toFixed(2)} drop; grind ${hoverFrames} vs ${skateFrames} frames)`);

// 10. Economy: LocalLedger balances/ownership/equip/pot + persistence, and
// computeStats casual-vs-ranked. Uses a Map-backed storage shim.
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
{
  const store = memStorage();
  const led = new LocalLedger(store);
  if (led.getBalance() !== 0) throw new Error('fresh wallet not 0');
  if (!led.owns('deck', 'deck-wood')) throw new Error('starter deck not owned');
  if (led.owns('deck', 'deck-fire')) throw new Error('premium deck owned for free');

  await led.earn(100);
  let r = await led.buy('deck', 'deck-fire'); // costs 120
  if (r.ok || r.reason !== 'poor') throw new Error('bought deck-fire while too poor');
  await led.earn(50); // now 150
  r = await led.buy('deck', 'deck-fire');
  if (!r.ok || led.getBalance() !== 30) throw new Error(`buy math wrong: ${JSON.stringify(r)} bal ${led.getBalance()}`);
  if (Math.round(led.getPot()) !== Math.round(120 * CONFIG.potCutPct))
    throw new Error(`pot cut wrong: ${led.getPot()}`);
  if (!led.owns('deck', 'deck-fire')) throw new Error('bought deck not owned');
  if ((await led.buy('deck', 'deck-fire')).reason !== 'owned') throw new Error('re-bought owned deck');
  await led.equip('deck', 'deck-fire');
  if (led.getEquipped('deck') !== 'deck-fire') throw new Error('equip did not stick');
  if ((await led.equip('wheels', 'wheels-turbo')).ok) throw new Error('equipped an unowned part');

  // Persistence: a fresh ledger over the same storage restores state.
  const led2 = new LocalLedger(store);
  if (led2.getBalance() !== 30 || !led2.owns('deck', 'deck-fire') || led2.getEquipped('deck') !== 'deck-fire')
    throw new Error('ledger did not persist');
  console.log('ledger persistence OK');

  // computeStats: ranked normalizes to 1; casual reflects equipped parts.
  const ranked = computeStats({ ...DEFAULT_LOADOUT, deck: 'deck-fire' }, 'ranked');
  if (Object.values(ranked).some((v) => v !== 1)) throw new Error('ranked stats not normalized');
  const casual = computeStats({ ...DEFAULT_LOADOUT, deck: 'deck-fire', wheels: 'wheels-turbo' }, 'casual');
  if (casual.scoreMul !== 1.1 || casual.speedMul !== 1.25)
    throw new Error(`casual stats wrong: ${JSON.stringify(casual)}`);

  // Leaderboard: ranked runs recorded (top-first), casual ignored.
  const NOW = 1_700_000_000_000;
  await led.submitScore({ score: 50, mode: 'ranked', ts: NOW });
  await led.submitScore({ score: 90, mode: 'ranked', ts: NOW });
  await led.submitScore({ score: 999, mode: 'casual', ts: NOW });
  const board = led.getLeaderboard(NOW);
  if (board[0].score !== 90 || board.some((e) => e.score === 999))
    throw new Error(`leaderboard wrong: ${JSON.stringify(board)}`);
  console.log('economy (ledger + stats + leaderboard) OK');
}

// 11. Powerups: spawn from the weighted table, picked up in the player's
// lane, recycled behind the camera; magnet widens the can pickup window.
{
  const pm = new PowerupManager(scene);
  pm.spawn(1, -5);
  if (pm.active.length !== 1) throw new Error('powerup did not spawn');
  const type = pm.active[0].type;
  if (!(type in CONFIG.powerups)) throw new Error(`unknown powerup type ${type}`);
  // Drive it toward the player at lane 1 (x=0): should be collected near z=0.
  p.reset();
  let got = [];
  for (let i = 0; i < 120 && !got.length; i++) got = pm.update(1 / 60, 12, p);
  if (got[0] !== type) throw new Error('powerup not collected in lane');
  if (pm.active.length !== 0) throw new Error('collected powerup still active');
  // Recycle path: spawn in another lane and let it pass behind.
  pm.spawn(0, -5);
  for (let i = 0; i < 240; i++) pm.update(1 / 60, 12, p);
  if (pm.active.length !== 0) throw new Error('missed powerup never recycled');

  // Magnet: a can two lanes away is only collectible with magnet=true.
  const cm = new CoinManager(scene);
  cm.spawnRow(0, -3, 1); // lane 0 (x=-2), player at x=0
  p.reset();
  let picked = 0;
  for (let i = 0; i < 60 && !picked; i++) picked = cm.update(1 / 60, 12, p, false);
  if (picked) throw new Error('off-lane can collected without magnet');
  cm.reset();
  cm.spawnRow(0, -3, 1);
  for (let i = 0; i < 60 && !picked; i++) picked = cm.update(1 / 60, 12, p, true);
  if (!picked) throw new Error('magnet did not vacuum the off-lane can');
  console.log('powerups + magnet OK');
}

console.log('ALL SMOKE TESTS PASSED');
