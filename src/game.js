// Game orchestration: state machine (menu / playing / gameover), the
// per-frame update pipeline, speed ramp, scoring and camera follow.
import { CONFIG, computeStats, partById, RIDES, RIDE_SLOTS, OUTFIT_SLOTS, SKILLS, scaleHex } from './config.js';
import { LocalLedger } from './ledger.js';
import { Player } from './player.js';
import { World } from './world.js';
import { CoinManager } from './coins.js';
import { PowerupManager } from './powerups.js';
import { ChunkManager } from './chunks.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { AudioManager } from './audio.js';
import { checkCollisions, queryFloor } from './collision.js';

const RESTART_LOCKOUT = 0.7; // seconds before game-over screen accepts input
const LOADING_DURATION = 1.6; // seconds the loading bar takes to fill

// Cosmetic-selection persistence (clamped so a shrunk preset list can't break).
function loadIndex(key, count) {
  const v = Number(localStorage.getItem(key));
  return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
}
function saveIndex(key, value) {
  localStorage.setItem(key, String(value));
}

// Dev shortcut: start runs at a later level via CONFIG.devStartLevel or a
// ?level=N URL param (URL wins), so testing tier-4 content doesn't require
// replaying the whole run. Returns the starting distance.
function devStartDistance() {
  let level = CONFIG.devStartLevel;
  if (typeof location !== 'undefined') {
    const p = Number(new URLSearchParams(location.search).get('level'));
    if (Number.isInteger(p) && p > 0) level = p;
  }
  if (!level) return 0;
  const idx = Math.min(level, CONFIG.levels.length) - 1;
  return CONFIG.levels[idx].distance;
}

export class Game {
  constructor(scene, camera) {
    this.camera = camera;
    this.world = new World(scene);
    this.player = new Player(scene);
    this.coins = new CoinManager(scene);
    this.powerups = new PowerupManager(scene);
    this.chunks = new ChunkManager(scene, this.coins, this.powerups);
    this.input = new Input();
    this.hud = new Hud();
    this.audio = new AudioManager();
    this.ledger = new LocalLedger(); // coins, ownership, loadout, pot, leaderboard

    this.state = 'loading';
    this.stateTime = 0;
    this.loadingT = 0;
    this.previewSpin = 0;
    this.score = 0;
    this.coinCount = 0;
    this.distance = 0;
    this.speed = 0;
    this.level = 1;
    this.lastAirDir = 0;
    this.lastAirDirTime = -1;
    this.speedMod = 1; // eases toward slideDrag while sliding, grindBoost while grinding
    this.effects = { magnet: 0, shield: 0, score2: 0, oil: 0 }; // seconds remaining
    this.invuln = 0; // post-shield grace so the saved hit can't re-trigger
    this.boost = 0; // nitro meter 0..1, charged by tricks + grinds
    this.boostT = 0; // seconds of active surge remaining
    this.forkCooldown = 0; // debounce for fork trigger overlap
    this.camX = 0;
    this.camY = CONFIG.camHeight; // smoothed height-follow (must be seeded: the
    // loading/preview camera returns early, so an unset camY would go NaN and
    // blank the screen on the first run-camera frame)
    this.camZoom = 0; // smoothed big-air zoom-out (0..1), seeded for the same reason

    // Character is a free cosmetic (kept as an index); the deck/wheels/trucks/
    // spinners loadout lives in the ledger.
    this.charIndex = loadIndex('skatehive-character', CONFIG.characters.length);
    // Outfit overrides (0 = keep the preset color), persisted per slot.
    this.outfit = {};
    for (const slot of OUTFIT_SLOTS) {
      this.outfit[slot] = loadIndex(`skatehive-${slot}`, CONFIG.outfits[slot].length);
    }
    // Skills (trick unlocks + passives) and stance. KICKFLIP is the free
    // starter skill; devUnlockAll opens the whole tree.
    let savedSkills = [];
    try { savedSkills = JSON.parse(localStorage.getItem('skatehive-skills')) ?? []; } catch { /* fresh */ }
    this.skills = new Set(['skill-kickflip', ...savedSkills.filter((id) => SKILLS.some((s) => s.id === id))]);
    this.stance = localStorage.getItem('skatehive-stance') === 'goofy' ? 'goofy' : 'regular';
    this.mode = 'casual'; // 'casual' | 'ranked'
    this.pending = null; // Skate Lab staged changes (set while the Lab is open)
    this.applySelection();

    this.continuesUsed = 0;
    this.startDistance = devStartDistance();

    this.hud.showLoading(0);
    this.updateCamera(0);
  }

