// Game orchestration: state machine (menu / playing / gameover), the
// per-frame update pipeline, speed ramp, scoring and camera follow.
import { CONFIG, computeStats, partById } from './config.js';
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

    // Character is a free cosmetic (kept as an index); the deck/wheels/trucks/
    // spinners loadout lives in the ledger.
    this.charIndex = loadIndex('skatehive-character', CONFIG.characters.length);
    this.mode = 'casual'; // 'casual' | 'ranked'
    this.applySelection();

    this.continuesUsed = 0;
    this.startDistance = devStartDistance();

    this.hud.showLoading(0);
    this.updateCamera(0);
  }

  // Selection step 1: character colors, on the turntable.
  goToSelectChar() {
    this.player.reset();
    this.player.setVisible(true);
    this.previewSpin = 0;
    this.state = 'selectChar';
    this.stateTime = 0;
    this.hud.showScreen('selectChar');
  }

  // Selection step 2: the board — camera drops to frame the deck. Locked
  // boards route the player to the store.
  goToSelectBoard() {
    this.player.setVisible(true);
    this.state = 'selectBoard';
    this.stateTime = 0;
    this.hud.showScreen('selectBoard');
  }

  // Select / store / give-up → start screen: a clean title over the scrolling
  // city, no skater. A bailed skater gets back up (board re-attached) first.
  goToMenu() {
    if (this.player.bailing) this.player.reset();
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

  // Open the store (reuses the turntable preview to show the equipped skate).
  goToStore() {
    this.player.setVisible(true);
    this.previewSpin = 0;
    this.state = 'store';
    this.stateTime = 0;
    this.hud.showStore(this.storeState());
  }

  // Snapshot the ledger for the store UI to render.
  storeState() {
    const owned = {};
    const equipped = this.ledger.getLoadout();
    for (const slot of Object.keys(CONFIG.parts)) {
      owned[slot] = CONFIG.parts[slot].map((p) => this.ledger.owns(slot, p.id));
    }
    return { balance: this.ledger.getBalance(), pot: this.ledger.getPot(), equipped, owned };
  }

  // Repaint the skater from the character colors + equipped loadout: deck
  // color/glow/ride, plus wheel/truck cosmetics.
  applySelection() {
    const loadout = this.ledger.getLoadout();
    const deck = partById('deck', loadout.deck);
    const palette = {
      ...CONFIG.characters[this.charIndex].colors,
      deck: deck.deck,
      ...(deck.glow !== undefined && { glow: deck.glow }),
    };
    this.player.applyPalette(palette);
    this.player.setRide(deck.ride);
    this.player.applyLoadoutCosmetics(
      partById('wheels', loadout.wheels),
      partById('trucks', loadout.trucks)
    );
  }

  // Index of the equipped deck within CONFIG.boards — for the select-screen
  // swatch highlight (which still cycles the deck catalog).
  get boardIndex() {
    return Math.max(0, CONFIG.boards.findIndex((d) => d.id === this.ledger.getEquipped('deck')));
  }

  // On a hoverboard the classic trick inputs fire the futuristic set.
  trickFor(name) {
    return this.player.isHover ? CONFIG.hoverTrickFor[name] ?? name : name;
  }

  selectCharacter(i) {
    this.charIndex = ((i % CONFIG.characters.length) + CONFIG.characters.length) % CONFIG.characters.length;
    saveIndex('skatehive-character', this.charIndex);
    this.applySelection();
  }

  // Equip a deck from the select screen — only if owned; locked decks are
  // bought in the store.
  selectBoard(i) {
    const deck = CONFIG.boards[i];
    if (!this.ledger.owns('deck', deck.id)) return false;
    this.ledger.equip('deck', deck.id);
    this.applySelection();
    return true;
  }

  // Store tap: equip if already owned, otherwise buy then equip on success.
  // Returns a fresh storeState() snapshot for the UI to re-render.
  async storeSelect(slot, id) {
    if (this.ledger.owns(slot, id)) {
      await this.equipPart(slot, id);
    } else {
      const r = await this.ledger.buy(slot, id);
      if (r.ok) await this.equipPart(slot, id);
    }
    return this.storeState();
  }

  async equipPart(slot, id) {
    const r = await this.ledger.equip(slot, id);
    this.applySelection();
    return r;
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

      case 'selectChar':
      case 'selectBoard':
        this.world.update(dt, 4);
        this.player.update(dt);
        this.previewSpin += dt * 0.7;
        this.player.group.rotation.y = this.previewSpin; // slow turntable preview
        break;

      case 'store':
        this.world.update(dt, 4);
        this.player.update(dt);
        this.previewSpin += dt * 0.7;
        this.player.group.rotation.y = this.previewSpin; // preview equipped skate
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
      p.tryTrick(this.trickFor('shuvit'), true);
      this.lastAirDir = 0;
      return;
    }
    p.tryTrick(this.trickFor('heelflip'));
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
    let modTarget = this.player.sliding
      ? CONFIG.slideDrag
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
          this.player.tryTrick(this.trickFor('kickflip'));
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
        this.player.tryTrick(this.trickFor(action)); // Z/X/C shortcuts still work
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

    // Powerup pickups start (or refresh) their effect timers.
    for (const type of this.powerups.update(dt, this.speed, this.player)) {
      this.effects[type] = CONFIG.powerups[type].dur;
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
        this.boost = Math.min(1, this.boost + CONFIG.boostChargeTrick); // tricks feed the nitro
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
      this.boost = Math.min(1, this.boost + CONFIG.boostChargeGrind * dt);
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

    // Loading, selection & store use a close, forward-facing skater preview;
    // the board step drops the camera low to frame the deck itself.
    if (this.state === 'selectBoard') {
      cam.position.set(0, 0.85, 2.9);
      cam.lookAt(0, 0.3, 0);
      if (Math.abs(cam.fov - CONFIG.fovBase) > 0.01) {
        cam.fov = CONFIG.fovBase;
        cam.updateProjectionMatrix();
      }
      return;
    }
    if (this.state === 'loading' || this.state === 'selectChar' || this.state === 'store') {
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
    cam.position.set(this.camX, this.camY, CONFIG.camBack + y * 0.28);
    cam.lookAt(this.camX * 0.6, 1.2 + y * 0.85, CONFIG.camLookAhead);

    // FOV pushes out with speed for a sense of acceleration.
    const speedT =
      this.state === 'playing'
        ? (this.speed - CONFIG.baseSpeed) / (CONFIG.maxSpeed - CONFIG.baseSpeed)
        : 0;
    const targetFov =
      CONFIG.fovBase +
      (CONFIG.fovMax - CONFIG.fovBase) * speedT +
      (this.boostT > 0 ? 6 : 0); // extra kick while the nitro burns
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
