// All gameplay tunables in one place. Distances are world units, times in seconds.

// Levels are generated as daylight phases × locations: the run tours every
// location (city → park → subway) in the morning, then repeats the whole
// tour at sunset, at night, and at dawn.
const DAYLIGHTS = [
  {
    name: 'MORNING',
    sky: 0x87ceeb,
    sunColor: 0xfff4e0,
    sunIntensity: 1.6,
    hemiIntensity: 1.0,
    fogNear: 45,
    fogFar: 115,
    groundLight: 1.0, // multiplies the location's ground/sidewalk colors
    windowGlow: 0x000000,
    lampGlow: 0x000000,
  },
  {
    name: 'SUNSET',
    sky: 0xf2955f,
    sunColor: 0xffb36b,
    sunIntensity: 1.4,
    hemiIntensity: 0.75,
    fogNear: 42,
    fogFar: 105,
    groundLight: 0.88,
    windowGlow: 0x332200,
    lampGlow: 0x000000,
  },
  {
    name: 'NIGHT',
    sky: 0x141b30,
    sunColor: 0x9db4ff,
    sunIntensity: 0.55,
    hemiIntensity: 0.35,
    fogNear: 34,
    fogFar: 90,
    groundLight: 0.55,
    windowGlow: 0xffc966,
    lampGlow: 0xffd98a,
  },
  {
    name: 'DAWN',
    sky: 0xc98bd9,
    sunColor: 0xffd0e8,
    sunIntensity: 1.2,
    hemiIntensity: 0.7,
    fogNear: 40,
    fogFar: 100,
    groundLight: 0.9,
    windowGlow: 0x221a00,
    lampGlow: 0x000000,
  },
];

const LOCATIONS = [
  {
    name: 'CITY',
    scenery: 'city',
    ground: 0x8d8d94,
    sidewalk: 0xb9b3a8,
    banned: [], // obstacle types that never spawn here
  },
  {
    name: 'PARK',
    scenery: 'park',
    ground: 0x97999e,
    sidewalk: 0x6fae4e, // grass edges
    banned: ['car'], // no traffic in a skatepark
  },
  {
    name: 'SUBWAY',
    scenery: 'subway',
    ground: 0x5c5c64,
    sidewalk: 0x8a8578, // platform concrete
    banned: ['car', 'bike'],
    fogScale: 0.72, // tighter fog sells the tunnel
    skyDim: 0.35, // only a sliver of light from above
    lightScale: 0.75,
    alwaysLamps: true, // tunnel lights burn in every daylight phase
  },
];

const scaleHex = (hex, f) => {
  const ch = (shift) => Math.min(255, Math.round(((hex >> shift) & 255) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

// Each level runs a bit longer than the last (250, 280, 310, ... units).
const LEVELS = [];
{
  let distance = 0;
  let length = 250;
  for (const day of DAYLIGHTS) {
    for (const loc of LOCATIONS) {
      LEVELS.push({
        name: `${loc.name} ${day.name}`,
        distance,
        scenery: loc.scenery,
        banned: loc.banned,
        sky: scaleHex(day.sky, loc.skyDim ?? 1),
        ground: scaleHex(loc.ground, day.groundLight),
        sidewalk: scaleHex(loc.sidewalk, day.groundLight),
        sunColor: day.sunColor,
        sunIntensity: day.sunIntensity * (loc.lightScale ?? 1),
        hemiIntensity: day.hemiIntensity * (loc.lightScale ?? 1),
        fogNear: day.fogNear * (loc.fogScale ?? 1),
        fogFar: day.fogFar * (loc.fogScale ?? 1),
        windowGlow: day.windowGlow,
        lampGlow: loc.alwaysLamps ? 0xffd98a : day.lampGlow,
      });
      distance += length;
      length += 30;
    }
  }
}

export const CONFIG = Object.freeze({
  // Lanes (x positions). Player runs at z = 0, world scrolls toward +z.
  lanes: [-2, 0, 2],
  laneWidth: 2,
  laneChangeTime: 0.16,

  // Speed / difficulty
  baseSpeed: 12,
  maxSpeed: 34,
  speedRamp: 0.012, // extra speed per unit of distance travelled
  levelSpeedBoost: 1.0, // flat speed added per level beyond the first

  // Generated above: 12 levels = 3 locations × 4 daylight phases.
  levels: LEVELS,
  maxTier: 4, // obstacle patterns cap out at this tier (by level number)

  // Player physics
  jumpVelocity: 9,
  gravity: 26,
  slideDuration: 0.65,
  playerHeight: 1.8, // standing collider top
  slideHeight: 0.9, // sliding collider top
  playerDepth: 0.8, // z extent used for collision (already shrunk to feel fair)

  // Grinding
  railTop: 0.9,
  grindSnapWindow: 0.55, // vertical window around rail top that snaps into a grind
  grindScoreRate: 25, // base points per second while grinding
  grindScoreRamp: 18, // extra points/s added for every second the grind lasts
  grindHopVelocity: 7,

  // Grind balance minigame: balance drifts, <-/-> pushes it back. Tip over = bail.
  balanceDriftMax: 1.1, // peak random drift force (per second)
  balanceNudge: 0.55, // how far one <-/-> press pushes the needle
  balanceGrace: 0.5, // seconds at the start of a grind before drift kicks in

  // Air tricks: trigger keys are handled in input.js, points and spin here.
  tricks: {
    kickflip: { score: 40, label: 'KICKFLIP' },
    heelflip: { score: 40, label: 'HEELFLIP' },
    shuvit: { score: 60, label: '360 SHUVIT' },
  },
  trickDuration: 0.42, // seconds the board spin takes; must finish before landing
  trickIntoGrindBonus: 80, // landing a trick straight onto a rail

  // Spawning
  spawnHorizon: 130, // chunks are generated out to -spawnHorizon
  recycleLine: 14, // objects past +recycleLine go back to their pool
  chunkLength: 30,
  chunkLeadIn: 6, // obstacle-free z at the start of every chunk (seam safety)

  // Scoring
  distanceScoreRate: 1.5, // points per unit travelled
  coinValue: 10,

  // Camera
  camHeight: 3.1,
  camBack: 6.2,
  camLookAhead: -9,
  fovBase: 65,
  fovMax: 73,

  // Colors (level 1 values; world.js lerps toward the active level theme)
  skyColor: 0x87ceeb,
  fogNear: 45,
  fogFar: 115,
  groundColor: 0x8d8d94,
  laneLineColor: 0xf2f2f2,
  sidewalkColor: 0xb9b3a8,
});
