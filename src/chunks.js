// Track generation: hand-authored obstacle patterns picked by difficulty
// tier, spawned ahead of the player and recycled behind the camera.
//
// Pattern item coords: `z` is measured from the chunk's playable start
// (after the lead-in gap) and grows further away from the player.
// `lane` is 0 | 1 | 2. Every pattern must leave at least one survivable
// option per z-slice (a free lane, or a jumpable/slideable band).
import { CONFIG } from './config.js';
import { ObstaclePool } from './obstacles.js';

const PATTERNS = [
  // ---- Tier 1: single obstacles, gentle intro ----
  { tier: 1, items: [{ type: 'cone', lane: 1, z: 8 }] },
  { tier: 1, items: [{ type: 'cone', lane: 0, z: 4 }, { type: 'cone', lane: 2, z: 14 }] },
  {
    tier: 1,
    items: [{ type: 'barrier', lane: 1, z: 10 }],
    coins: [{ lane: 1, z: 10, count: 5, arc: true }],
  },
  { tier: 1, items: [], coins: [{ lane: 0, z: 4, count: 6 }] },
  {
    tier: 1,
    items: [{ type: 'rail', lane: 2, z: 12 }],
    coins: [{ lane: 2, z: 8, count: 6, y: 1.6 }],
  },
  {
    tier: 1,
    items: [{ type: 'sign', lane: 1, z: 10 }],
    coins: [{ lane: 1, z: 12, count: 4, y: 0.55 }],
  },

  // ---- Tier 2: paired lanes, forced actions ----
  {
    tier: 2,
    items: [
      { type: 'crate', lane: 0, z: 8 },
      { type: 'cone', lane: 1, z: 8 },
    ],
    coins: [{ lane: 2, z: 6, count: 5 }],
  },
  {
    tier: 2,
    items: [
      { type: 'barrier', lane: 0, z: 6 },
      { type: 'barrier', lane: 2, z: 6 },
      { type: 'cone', lane: 1, z: 16 },
    ],
    coins: [{ lane: 1, z: 6, count: 4 }],
  },
  {
    tier: 2,
    items: [
      { type: 'sign', lane: 0, z: 9 },
      { type: 'crate', lane: 2, z: 9 },
    ],
  },
  {
    tier: 2,
    items: [{ type: 'rail', lane: 1, z: 12 }],
    coins: [
      { lane: 1, z: 7, count: 7, y: 1.6 },
      { lane: 0, z: 18, count: 3 },
    ],
  },
  {
    tier: 2,
    items: [
      { type: 'crate', lane: 1, z: 7 },
      { type: 'barrier', lane: 0, z: 16 },
    ],
    coins: [{ lane: 2, z: 7, count: 5 }],
  },

  // ---- Tier 2: traffic shows up (cars & fallen bikes) ----
  {
    tier: 2,
    items: [
      { type: 'car', lane: 0, z: 9 },
      { type: 'bike', lane: 2, z: 9 },
    ],
    coins: [{ lane: 1, z: 7, count: 5 }],
  },
  {
    tier: 2,
    items: [{ type: 'bike', lane: 1, z: 8 }],
    coins: [{ lane: 1, z: 8, count: 5, arc: true }],
  },
  {
    tier: 2,
    items: [
      { type: 'car', lane: 1, z: 10 },
      { type: 'cone', lane: 0, z: 18 },
    ],
    coins: [{ lane: 2, z: 8, count: 5 }],
  },

  // ---- Tier 3: dense combos ----
  {
    tier: 3,
    items: [
      { type: 'crate', lane: 0, z: 6 },
      { type: 'crate', lane: 1, z: 6 },
      { type: 'barrier', lane: 2, z: 15 },
    ],
    coins: [{ lane: 2, z: 15, count: 5, arc: true }],
  },
  {
    tier: 3,
    items: [
      { type: 'sign', lane: 1, z: 5 },
      { type: 'crate', lane: 0, z: 12 },
      { type: 'cone', lane: 2, z: 18 },
    ],
  },
  {
    tier: 3,
    items: [
      { type: 'rail', lane: 0, z: 12 },
      { type: 'rail', lane: 2, z: 12 },
      { type: 'crate', lane: 1, z: 12 },
    ],
    coins: [
      { lane: 0, z: 7, count: 7, y: 1.6 },
      { lane: 2, z: 7, count: 7, y: 1.6 },
    ],
  },
  {
    tier: 3,
    items: [
      { type: 'barrier', lane: 0, z: 5 },
      { type: 'barrier', lane: 1, z: 10 },
      { type: 'barrier', lane: 2, z: 15 },
    ],
    coins: [{ lane: 1, z: 10, count: 5, arc: true }],
  },
  {
    tier: 3,
    items: [
      { type: 'crate', lane: 2, z: 6 },
      { type: 'sign', lane: 0, z: 6 },
      { type: 'crate', lane: 0, z: 16 },
    ],
    coins: [{ lane: 1, z: 11, count: 6 }],
  },

  // ---- Tier 3: holes open up ----
  {
    tier: 3,
    items: [
      { type: 'hole', lane: 1, z: 9 },
      { type: 'cone', lane: 0, z: 9 },
    ],
    coins: [{ lane: 1, z: 9, count: 5, arc: true }],
  },
  {
    tier: 3,
    items: [
      { type: 'car', lane: 0, z: 8 },
      { type: 'hole', lane: 2, z: 8 },
      { type: 'bike', lane: 1, z: 17 },
    ],
    coins: [{ lane: 1, z: 8, count: 4 }],
  },
  {
    tier: 3,
    items: [
      { type: 'rail', lane: 1, z: 12 },
      { type: 'hole', lane: 0, z: 12 },
      { type: 'hole', lane: 2, z: 12 },
    ],
    coins: [{ lane: 1, z: 7, count: 7, y: 1.6 }],
  },

  // ---- Tier 4: dawn rush — everything at once ----
  {
    tier: 4,
    items: [
      { type: 'hole', lane: 0, z: 5 },
      { type: 'hole', lane: 1, z: 9 },
      { type: 'hole', lane: 2, z: 13 },
    ],
    coins: [{ lane: 1, z: 9, count: 5, arc: true }],
  },
  {
    tier: 4,
    items: [
      { type: 'car', lane: 0, z: 8 },
      { type: 'car', lane: 2, z: 8 },
      { type: 'bike', lane: 1, z: 17 },
    ],
    coins: [{ lane: 1, z: 8, count: 5 }],
  },
  {
    tier: 4,
    items: [
      { type: 'car', lane: 1, z: 9 },
      { type: 'hole', lane: 0, z: 9 },
      { type: 'barrier', lane: 2, z: 17 },
    ],
    coins: [{ lane: 2, z: 17, count: 5, arc: true }],
  },
  {
    tier: 4,
    items: [
      { type: 'rail', lane: 2, z: 12 },
      { type: 'crate', lane: 0, z: 8 },
      { type: 'hole', lane: 1, z: 14 },
    ],
    coins: [{ lane: 2, z: 7, count: 7, y: 1.6 }],
  },
];