  // Lab / give-up → start screen: a clean title over the scrolling
  // city, no skater. A bailed skater gets back up (board re-attached) first.
  goToMenu() {
    if (this.player.bailing) this.player.reset();
    // Leaving the Lab: back outside, discard staged changes.
    this.world.setShopMode(false);
    this.chunks.setHidden(false);
    this.coins.setHidden(false);
    this.powerups.setHidden(false);
    if (this.pending) {
      this.pending = null;
      this.applySelection();
    }
    this.player.group.rotation.y = 0;
    this.player.setVisible(false);
    this.state = 'menu';
    this.stateTime = 0;
    this.hud.showMenu(this.ledger.getBalance());
  }

  // How-to-play: same clean background as the menu, info overlay on top.
  goToHowto() {
    this.state = 'howto';
    this.stateTime = 0;
    this.hud.showHowto();
  }

  // Open the Skate Lab: selections are STAGED into `pending` (live 3D + stat
  // preview) and only committed — and charged — by checkout(). Leaving via
  // BACK discards the staged changes.
  goToStore() {
    this.player.setVisible(true);
    this.previewSpin = 0;
    // Step inside the shop: gray room replaces the street; hide any frozen
    // obstacles/pickups that would be standing around the preview.
    this.world.setShopMode(true);
    this.chunks.setHidden(true);
    this.coins.setHidden(true);
    this.powerups.setHidden(true);
    this.pending = { loadout: this.ledger.getLoadout(), charIndex: this.charIndex, outfit: { ...this.outfit }, skills: new Set(this.skills), stance: this.stance };
    this.state = 'store';
    this.stateTime = 0;
    this.hud.showStore(this.storeState());
  }

  // Staged parts + skills not yet owned, with their total price.
  _cart() {
    const pend = this.pending;
    const loadout = pend?.loadout ?? this.ledger.getLoadout();
    let total = 0;
    const items = [];
    for (const ride of RIDES) {
      for (const slot of RIDE_SLOTS[ride]) {
        const id = loadout[ride][slot];
        if (!this.ledger.owns(ride, slot, id)) {
          const part = partById(ride, slot, id);
          items.push({ kind: 'part', ride, slot, id, cost: part.cost });
          total += part.cost;
        }
      }
    }
    if (pend?.skills) {
      for (const skill of SKILLS) {
        if (pend.skills.has(skill.id) && !this.skills.has(skill.id) && !this.ledger.unlockAll) {
          items.push({ kind: 'skill', id: skill.id, cost: skill.cost });
          total += skill.cost;
        }
      }
    }
    return { items, total };
  }

  // Snapshot for the Skate Lab UI: staged loadout + ownership + stat bars +
  // cart total for the checkout button.
  storeState() {
    const pend = this.pending ?? { loadout: this.ledger.getLoadout(), charIndex: this.charIndex, outfit: { ...this.outfit }, skills: new Set(this.skills), stance: this.stance };
    const { loadout, charIndex, outfit, skills, stance } = pend;
    const owned = {};
    for (const ride of RIDES) {
      owned[ride] = {};
      for (const slot of RIDE_SLOTS[ride]) {
        owned[ride][slot] = CONFIG.parts[ride][slot].map((p) => this.ledger.owns(ride, slot, p.id));
      }
    }
    const cart = this._cart();
    return {
      balance: this.ledger.getBalance(),
      pot: this.ledger.getPot(),
      ride: loadout.ride,
      equipped: loadout,
      owned,
      charIndex,
      outfit,
      stance,
      // Per-skill status for the UI: owned (committed) vs staged (in cart).
      skills: SKILLS.map((s) => ({
        id: s.id,
        owned: this.ledger.unlockAll || this.skills.has(s.id),
        staged: skills.has(s.id),
      })),
      stats: computeStats(loadout, 'casual'),
      free: this.ledger.unlockAll,
      cartTotal: cart.total,
      canAfford: cart.total <= this.ledger.getBalance(),
    };
  }

