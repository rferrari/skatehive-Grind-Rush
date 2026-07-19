// Pure collision resolution on the lane grid: lane proximity + z overlap +
// height band. Returns the first meaningful event for this frame:
//   { kind: 'hit' } | { kind: 'grind', mesh } | { kind: 'launch', power } |
//   { kind: 'fork' } | null
import { CONFIG } from './config.js';
import { BAND } from './obstacles.js';

const LANE_TOLERANCE = CONFIG.laneWidth * 0.6;
// Wide colliders (rooftop slabs, mega-ramps, fork triggers) span all lanes.
const WIDE_TOLERANCE = 3.9;
const tolFor = (c) => (c.wide ? WIDE_TOLERANCE : LANE_TOLERANCE);

export function checkCollisions(player, obstacles) {
  const playerHalfDepth = CONFIG.playerDepth / 2;

  for (const mesh of obstacles) {
    const c = mesh.userData.collider;
    const dz = Math.abs(mesh.position.z); // player is at z = 0
    if (dz > c.halfDepth + playerHalfDepth) continue;
    if (Math.abs(player.x - c.x) > tolFor(c)) continue;

    switch (c.band) {
      case BAND.RAIL: {
        if (player.grinding) break; // already on a rail
        // Per-ride snap distance: hoverboards magnet-lock from farther away.
        const snap = player.grindSnapWindow ?? CONFIG.grindSnapWindow;
        const nearTop = Math.abs(player.y - c.top) < snap;
        if (player.airborne && player.vy <= 0 && nearTop) {
          return { kind: 'grind', mesh };
        }
        break; // rails never cause a bail
      }
      case BAND.LOW:
        if (player.y < c.top - 0.05) return { kind: 'hit' };
        break;
      case BAND.OVERHEAD:
        if (player.topY > c.clearance) return { kind: 'hit' };
        break;
      case BAND.FULL:
        return { kind: 'hit' };
      case BAND.GAP:
        // A hole in the road: safe while airborne or grinding, deadly on it.
        if (player.y < 0.3) return { kind: 'hit' };
        break;
      case BAND.PLATFORM:
        // Landable top with a solid side. You only bonk the side coming DOWN
        // short in front of it (a fair "didn't make it"); while rising off a
        // kicker you pass up onto the top. Elevated slabs (bottom > 0) are
        // open underneath — a street-level player passes below untouched.
        if (
          player.vy <= 0 &&
          player.y < c.top - CONFIG.landMargin &&
          player.topY > (c.bottom ?? 0)
        ) {
          return { kind: 'hit' };
        }
        break;
      case BAND.KICKER:
        // Rolling over a kicker at ITS level pops you into the air (baseY
        // lets rooftop-edge ramps ignore players on the street below).
        if (
          !player.airborne &&
          !player.grinding &&
          Math.abs(player.y - (c.baseY ?? 0)) < 1
        ) {
          return { kind: 'launch', power: c.launch };
        }
        break;
      case BAND.FORK:
        // Route-choice trigger line; the game reads the player's lane and
        // debounces repeat hits while the trigger passes through.
        return { kind: 'fork' };
    }
  }
  return null;
}

// Continuous support height directly under the player: the highest landable
// platform top the player is over (lane + z footprint) and at/above of which
// their feet sit within a step tolerance, else 0 (ground). Lets the player
// roll along container tops instead of only ever resting at y = 0.
export function queryFloor(player, obstacles) {
  const playerHalfDepth = CONFIG.playerDepth / 2;
  let floor = 0;
  for (const mesh of obstacles) {
    const c = mesh.userData.collider;
    if (c.band !== BAND.PLATFORM) continue;
    if (Math.abs(mesh.position.z) > c.halfDepth + playerHalfDepth) continue;
    if (Math.abs(player.x - c.x) > tolFor(c)) continue;
    // Only support the player if they're at or above the top (within a small
    // step-up tolerance) — a lower player is beside/into the side, not on it.
    if (player.y >= c.top - CONFIG.landMargin && c.top > floor) floor = c.top;
  }
  return floor;
}