export class ChunkManager {
  constructor(scene, coins) {
    this.pool = new ObstaclePool(scene);
    this.coins = coins;
    this.active = []; // flat list of live obstacle meshes
    this.frontierZ = 0;
    this.lastPattern = -1;
    this.banned = []; // obstacle types the current location never spawns
    this.reset();
  }

  setBanned(types) {
    this.banned = types ?? [];
  }

  reset() {
    for (const mesh of this.active) this.pool.release(mesh);
    this.active.length = 0;
    // First chunk spawns well ahead so the run starts on open road.
    this.frontierZ = -35;
    this.fill(0);
  }

  currentTier(distance) {
    let tier = 1;
    for (let i = 0; i < CONFIG.levels.length; i++) {
      if (distance >= CONFIG.levels[i].distance) tier = i + 1;
    }
    return Math.min(tier, CONFIG.maxTier);
  }

  pickPattern(distance) {
    const tier = this.currentTier(distance);
    const eligible = PATTERNS.filter(
      (p) => p.tier <= tier && !p.items.some((it) => this.banned.includes(it.type))
    );
    let idx;
    do {
      idx = Math.floor(Math.random() * eligible.length);
    } while (eligible.length > 1 && idx === this.lastPattern);
    this.lastPattern = idx;
    return eligible[idx];
  }

  spawnChunk(distance) {
    const pattern = this.pickPattern(distance);
    const startZ = this.frontierZ - CONFIG.chunkLeadIn;
    for (const item of pattern.items) {
      this.active.push(this.pool.acquire(item.type, item.lane, startZ - item.z));
    }
    for (const c of pattern.coins ?? []) {
      this.coins.spawnRow(c.lane, startZ - c.z, c.count, { arc: c.arc, y: c.y });
    }
    this.frontierZ -= CONFIG.chunkLength;
  }

  fill(distance) {
    while (this.frontierZ > -CONFIG.spawnHorizon) this.spawnChunk(distance);
  }

  update(dt, speed, distance) {
    const dz = speed * dt;
    this.frontierZ += dz;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const mesh = this.active[i];
      mesh.position.z += dz;
      if (mesh.position.z - mesh.userData.collider.halfDepth > CONFIG.recycleLine) {
        this.pool.release(mesh);
        this.active.splice(i, 1);
      }
    }
    this.fill(distance);
  }
}
