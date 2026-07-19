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
    ground: 0x74747c, // worn asphalt (vertex gradient adds gutter/oil shading)
    sidewalk: 0xa8a298,
    banned: [], // obstacle types that never spawn here
  },
  {
    name: 'PARK',
    scenery: 'park',
    ground: 0x84868c, // smoother park tarmac
    sidewalk: 0x6fae4e, // grass edges
    banned: ['car'], // no traffic in a skatepark
  },
  {
    name: 'SUBWAY',
    scenery: 'subway',
    ground: 0x4e4e56, // dark tunnel concrete
    sidewalk: 0x8a8578, // platform concrete
    banned: ['car', 'bike'],
    fogScale: 0.72, // tighter fog sells the tunnel
    skyDim: 0.35, // only a sliver of light from above
    lightScale: 0.75,
    alwaysLamps: true, // tunnel lights burn in every daylight phase
  },
];

export const scaleHex = (hex, f) => {
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

// Selectable skater presets. Each recolors the procedural skater's body,
// head, and legs independently (see meshes.buildSkater / player.applyPalette).
const CHARACTERS = [
  { name: 'CLASSIC', colors: { skin: 0xe0ac69, shirt: 0x2e86de, sleeve: 0x1b6ec2, pants: 0x2d3436, cap: 0xd63031, hair: 0x3a2a1a, shoe: 0xf5f0e6 } },
  { name: 'MELLOW', colors: { skin: 0xc68642, shirt: 0x27ae60, sleeve: 0x1e8449, pants: 0x34495e, cap: 0xf39c12, hair: 0x141414, shoe: 0xecf0f1 } },
  { name: 'VIBE', colors: { skin: 0xffcc99, shirt: 0x8e44ad, sleeve: 0x6c3483, pants: 0x2c3e50, cap: 0x1abc9c, hair: 0x2a1a0a, shoe: 0x2c3e50 } },
  { name: 'GNARLY', colors: { skin: 0x8d5524, shirt: 0xe67e22, sleeve: 0xd35400, pants: 0x17202a, cap: 0xecf0f1, hair: 0x111111, shoe: 0x111111 } },
];

// ---------------------------------------------------------------- parts ---
// The Skate Lab sells gear per RIDE TYPE — the top-level category. A
// skateboard is mechanical (deck/wheels/trucks/spinners); a hoverboard is
// electromagnetic (deck/thrusters/mag-locks/flux core) — no wheels to spin.
// Slots map onto the same stat keys so gameplay code stays ride-agnostic.
// `stats` apply in CASUAL play; RANKED normalizes to 1 (fair pot board).

// Skate decks: scoreMul. WOOD free, others earnable with bearings.
const SKATE_DECKS = [
  { id: 'deck-wood', name: 'WOOD', ride: 'skate', deck: 0x6c3f18, cost: 0, stats: { scoreMul: 1.0 } },
  { id: 'deck-fire', name: 'FIRE', ride: 'skate', deck: 0xc0392b, cost: 120, stats: { scoreMul: 1.1 } },
  { id: 'deck-aqua', name: 'AQUA', ride: 'skate', deck: 0x16a085, cost: 120, stats: { scoreMul: 1.1 } },
  { id: 'deck-gold', name: 'GOLD', ride: 'skate', deck: 0xf1c40f, cost: 300, stats: { scoreMul: 1.25 } },
];

// Hover decks: the premium tier (planned: a second "gold" currency later).
const HOVER_DECKS = [
  { id: 'deck-neon', name: 'NEON', ride: 'hover', deck: 0x1c2733, glow: 0x2ee6ff, cost: 500, stats: { scoreMul: 1.15 } },
  { id: 'deck-plasma', name: 'PLASMA', ride: 'hover', deck: 0x2a1633, glow: 0xff3df2, cost: 500, stats: { scoreMul: 1.15 } },
  { id: 'deck-volt', name: 'VOLT', ride: 'hover', deck: 0x14290f, glow: 0x8aff3d, cost: 700, stats: { scoreMul: 1.2 } },
];

// Wheels → speedMul + the powerslide axis: slideBrakeMul (how hard a
// powerslide scrubs speed — higher = stronger brake) and slideLenMul (how
// long the slide holds). Many near-variants on purpose: each maps to a
// future NFT part (plan: parts live on-chain per player, small stat/cosmetic
// differences make a wide collectible catalog).
const WHEELS = [
  { id: 'wheels-street', name: 'STREET', cost: 0, stats: { speedMul: 1.0 }, cosmetic: { color: 0xf5f0e6, radius: 0.09 } },
  { id: 'wheels-race', name: 'RACE', cost: 150, stats: { speedMul: 1.12 }, cosmetic: { color: 0x2d3436, radius: 0.085 } },
  { id: 'wheels-turbo', name: 'TURBO', cost: 400, stats: { speedMul: 1.25 }, cosmetic: { color: 0x2ee6ff, radius: 0.1 } },
  { id: 'wheels-griptide', name: 'GRIPTIDE', cost: 200, stats: { speedMul: 1.05, slideBrakeMul: 1.3 }, cosmetic: { color: 0xe8641b, radius: 0.088 } },
  { id: 'wheels-anchor', name: 'ANCHOR', cost: 250, stats: { slideBrakeMul: 1.45 }, cosmetic: { color: 0x8d0f0f, radius: 0.095 } },
  { id: 'wheels-drifter', name: 'DRIFTER', cost: 200, stats: { speedMul: 1.05, slideLenMul: 1.35 }, cosmetic: { color: 0xf1c40f, radius: 0.09 } },
  { id: 'wheels-longhaul', name: 'LONGHAUL', cost: 300, stats: { slideLenMul: 1.5, slideBrakeMul: 0.85 }, cosmetic: { color: 0x27ae60, radius: 0.098 } },
  { id: 'wheels-ghost', name: 'GHOST', cost: 450, stats: { speedMul: 1.18, slideLenMul: 1.2 }, cosmetic: { color: 0xd7dde3, radius: 0.082 } },
];

// Trucks → handlingMul + balanceMul (grind drift resist).
const TRUCKS = [
  { id: 'trucks-basic', name: 'BASIC', cost: 0, stats: { handlingMul: 1.0, balanceMul: 1.0 }, cosmetic: { color: 0x95a5a6 } },
  { id: 'trucks-pro', name: 'PRO', cost: 150, stats: { handlingMul: 1.15, balanceMul: 1.1 }, cosmetic: { color: 0xd4af37 } },
  { id: 'trucks-elite', name: 'ELITE', cost: 400, stats: { handlingMul: 1.3, balanceMul: 1.25 }, cosmetic: { color: 0xb0c4de } },
];

// Spinners (bearings) → trickSpeedMul (<1 = faster spins) + trickScoreMul.
const SPINNERS = [
  { id: 'spin-basic', name: 'BASIC', cost: 0, stats: { trickSpeedMul: 1.0, trickScoreMul: 1.0 }, cosmetic: { color: 0x40342a } },
  { id: 'spin-fast', name: 'FAST', cost: 150, stats: { trickSpeedMul: 0.85, trickScoreMul: 1.15 }, cosmetic: { color: 0xe67e22 } },
  { id: 'spin-hyper', name: 'HYPER', cost: 400, stats: { trickSpeedMul: 0.7, trickScoreMul: 1.35 }, cosmetic: { color: 0xff3df2 } },
];

// Hover thrusters → speedMul. cosmetic recolors/resizes the exhaust jets.
const THRUSTERS = [
  { id: 'thr-ion', name: 'ION DRIVE', cost: 0, stats: { speedMul: 1.0 }, cosmetic: { color: 0x2ee6ff, size: 1 } },
  { id: 'thr-pulse', name: 'PULSE JET', cost: 150, stats: { speedMul: 1.12 }, cosmetic: { color: 0xff3df2, size: 1.3 } },
  { id: 'thr-plasma', name: 'PLASMA VECTOR', cost: 400, stats: { speedMul: 1.25 }, cosmetic: { color: 0x8aff3d, size: 1.6 } },
];

// Mag-locks → handlingMul + balanceMul (the magnet that grips rails).
const MAGLOCKS = [
  { id: 'mag-ferrite', name: 'FERRITE', cost: 0, stats: { handlingMul: 1.0, balanceMul: 1.0 }, cosmetic: { color: 0x95a5a6 } },
  { id: 'mag-neo', name: 'NEODYM', cost: 150, stats: { handlingMul: 1.15, balanceMul: 1.1 }, cosmetic: { color: 0xd4af37 } },
  { id: 'mag-quantum', name: 'QUANTUM LOCK', cost: 400, stats: { handlingMul: 1.3, balanceMul: 1.25 }, cosmetic: { color: 0x9db4ff } },
];

// Flux cores → trickSpeedMul + trickScoreMul (spin tech).
const FLUXCORES = [
  { id: 'flux-stock', name: 'STOCK CORE', cost: 0, stats: { trickSpeedMul: 1.0, trickScoreMul: 1.0 }, cosmetic: { color: 0x40342a } },
  { id: 'flux-over', name: 'OVERDRIVE', cost: 150, stats: { trickSpeedMul: 0.85, trickScoreMul: 1.15 }, cosmetic: { color: 0xe67e22 } },
  { id: 'flux-sing', name: 'SINGULARITY', cost: 400, stats: { trickSpeedMul: 0.7, trickScoreMul: 1.35 }, cosmetic: { color: 0xff3df2 } },
];

// Outfit overrides — SHIRT / PANTS / CAP painted over the character preset.
// index 0 = keep the preset's own color. Free cosmetics (future NFT paints).
const preset = { id: 'preset', name: 'PRESET', color: null };
export const OUTFITS = {
  shirt: [
    preset,
    { id: 'shirt-white', name: 'WHITE', color: 0xf2f2f2 },
    { id: 'shirt-black', name: 'BLACK', color: 0x1d1f24 },
    { id: 'shirt-red', name: 'RED', color: 0xc0392b },
    { id: 'shirt-royal', name: 'ROYAL', color: 0x2e5fde },
    { id: 'shirt-lime', name: 'LIME', color: 0x76c93d },
    { id: 'shirt-grape', name: 'GRAPE', color: 0x8e44ad },
  ],
  pants: [
    preset,
    { id: 'pants-black', name: 'BLACK', color: 0x17181c },
    { id: 'pants-denim', name: 'DENIM', color: 0x3a5a86 },
    { id: 'pants-khaki', name: 'KHAKI', color: 0xa4906c },
    { id: 'pants-white', name: 'WHITE', color: 0xe6e6e2 },
    { id: 'pants-red', name: 'RED', color: 0x8d2318 },
  ],
  cap: [
    preset,
    { id: 'cap-black', name: 'BLACK', color: 0x17181c },
    { id: 'cap-red', name: 'RED', color: 0xd63031 },
    { id: 'cap-cyan', name: 'CYAN', color: 0x2ee6ff },
    { id: 'cap-gold', name: 'GOLD', color: 0xf1c40f },
    { id: 'cap-pink', name: 'PINK', color: 0xff3df2 },
    { id: 'cap-forest', name: 'FOREST', color: 0x1e8449 },
  ],
  // Chest logo/brand — rendered to a CanvasTexture at runtime (no image
  // files). Emoji glyphs or the SKATEHIVE wordmark; future sponsor NFTs.
  brand: [
    { id: 'brand-none', name: 'NONE', logo: null },
    { id: 'brand-hive', name: 'HIVE', logo: '🐝' },
    { id: 'brand-volt', name: 'VOLT', logo: '⚡' },
    { id: 'brand-bones', name: 'BONES', logo: '💀' },
    { id: 'brand-heat', name: 'HEAT', logo: '🔥' },
    { id: 'brand-aloha', name: 'ALOHA', logo: '🤙' },
    { id: 'brand-wordmark', name: 'SKATEHIVE', logo: 'SKATEHIVE' },
  ],
};
export const OUTFIT_SLOTS = ['shirt', 'pants', 'cap', 'brand'];

// Stance: goofy mirrors the skater and (true to skating) swaps which foot
// leads — so kickflip and heelflip trade inputs.
export const STANCES = ['regular', 'goofy'];

// Skills: trick unlocks + style passives, bought in the Lab like gear.
// KICKFLIP is the free starter skill; devUnlockAll opens everything.
export const SKILLS = [
  { id: 'skill-kickflip', name: 'KICKFLIP', desc: 'unlock flip tricks', cost: 0, unlocks: 'kickflip' },
  { id: 'skill-heelflip', name: 'HEELFLIP', desc: 'unlock heel tricks', cost: 200, unlocks: 'heelflip' },
  { id: 'skill-shuvit', name: '360 SHUVIT', desc: 'unlock the fast-combo shuvit', cost: 350, unlocks: 'shuvit' },
  { id: 'skill-swag', name: 'SWAG', desc: '+10% trick payout (casual)', cost: 400, passive: 'swag' },
];

export const RIDES = ['skate', 'hover'];
const PARTS = {
  skate: { deck: SKATE_DECKS, wheels: WHEELS, trucks: TRUCKS, spinners: SPINNERS },
  hover: { deck: HOVER_DECKS, thrusters: THRUSTERS, maglocks: MAGLOCKS, fluxcore: FLUXCORES },
};
export const RIDE_SLOTS = {
  skate: ['deck', 'wheels', 'trucks', 'spinners'],
  hover: ['deck', 'thrusters', 'maglocks', 'fluxcore'],
};

// Starter loadout: one free skate setup, plus a default hover setup for when
// the ride type is switched.
export const DEFAULT_LOADOUT = {
  ride: 'skate',
  skate: { deck: 'deck-wood', wheels: 'wheels-street', trucks: 'trucks-basic', spinners: 'spin-basic' },
  hover: { deck: 'deck-neon', thrusters: 'thr-ion', maglocks: 'mag-ferrite', fluxcore: 'flux-stock' },
};

// Neutral stat baseline; also exactly what RANKED mode uses.
const BASE_STATS = {
  speedMul: 1, handlingMul: 1, balanceMul: 1, scoreMul: 1, trickSpeedMul: 1, trickScoreMul: 1,
  slideBrakeMul: 1, slideLenMul: 1,
};

export function partById(ride, slot, id) {
  const list = PARTS[ride][slot];
  return list.find((p) => p.id === id) ?? list[0];
}

// Resolve the ACTIVE ride's loadout into effective stat multipliers.
// RANKED returns the neutral baseline (cosmetics still apply elsewhere).
export function computeStats(loadout, mode) {
  const stats = { ...BASE_STATS };
  if (mode === 'ranked') return stats;
  const ride = loadout.ride ?? 'skate';
  for (const slot of RIDE_SLOTS[ride]) {
    const part = partById(ride, slot, loadout[ride][slot]);
    for (const [k, v] of Object.entries(part.stats ?? {})) stats[k] = v;
  }
  return stats;
}

export const CONFIG = Object.freeze({
  // Lanes (x positions). Player runs at z = 0, world scrolls toward +z.
  lanes: [-2, 0, 2],

  // Cosmetics (character + board selection, saved to localStorage).
  characters: CHARACTERS,
  outfits: OUTFITS, // shirt/pants/cap/brand overrides painted over the preset
  stances: STANCES,
  skills: SKILLS,
  boards: [...SKATE_DECKS, ...HOVER_DECKS], // flat list for the select screen
  parts: PARTS, // per-ride catalogs (see RIDE_SLOTS)

  // Store economy: fraction of every purchase routed to the weekly pot.
  potCutPct: 0.2,
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
  // Popping off a rail mid-grind, or ollieing from an elevated surface
  // (container/rooftop — a "second level" jump), gets extra pop.
  highJumpVelocity: 11.5,
  gravity: 26,
  slideDuration: 0.65,
  // Momentum: powerslides scrub speed (sideways friction), grinds build it
  // (pumping the rail) — risk pays, safety costs. Both ease in fast and
  // recover gradually toward normal pace.
  slideDrag: 0.78, // speed multiplier target while powersliding
  grindBoost: 1.18, // speed multiplier target while grinding
  speedModEase: 6, // per-second ease rate into a slide/grind modifier
  speedRecoverEase: 1.6, // per-second ease rate back to full speed
  playerVisualScale: 0.75, // render scale of the skater (compact view); physics unchanged
  playerHeight: 1.4, // standing collider top (matches the scaled visual)
  slideHeight: 0.72, // sliding collider top
  playerDepth: 0.8, // z extent used for collision (already shrunk to feel fair)

  // Verticality: kicker ramps launch you onto shipping-container tops for a
  // second level of height you can roll along.
  // containerTop must be ollie-able: jump apex is jumpVelocity²/2g ≈ 1.56, so
  // with landMargin an ollie (or a kicker) both land the top.
  containerTop: 1.5, // ride height on top of a container
  containerLength: 12, // z extent — long enough to land on at any speed and ride
  kickerLaunch: 9.5, // upward velocity a kicker pops you with (clears containerTop)
  landMargin: 0.35, // feet-below-top slack: within this you land, below it you hit the side
  platformScoreRate: 30, // bonus points/second while riding a raised platform

  // ---- Underground prototype: rooftop routes + boost ----
  // Elevated skyway slabs you launch onto at forks; the street runs beneath.
  roofTop: 6, // rooftop ride height
  roofSlabBottom: 4.6, // slab underside — street players pass under freely
  megaRampLaunch: 18.5, // street → rooftop launch velocity (apex ≈ 6.6)
  roofRampLaunch: 10.5, // roof-edge ramp: gap jump clears at min speed, lands within the next slab at max
  routeRoofChunks: 4, // how many chunks a rooftop route lasts
  forkEvery: 5, // street chunks between route forks

  // Boost = energy drinks ⚡. The meter counts drinks (0..boostMax): grab
  // drink cans on the road for +1, or earn sips from tricks and grinding.
  // Burning one drink = one speed surge.
  boostMax: 3, // drinks you can carry
  boostChargeTrick: 0.34, // ~3 tricks brew one drink
  boostChargeGrind: 0.1, // drink-per-second while grinding
  boostCost: 1, // one drink per burn
  boostDuration: 2.2, // seconds of surge per drink
  boostSpeedMul: 1.55, // speed multiplier while surging

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
  // The last three are hoverboard-only (same inputs, remapped by hoverTrickFor).
  tricks: {
    kickflip: { score: 40, label: 'KICKFLIP' },
    heelflip: { score: 40, label: 'HEELFLIP' },
    shuvit: { score: 60, label: '360 SHUVIT' },
    hoverspin: { score: 90, label: '720 HOVERSPIN' },
    gravflip: { score: 110, label: 'GRAVITY FLIP' },
    neondash: { score: 80, label: 'NEON DASH' },
  },
  // On a hoverboard the classic trick inputs trigger the futuristic set.
  hoverTrickFor: { kickflip: 'hoverspin', heelflip: 'gravflip', shuvit: 'neondash' },
  trickDuration: 0.42, // seconds the board spin takes; must finish before landing
  trickIntoGrindBonus: 80, // landing a trick straight onto a rail

  // Hoverboard feel
  hoverHeight: 0.32, // visual float above the surface while grounded
  hoverBobAmp: 0.06,
  hoverBobFreq: 3.2,
  hoverGlideGravity: 0.42, // gravity multiplier while falling with jump held
  hoverGrindSnapWindow: 0.85, // magnet-lock: wider than the skate snap window
  hoverBalanceDrift: 0.5, // magnet-grind balance drifts at half speed

  // Spawning
  spawnHorizon: 130, // chunks are generated out to -spawnHorizon
  recycleLine: 14, // objects past +recycleLine go back to their pool
  chunkLength: 30,
  chunkLeadIn: 6, // obstacle-free z at the start of every chunk (seam safety)

  // Scoring
  distanceScoreRate: 1.5, // points per unit travelled
  coinValue: 10, // per blue can

  // Powerups (and one power-DOWN — the red oil can, dodge it). Weighted
  // random pick when a pattern spawns one; durations in seconds.
  powerups: {
    magnet: { dur: 6, label: '🧲 BEARING MAGNET!', weight: 3 },
    shield: { dur: 10, label: '🛡 SHIELD!', weight: 3 },
    score2: { dur: 7, label: '⭐ DOUBLE SCORE!', weight: 3 },
    oil: { dur: 3.5, label: '🛢 OIL SLICK!', weight: 2 },
    drink: { dur: 0, label: '⚡ ENERGY DRINK +1', weight: 4 }, // instant: +1 boost charge
  },
  oilDrag: 0.68, // speed multiplier while slicked

  // Continues: coins bank across runs (localStorage wallet); a continue costs
  // coins and doubles in price with each use within the same run.
  continueBaseCost: 15,
  continueCostGrowth: 2,

  // Dev: every part free/unlocked for playtesting the skate lab. Flip to
  // false to restore the coin economy (costs + ownership gating).
  devUnlockAll: true,

  // Dev: start runs at this level (1-based) instead of level 1. 0 = off.
  // Overridable per-session with a ?level=N URL param (e.g. localhost:5173/?level=9).
  devStartLevel: 0,

  // Camera — pulled back/up a touch for a compact view: the skater fills less
  // of the frame and more of the street and skyline reads.
  camHeight: 3.4,
  camBack: 7.0,
  camLookAhead: -10,
  fovBase: 65,
  fovMax: 73,

  // Colors (level 1 values; world.js lerps toward the active level theme)
  skyColor: 0x87ceeb,
  fogNear: 45,
  fogFar: 115,
  groundColor: 0x74747c,
  laneLineColor: 0xdadad2, // worn paint, not fresh white
  sidewalkColor: 0xa8a298,
});