  // Commit the staged configuration: buy anything unowned (pre-checked
  // against the wallet), switch ride, equip every staged slot, save the
  // character. Returns the fresh state for the UI.
  async checkout() {
    if (!this.pending) return this.storeState();
    const { loadout, charIndex, outfit, skills, stance } = this.pending;
    const cart = this._cart();
    if (!this.ledger.unlockAll && cart.total > this.ledger.getBalance()) {
      this.hud.showToast('NOT ENOUGH ⚙️');
      return this.storeState();
    }
    for (const item of cart.items) {
      if (item.kind === 'skill') await this.ledger.charge(item.cost, `skill ${item.id}`);
      else await this.ledger.buy(item.ride, item.slot, item.id);
    }
    await this.ledger.setRide(loadout.ride);
    for (const ride of RIDES) {
      for (const slot of RIDE_SLOTS[ride]) {
        await this.ledger.equip(ride, slot, loadout[ride][slot]);
      }
    }
    this.selectCharacter(charIndex);
    this.outfit = { ...outfit };
    for (const slot of OUTFIT_SLOTS) saveIndex(`skatehive-${slot}`, this.outfit[slot]);
    this.skills = new Set(skills);
    localStorage.setItem('skatehive-skills', JSON.stringify([...this.skills]));
    this.stance = stance;
    localStorage.setItem('skatehive-stance', this.stance);
    this.applySelection();
    this.pending = { loadout: this.ledger.getLoadout(), charIndex: this.charIndex, outfit: { ...this.outfit }, skills: new Set(this.skills), stance: this.stance };
    this.hud.showToast('✔ GEAR APPLIED');
    return this.storeState();
  }

  // Repaint the skater from character colors + a loadout (defaults to the
  // ledger's equipped state; the Skate Lab passes its staged preview instead).
  applySelection(loadout = this.ledger.getLoadout(), charIndex = this.charIndex, outfit = this.outfit) {
    const ride = loadout.ride;
    const ld = loadout[ride];
    const deck = partById(ride, 'deck', ld.deck);
    const palette = {
      ...CONFIG.characters[charIndex].colors,
      deck: deck.deck,
      ...(deck.glow !== undefined && { glow: deck.glow }),
    };
    // Outfit overrides paint over the preset (sleeve tracks the shirt).
    const shirt = CONFIG.outfits.shirt[outfit.shirt]?.color;
    if (shirt != null) {
      palette.shirt = shirt;
      palette.sleeve = scaleHex(shirt, 0.78);
    }
    const pants = CONFIG.outfits.pants[outfit.pants]?.color;
    if (pants != null) palette.pants = pants;
    const cap = CONFIG.outfits.cap[outfit.cap]?.color;
    if (cap != null) palette.cap = cap;
    this.player.applyBrand(CONFIG.outfits.brand[outfit.brand] ?? null);
    this.player.setStance(this.pending?.stance ?? this.stance);
    this.player.applyPalette(palette);
    this.player.setRide(ride);
    // Slots 1 and 2 of each ride carry the visible accessory cosmetics
    // (wheels/trucks or thrusters/mag-locks).
    const [, slotA, slotB] = RIDE_SLOTS[ride];
    this.player.applyLoadoutCosmetics(
      ride,
      partById(ride, slotA, ld[slotA]),
      partById(ride, slotB, ld[slotB])
    );
  }

  // Resolve a base trick input through stance and ride: goofy leads with the
  // other foot (kick/heel swap), hoverboards fire the futuristic set.
  trickFor(name) {
    let base = name;
    const stance = this.pending?.stance ?? this.stance;
    if (stance === 'goofy') {
      if (base === 'kickflip') base = 'heelflip';
      else if (base === 'heelflip') base = 'kickflip';
    }
    return this.player.isHover ? CONFIG.hoverTrickFor[base] ?? base : base;
  }

  // Is the skill gating this base trick unlocked?
  skillUnlocked(base) {
    const skill = SKILLS.find((s) => s.unlocks === base);
    return !skill || this.ledger.unlockAll || this.skills.has(skill.id);
  }

  // Try a base trick input, honoring skill unlocks + stance + ride mapping.
  attemptTrick(base, replace = false) {
    if (!this.skillUnlocked(base)) return false;
    return this.player.tryTrick(this.trickFor(base), replace);
  }

  selectCharacter(i) {
    this.charIndex = ((i % CONFIG.characters.length) + CONFIG.characters.length) % CONFIG.characters.length;
    saveIndex('skatehive-character', this.charIndex);
    this.applySelection();
  }

