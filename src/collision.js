// Pure collision resolution on the lane grid: lane proximity + z overlap +
// height band. Returns the first meaningful event for this frame:
//   { kind: 'hit' } | { kind: 'grind', mesh } | null
import { CONFIG } from './config.js';
import { BAND } from './obstacles.js';

const LANE_TOLERANCE = CONFIG.laneWidth * 0.6;

export function checkCollisions(player, obstacles) {
  const playerHalfDepth = CONFIG.playerDepth / 2;

  for (const mesh of obstacles) {
    const c = mesh.userData.collider;
    const dz = Math.abs(mesh.position.z); // player is at z = 0
    if (dz > c.halfDepth + playerHalfDepth) continue;
    if (Math.abs(player.x - c.x) > LANE_TOLERANCE) continue;

    switch (c.band) {
      case BAND.RAIL: {
        if (player.grinding) break; // already on a rail
        const nearTop = Math.abs(player.y - c.top) < CONFIG.grindSnapWindow;
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
    }
  }
  return null;
}
