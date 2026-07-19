// Obstacle type definitions, mesh pools, and collider data.
// Height bands: LOW = jumpable, FULL = must dodge, OVERHEAD = slide under,
// RAIL = grindable (never a direct hit), GAP = a hole — clear it in the air,
// PLATFORM = solid side but landable top (ride along it), KICKER = launch pad.
import { CONFIG } from './config.js';
import {
  buildCone, buildBarrier, buildCrate, buildSign, buildRail,
  buildCar, buildBike, buildHole, buildContainer, buildKicker,
  buildRoofSlab, buildMegaRamp, buildRoofRamp, buildForkSign,
} from './meshes.js';

export const BAND = {
  LOW: 'low',
  FULL: 'full',
  OVERHEAD: 'overhead',
  RAIL: 'rail',
  GAP: 'gap',
  PLATFORM: 'platform',
  KICKER: 'kicker',
  FORK: 'fork', // route-choice trigger line (underground mode)
};

// Dodge obstacles render at this scale (compact view); their collider tops/
// depths below are pre-scaled to match. Interactive platforms (rails,
// containers, kickers) keep full size — their heights are physics-tuned.
const DODGE_SCALE = 0.85;

export const OBSTACLE_TYPES = {
  cone: { band: BAND.LOW, top: 0.66, depth: 0.5, meshScale: DODGE_SCALE, build: buildCone },
  barrier: { band: BAND.LOW, top: 0.94, depth: 0.43, meshScale: DODGE_SCALE, build: buildBarrier },
  crate: { band: BAND.FULL, top: 1.87, depth: 0.85, meshScale: DODGE_SCALE, build: buildCrate },
  sign: { band: BAND.OVERHEAD, clearance: 1.15, depth: 0.34, meshScale: DODGE_SCALE, build: buildSign },
  rail: { band: BAND.RAIL, top: CONFIG.railTop, depth: 14, build: () => buildRail(14) },
  // Marathon rail: much longer grind window for big balance scores.
  raillong: { band: BAND.RAIL, top: CONFIG.railTop, depth: 22, build: () => buildRail(22) },
  car: { band: BAND.FULL, top: 1.36, depth: 3.05, meshScale: DODGE_SCALE, build: buildCar },
  bike: { band: BAND.LOW, top: 0.77, depth: 0.77, meshScale: DODGE_SCALE, build: buildBike },
  hole: { band: BAND.GAP, top: 0, depth: 1.5, build: buildHole },
  container: {
    band: BAND.PLATFORM,
    top: CONFIG.containerTop,
    depth: CONFIG.containerLength,
    build: () => buildContainer(CONFIG.containerLength, CONFIG.containerTop),
  },
  kicker: { band: BAND.KICKER, top: 0.9, depth: 2.2, launch: CONFIG.kickerLaunch, build: buildKicker },

  // ---- Underground route pieces (full-width `wide` colliders) ----
  roof: {
    band: BAND.PLATFORM,
    top: CONFIG.roofTop,
    bottom: CONFIG.roofSlabBottom, // street passes underneath
    depth: 24, // fills a chunk's playable span
    wide: true,
    build: () => buildRoofSlab(24, CONFIG.roofTop, CONFIG.roofSlabBottom),
  },
  megaramp: {
    band: BAND.KICKER, top: 2.4, depth: 5, wide: true,
    launch: CONFIG.megaRampLaunch, build: buildMegaRamp,
  },
  rooframp: {
    band: BAND.KICKER, top: CONFIG.roofTop + 1.1, depth: 2.5, wide: true,
    baseY: CONFIG.roofTop, launch: CONFIG.roofRampLaunch,
    build: () => buildRoofRamp(CONFIG.roofTop),
  },
  fork: { band: BAND.FORK, top: 0, depth: 1, wide: true, build: buildForkSign },
};

export class ObstaclePool {
  constructor(scene) {
    this.scene = scene;
    this.free = new Map(); // type -> mesh[]
  }

  acquire(type, lane, z) {
    const def = OBSTACLE_TYPES[type];
    const list = this.free.get(type);
    let mesh = list && list.pop();
    if (!mesh) {
      mesh = def.build();
      if (def.meshScale) mesh.scale.setScalar(def.meshScale);
      this.scene.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(CONFIG.lanes[lane], 0, z);
    mesh.userData.collider = {
      type,
      band: def.band,
      lane,
      x: CONFIG.lanes[lane],
      top: def.top ?? 0,
      clearance: def.clearance ?? 0,
      halfDepth: def.depth / 2,
      launch: def.launch ?? 0,
      wide: def.wide ?? false,
      bottom: def.bottom ?? 0,
      baseY: def.baseY ?? 0,
    };
    return mesh;
  }

  release(mesh) {
    mesh.visible = false;
    const type = mesh.userData.collider.type;
    if (!this.free.has(type)) this.free.set(type, []);
    this.free.get(type).push(mesh);
  }
}