  // Lab tap: STAGE the change (nothing is bought or persisted until
  // checkout). 'ride' switches category, 'character' swaps the preset,
  // anything else slots a part into the staged loadout for its ride.
  async storeSelect(slot, id) {
    if (!this.pending) this.pending = { loadout: this.ledger.getLoadout(), charIndex: this.charIndex, outfit: { ...this.outfit }, skills: new Set(this.skills), stance: this.stance };
    const pend = this.pending;
    if (slot === 'ride') pend.loadout.ride = id;
    else if (slot === 'character') pend.charIndex = id;
    else if (slot === 'stance') pend.stance = id;
    else if (slot === 'skill') {
      // Stage a skill purchase; tapping an un-committed staged skill un-stages it.
      if (pend.skills.has(id) && !this.skills.has(id)) pend.skills.delete(id);
      else pend.skills.add(id);
    } else if (OUTFIT_SLOTS.includes(slot)) pend.outfit[slot] = id;
    else pend.loadout[pend.loadout.ride][slot] = id;
    this.applySelection(pend.loadout, pend.charIndex, pend.outfit); // live 3D preview
    return this.storeState();
  }

  get currentSpeed() {
    return (
      Math.min(
        CONFIG.maxSpeed,
        CONFIG.baseSpeed +
          this.distance * CONFIG.speedRamp +
          (this.level - 1) * CONFIG.levelSpeedBoost
      ) * this.player.stats.speedMul
    );
  }

  currentLevel() {
    let level = 1;
    for (let i = 0; i < CONFIG.levels.length; i++) {
      if (this.distance >= CONFIG.levels[i].distance) level = i + 1;
    }
    return level;
  }

  startRun(mode = 'casual') {
    // First run is a user gesture — unlock audio + start the music playlist.
    this.audio.resume();
    this.audio.playMusic();
    this.prevAirborne = false;
    this.mode = mode;
    // Loadout stats apply in casual; ranked normalizes them (fair pot board).
    this.player.stats = computeStats(this.ledger.getLoadout(), mode);
    // SWAG passive: style pays better — casual only, like all paid stats.
    if (mode === 'casual' && (this.ledger.unlockAll || this.skills.has('skill-swag'))) {
      this.player.stats.trickScoreMul *= 1.1;
    }
    this.player.reset();
    this.player.setVisible(true);
    this.coins.reset();
    this.powerups.reset();
    this.chunks.reset();
    this.score = 0;
    this.coinCount = 0;
    this.distance = this.startDistance; // 0 unless dev level-start is active
    this.continuesUsed = 0;
    this.level = this.currentLevel();
    this.lastAirDir = 0;
    this.speedMod = 1;
    this.effects = { magnet: 0, shield: 0, score2: 0, oil: 0 };
    this.invuln = 0;
    this.boost = 0;
    this.boostT = 0;
    this.forkCooldown = 0;
    const theme = CONFIG.levels[this.level - 1];
    this.world.setTheme(theme);
    this.chunks.setBanned(theme.banned);
    this.hud.hideOverlays();
    this.hud.update(0, 0, this.player, this.level);
    this.state = 'playing';
    this.stateTime = 0;
  }

  // Spend banked coins to resume the run where it ended: same score, distance
  // and level, with the road ahead cleared for a fair restart.
  get continueCost() {
    return CONFIG.continueBaseCost * CONFIG.continueCostGrowth ** this.continuesUsed;
  }

  async continueRun() {
    if (this.state !== 'gameover') return;
    const paid = await this.ledger.spend(this.continueCost, 'continue');
    if (!paid.ok) return;
    this.continuesUsed++;
    this.player.reset(); // un-bails and reattaches the board
    this.chunks.reset(); // clear the field — open road on respawn
    this.coins.reset();
    this.powerups.reset();
    this.effects = { magnet: 0, shield: 0, score2: 0, oil: 0 };
    this.invuln = 0;
    this.coinCount = 0; // this run's coins were already banked at the bail
    this.hud.hideOverlays();
    this.hud.update(this.score, 0, this.player, this.level);
    this.state = 'playing';
    this.stateTime = 0;
  }

