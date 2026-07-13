// Obstacle type definitions, mesh pools, and collider data.
// Height bands: LOW = jumpable, FULL = must dodge, OVERHEAD = slide under,
// RAIL = grindable (never a direct hit), GAP = a hole — clear it in the air.
import { CONFIG } from './config.js';
import {
  buildCone, buildBarrier, buildCrate, buildSign, buildRail,
  buildCar, buildBike, buildHole,
} from './meshes.js';

export const BAND = {
  LOW: 'low',
  FULL: 'full',
  OVERHEAD: 'overhead',
  RAIL: 'rail',
  GAP: 'gap',
};

export const OBSTACLE_TYPES = {
  cone: { band: BAND.LOW, top: 0.78, depth: 0.6, build: buildCone },
  barrier: { band: BAND.LOW, top: 1.1, depth: 0.5, build: buildBarrier },
  crate: { band: BAND.FULL, top: 2.2, depth: 1.0, build: buildCrate },
  sign: { band: BAND.OVERHEAD, clearance: 1.35, depth: 0.4, build: buildSign },
  rail: { band: BAND.RAIL, top: CONFIG.railTop, depth: 14, build: () => buildRail(14) },
  car: { band: BAND.FULL, top: 1.6, depth: 3.6, build: buildCar },
  bike: { band: BAND.LOW, top: 0.9, depth: 0.9, build: buildBike },
  hole: { band: BAND.GAP, top: 0, depth: 1.5, build: buildHole },
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
