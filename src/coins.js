// Coin pool: spawning rows/arcs, spin animation, and pickup checks.
import { CONFIG } from './config.js';
import { buildCoin } from './meshes.js';

const PICKUP_RADIUS_X = 0.9;
const PICKUP_RADIUS_Z = 0.8;
const PICKUP_RADIUS_Y = 1.1;

export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.free = [];
    this.active = [];
    this.spin = 0;
  }

  spawnRow(lane, zStart, count, { arc = false, y = 0.7 } = {}) {
    const spacing = 1.6;
    for (let i = 0; i < count; i++) {
      let coin = this.free.pop();
      if (!coin) {
        coin = buildCoin();
        this.scene.add(coin);
      }
      // Arc rows trace a jump parabola so coins reward an ollie.
      const t = count > 1 ? i / (count - 1) : 0.5;
      const coinY = arc ? y + Math.sin(t * Math.PI) * 1.6 : y;
      coin.position.set(CONFIG.lanes[lane], coinY, zStart - i * spacing);
      coin.visible = true;
      this.active.push(coin);
    }
  }

  // Move with the world, spin, check pickups. Returns number collected.
  update(dt, speed, player) {
    this.spin += dt * 4;
    let collected = 0;
    const dz = speed * dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const coin = this.active[i];
      coin.position.z += dz;
      coin.rotation.y = this.spin;
      if (coin.position.z > CONFIG.recycleLine) {
        this.releaseAt(i);
        continue;
      }
      if (
        player &&
        Math.abs(coin.position.z) < PICKUP_RADIUS_Z &&
        Math.abs(coin.position.x - player.x) < PICKUP_RADIUS_X &&
        Math.abs(coin.position.y - (player.y + 0.7)) < PICKUP_RADIUS_Y
      ) {
        collected++;
        this.releaseAt(i);
      }
    }
    return collected;
  }

  releaseAt(index) {
    const coin = this.active[index];
    coin.visible = false;
    this.free.push(coin);
    this.active.splice(index, 1);
  }

  reset() {
    while (this.active.length) this.releaseAt(this.active.length - 1);
  }
}