  gameOver() {
    this.player.bail(this.speed);
    this.audio.sfx('bail');
    this.audio.update(0, { rolling: false, speedT: 0, grinding: false, balance: 0 }); // kill loops
    const finalScore = Math.floor(this.score);
    // Bank this run's coins; record ranked runs on the (local) leaderboard.
    this.ledger.earn(this.coinCount, 'run');
    this.ledger.submitScore({ score: finalScore, mode: this.mode, ts: Date.now() });
    this.coinCount = 0;
    const prev = this.hud.loadHighScore();
    const isRecord = finalScore > prev;
    if (isRecord) this.hud.saveHighScore(finalScore);
    this.hud.showGameOver(finalScore, Math.max(prev, finalScore), isRecord, {
      wallet: this.ledger.getBalance(),
      cost: this.continueCost,
      pot: this.ledger.getPot(),
      leaderboard: this.ledger.getLeaderboard(),
      mode: this.mode,
    });
    this.hud.update(this.score, 0, null, this.level);
    this.state = 'gameover';
    this.stateTime = 0;
  }

  update(dt) {
    this.stateTime += dt;
    const actions = this.input.poll();

    switch (this.state) {
      case 'loading':
        this.world.update(dt, 4);
        this.player.update(dt);
        this.loadingT += dt;
        this.hud.showLoading(Math.min(1, this.loadingT / LOADING_DURATION));
        if (this.loadingT >= LOADING_DURATION) this.goToMenu(); // straight to play
        break;

      case 'store':
        // Inside the shop room: no street scroll, just the turntable.
        this.player.update(dt);
        this.previewSpin += dt * 0.7;
        this.player.group.rotation.y = this.previewSpin;
        break;

      case 'menu':
        this.world.update(dt, 5); // slow scroll behind the title (no skater)
        if (actions.includes('start')) this.startRun('casual');
        break;

      case 'howto':
        this.world.update(dt, 5); // keep the city rolling behind the info
        break;

      case 'playing':
        this.updatePlaying(dt, actions);
        break;

      case 'gameover':
        this.player.update(dt); // bail animation plays out
        if (this.stateTime > RESTART_LOCKOUT && actions.includes('start')) {
          this.startRun(this.mode); // retry in the same mode
        }
        break;
    }

    this.updateCamera(dt);
  }

  // Motion tricks: a sideways input in the air is a heelflip (the lane still
  // changes); tapping the opposite direction within the combo window
  // upgrades it to a 360 shuvit.
  airMotion(dir) {
    const p = this.player;
    if (!p.airborne || p.grinding || p.bailing) return;
    const now = this.stateTime;
    if (this.lastAirDir === -dir && now - this.lastAirDirTime < 0.3) {
      this.attemptTrick('shuvit', true);
      this.lastAirDir = 0;
      return;
    }
    this.attemptTrick('heelflip');
    this.lastAirDir = dir;
    this.lastAirDirTime = now;
  }

