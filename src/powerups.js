// Powerup pickups: weighted-random type per spawn point, pooled per type,
// spin + pickup checks. game.js applies the collected effects.
import { CONFIG } from './config.js';
import { buildPowerup } from './meshes.js';

const PICKUP_RADIUS_X = 1.0;
const PICKUP_RADIUS_Z = 0.9;
const PICKUP_RADIUS_Y = 1.3;
const FLOAT_Y = 0.85;

export class PowerupManager {
  constructor(scene) {
    this.scene = scene;
    this.free = new Map(); // type -> mesh[]
    this.active = []; // { mesh, type }
    this.spin = 0;
    // Weighted type table, built once from config.
    this.table = [];
    for (const [type, def] of Object.entries(CONFIG.powerups)) {
      for (let i = 0; i < def.weight; i++) this.table.push(type);
    }
  }

  spawn(lane, z) {
    const type = this.table[Math.floor(Math.random() * this.table.length)];
    const list = this.free.get(type);
    let mesh = list && list.pop();
    if (!mesh) {
      mesh = buildPowerup(type);
      this.scene.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(CONFIG.lanes[lane], FLOAT_Y, z);
    this.active.push({ mesh, type });
  }

  // Returns the types collected this frame.
  update(dt, speed, player) {
    this.spin += dt * 2.5;
    const collected = [];
    const dz = speed * dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const { mesh, type } = this.active[i];
      mesh.position.z += dz;
      mesh.rotation.y = this.spin;
      mesh.position.y = FLOAT_Y + Math.sin(this.spin * 1.7 + i) * 0.1; // bob
      if (mesh.position.z > CONFIG.recycleLine) {
        this.releaseAt(i);
        continue;
      }
      if (
        player &&
        Math.abs(mesh.position.z) < PICKUP_RADIUS_Z &&
        Math.abs(mesh.position.x - player.x) < PICKUP_RADIUS_X &&
        Math.abs(mesh.position.y - (player.y + 0.7)) < PICKUP_RADIUS_Y
      ) {
        collected.push(type);
        this.releaseAt(i);
      }
    }
    return collected;
  }

  releaseAt(index) {
    const { mesh, type } = this.active[index];
    mesh.visible = false;
    if (!this.free.has(type)) this.free.set(type, []);
    this.free.get(type).push(mesh);
    this.active.splice(index, 1);
  }

  reset() {
    while (this.active.length) this.releaseAt(this.active.length - 1);
  }
}