  updatePlaying(dt, actions) {
    // Tick down active powerup effects, shield grace, boost surge, fork debounce.
    for (const k in this.effects) this.effects[k] = Math.max(0, this.effects[k] - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.forkCooldown = Math.max(0, this.forkCooldown - dt);

    // Momentum: powerslides scrub speed, grinds pump it up, and either eases
    // back to normal pace afterwards — risk pays, safety costs. An oil slick
    // drags you down; a burning boost overrides everything.
    // Wheels tune the powerslide: slideBrakeMul > 1 scrubs harder.
    let modTarget = this.player.sliding
      ? Math.max(0.5, CONFIG.slideDrag / this.player.stats.slideBrakeMul)
      : this.player.grinding
        ? CONFIG.grindBoost
        : 1;
    if (this.effects.oil > 0) modTarget = Math.min(modTarget, CONFIG.oilDrag);
    if (this.boostT > 0) modTarget = CONFIG.boostSpeedMul;
    const ease = modTarget !== 1 ? CONFIG.speedModEase : CONFIG.speedRecoverEase;
    this.speedMod += (modTarget - this.speedMod) * Math.min(1, ease * dt);
    this.speed = this.currentSpeed * this.speedMod;
    this.distance += this.speed * dt;

    // Level up: retheme the world, flash the toast, bump the speed.
    const level = this.currentLevel();
    if (level !== this.level) {
      this.level = level;
      const theme = CONFIG.levels[level - 1];
      this.world.setTheme(theme);
      this.chunks.setBanned(theme.banned);
      this.hud.showToast(`LEVEL ${level} — ${theme.name}`);
    }

    for (const action of actions) {
      if (action === 'left' || action === 'right') {
        const dir = action === 'left' ? -1 : 1;
        this.player.moveLane(dir);
        this.airMotion(dir);
      } else if (action === 'jump') {
        // Second jump input while already in the air = kickflip (or hoverspin).
        if (this.player.airborne && !this.player.grinding) {
          this.attemptTrick('kickflip');
        } else if (!this.player.airborne) {
          this.player.jump();
          this.audio.sfx('ollie');
        } else this.player.jump();
      } else if (action === 'slide') {
        this.player.slide();
      } else if (action === 'boost') {
        // Burn a stored segment for a speed surge (skate nitro).
        if (this.boostT <= 0 && this.boost >= CONFIG.boostCost) {
          this.boost -= CONFIG.boostCost;
          this.boostT = CONFIG.boostDuration;
          this.audio.sfx('boost');
          this.hud.showTrick('🔥 BOOST!');
        }
      } else if (action in CONFIG.tricks) {
        this.attemptTrick(action); // Z/X/C shortcuts still work
      }
    }

    // Support height under the player (0 = ground, container top when riding).
    const floorY = queryFloor(this.player, this.chunks.active);
    this.player.update(dt, floorY, this.input.jumpHeld());
    this.world.update(dt, this.speed);
    this.chunks.update(dt, this.speed, this.distance);
    // Land detection: airborne → grounded this frame (roll/roof/container).
    if (this.prevAirborne && !this.player.airborne && !this.player.grinding) {
      this.audio.sfx('land');
    }
    this.prevAirborne = this.player.airborne;

    const x2 = this.effects.score2 > 0 ? 2 : 1; // ⭐ double-score window
    const picked = this.coins.update(dt, this.speed, this.player, this.effects.magnet > 0);
    if (picked) {
      this.coinCount += picked;
      this.score += picked * CONFIG.coinValue * x2;
      this.audio.sfx('bearing');
    }

    // Powerup pickups: energy drinks add a boost charge instantly; the rest
    // start (or refresh) their effect timers.
    for (const type of this.powerups.update(dt, this.speed, this.player)) {
      if (type === 'drink') {
        this.boost = Math.min(CONFIG.boostMax, this.boost + 1);
        this.audio.sfx('bearing');
      } else {
        this.effects[type] = CONFIG.powerups[type].dur;
      }
      this.hud.showToast(CONFIG.powerups[type].label);
    }

    // Player-generated events: landed tricks, combos, balance falls. Spinner
    // parts boost trick payouts (trickScoreMul).
    const trickMul = this.player.stats.trickScoreMul * x2;
    for (const ev of this.player.popEvents()) {
      if (ev.type === 'trick') {
        const def = CONFIG.tricks[ev.name];
        const pts = Math.round(def.score * trickMul);
        this.score += pts;
        this.boost = Math.min(CONFIG.boostMax, this.boost + CONFIG.boostChargeTrick); // tricks feed the nitro
        this.audio.sfx('trick');
        this.hud.showTrick(`${def.label} +${pts}`);
      } else if (ev.type === 'trickIntoGrind') {
        const pts = Math.round(CONFIG.trickIntoGrindBonus * trickMul);
        this.score += pts;
        this.hud.showTrick(`TRICK INTO GRIND +${pts}`);
      } else if (ev.type === 'balanceBail') {
        this.gameOver();
        return;
      }
    }

    const event = checkCollisions(this.player, this.chunks.active);
    if (event?.kind === 'hit' && this.invuln <= 0) {
      // A shield eats one crash instead of ending the run; the grace window
      // lets the saved player pass through the obstacle they just hit.
      if (this.effects.shield > 0) {
        this.effects.shield = 0;
        this.invuln = 1.2;
        this.hud.showToast('🛡 SHIELD SAVED YOU!');
      } else {
        this.gameOver();
        return;
      }
    }
    if (event?.kind === 'grind') this.player.enterGrind(event.mesh);
    else if (event?.kind === 'launch') {
      this.player.launch(event.power);
      this.audio.sfx('launch');
    }
    else if (event?.kind === 'fork' && this.forkCooldown <= 0) {
      // Route choice: pass the gantry in the LEFT lane to take the rooftops.
      this.forkCooldown = 2;
      if (this.player.laneIndex === 0) {
        this.chunks.chooseRoute('roof');
        this.hud.showToast('⬆ ROOFTOP ROUTE');
      } else {
        this.hud.showToast('➡ STREET ROUTE');
      }
    }

    // Deck scoreMul boosts distance, grind, and platform points (⭐ doubles).
    const sm = this.player.stats.scoreMul * x2;
    this.score += CONFIG.distanceScoreRate * this.speed * dt * 0.1 * sm;
    // Grinds pay more the longer you hold the balance — and feed the nitro.
    if (this.player.grinding) {
      this.score +=
        (CONFIG.grindScoreRate + CONFIG.grindScoreRamp * this.player.grindTime) * dt * sm;
      this.boost = Math.min(CONFIG.boostMax, this.boost + CONFIG.boostChargeGrind * dt);
    } else if (!this.player.airborne && this.player.y > 0.5) {
      // Riding along a raised platform (container top) pays a steady bonus.
      this.score += CONFIG.platformScoreRate * dt * sm;
    }

    // Drive the continuous rolling + grind sound.
    const speedT = Math.min(1, Math.max(0, (this.speed - CONFIG.baseSpeed) / (CONFIG.maxSpeed - CONFIG.baseSpeed)));

    // Wheel fire: kicks in above ~70% speed, always full while boosting.
    const fire = this.boostT > 0 ? 1 : Math.max(0, (speedT - 0.7) / 0.3);
    this.player.setFire(fire);
    this.audio.update(dt, {
      rolling: !this.player.airborne && !this.player.grinding && !this.player.bailing,
      speedT,
      grinding: this.player.grinding,
      balance: this.player.balance,
    });

    this.hud.update(this.score, this.coinCount, this.player, this.level, this.speed);
    this.hud.showEffects(this.effects);
    this.hud.showBoost(this.boost, this.boostT > 0);
  }

  updateCamera(dt) {
    const cam = this.camera;

    // Skate Lab frames the skater on the LEFT (config panel fills the right).
    if (this.state === 'store') {
      cam.position.set(1.7, 1.25, 4.1);
      cam.lookAt(0.35, 0.8, 0);
      if (Math.abs(cam.fov - CONFIG.fovBase) > 0.01) {
        cam.fov = CONFIG.fovBase;
        cam.updateProjectionMatrix();
      }
      return;
    }
    if (this.state === 'loading') {
      cam.position.set(0, 1.35, 3.8);
      cam.lookAt(0, 0.82, 0);
      if (Math.abs(cam.fov - CONFIG.fovBase) > 0.01) {
        cam.fov = CONFIG.fovBase;
        cam.updateProjectionMatrix();
      }
      return;
    }

    const targetX = this.player.x * 0.5;
    this.camX = dt ? this.camX + (targetX - this.camX) * Math.min(1, dt * 8) : targetX;
    // At altitude (containers, rooftops) the camera climbs above and drops
    // further back, looking up near the skater's body — so a rooftop run feels
    // high and open rather than flat and cramped. Smoothed so drops aren't jarring.
    const y = this.player.y;
    const camY = CONFIG.camHeight + y * 0.9;
    this.camY = dt ? this.camY + (camY - this.camY) * Math.min(1, dt * 6) : camY;
    // Big air (high-jumps off rails / second-level ollies) eases the camera
    // out and up so the height reads — and eases back in on landing.
    const airT = this.player.airborne ? Math.min(1, Math.max(0, (y - this.player.floorY - 1.4) / 4)) : 0;
    this.camZoom = dt ? this.camZoom + (airT - this.camZoom) * Math.min(1, dt * 4) : airT;
    cam.position.set(
      this.camX,
      this.camY + this.camZoom * 0.9,
      CONFIG.camBack + y * 0.28 + this.camZoom * 2.6
    );
    cam.lookAt(this.camX * 0.6, 1.2 + y * 0.85, CONFIG.camLookAhead);

    // FOV pushes out with speed for a sense of acceleration.
    const speedT =
      this.state === 'playing'
        ? (this.speed - CONFIG.baseSpeed) / (CONFIG.maxSpeed - CONFIG.baseSpeed)
        : 0;
    const targetFov =
      CONFIG.fovBase +
      (CONFIG.fovMax - CONFIG.fovBase) * speedT +
      (this.boostT > 0 ? 6 : 0) + // extra kick while the nitro burns
      this.camZoom * 5; // and a wide-angle breath at the top of big air
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
