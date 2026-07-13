// Game orchestration: state machine (menu / playing / gameover), the
// per-frame update pipeline, speed ramp, scoring and camera follow.
import { CONFIG, computeStats, partById } from './config.js';
import { LocalLedger } from './ledger.js';
import { Player } from './player.js';
import { World } from './world.js';
import { CoinManager } from './coins.js';
import { ChunkManager } from './chunks.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
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
    this.chunks = new ChunkManager(scene, this.coins);
    this.input = new Input();
    this.hud = new Hud();
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
    this.camX = 0;

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

  // Loading → select. Frames the skater for the character/board preview.
  goToSelect() {
    this.player.reset();
    this.previewSpin = 0;
    this.state = 'select';
    this.stateTime = 0;
    this.hud.showSelect();
  }

  // Select → start screen. Faces the skater forward again for the run camera.
  goToMenu() {
    this.player.group.rotation.y = 0;
    this.state = 'menu';
    this.stateTime = 0;
    this.hud.showMenu(this.ledger.getBalance());
  }

  // Open the store (reuses the turntable preview to show the equipped skate).
  goToStore() {
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
    this.mode = mode;
    // Loadout stats apply in casual; ranked normalizes them (fair pot board).
    this.player.stats = computeStats(this.ledger.getLoadout(), mode);
    this.player.reset();
    this.coins.reset();
    this.chunks.reset();
    this.score = 0;
    this.coinCount = 0;
    this.distance = this.startDistance; // 0 unless dev level-start is active
    this.continuesUsed = 0;
    this.level = this.currentLevel();
    this.lastAirDir = 0;
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
    this.coinCount = 0; // this run's coins were already banked at the bail
    this.hud.hideOverlays();
    this.hud.update(this.score, 0, this.player, this.level);
    this.state = 'playing';
    this.stateTime = 0;
  }

  gameOver() {
    this.player.bail(this.speed);
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
        if (this.loadingT >= LOADING_DURATION) this.goToSelect();
        break;

      case 'select':
        this.world.update(dt, 4);
        this.player.update(dt);
        this.previewSpin += dt * 0.7;
        this.player.group.rotation.y = this.previewSpin; // slow turntable preview
        if (actions.includes('start')) this.goToMenu();
        break;

      case 'store':
        this.world.update(dt, 4);
        this.player.update(dt);
        this.previewSpin += dt * 0.7;
        this.player.group.rotation.y = this.previewSpin; // preview equipped skate
        break;

      case 'menu':
        this.world.update(dt, 5); // slow scroll behind the title
        this.player.update(dt);
        if (actions.includes('start')) this.startRun('casual');
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
    this.speed = this.currentSpeed;
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
        } else this.player.jump();
      } else if (action === 'slide') {
        this.player.slide();
      } else if (action in CONFIG.tricks) {
        this.player.tryTrick(this.trickFor(action)); // Z/X/C shortcuts still work
      }
    }

    // Support height under the player (0 = ground, container top when riding).
    const floorY = queryFloor(this.player, this.chunks.active);
    this.player.update(dt, floorY, this.input.jumpHeld());
    this.world.update(dt, this.speed);
    this.chunks.update(dt, this.speed, this.distance);
    const picked = this.coins.update(dt, this.speed, this.player);
    if (picked) {
      this.coinCount += picked;
      this.score += picked * CONFIG.coinValue;
    }

    // Player-generated events: landed tricks, combos, balance falls. Spinner
    // parts boost trick payouts (trickScoreMul).
    const trickMul = this.player.stats.trickScoreMul;
    for (const ev of this.player.popEvents()) {
      if (ev.type === 'trick') {
        const def = CONFIG.tricks[ev.name];
        const pts = Math.round(def.score * trickMul);
        this.score += pts;
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
    if (event?.kind === 'hit') {
      this.gameOver();
      return;
    }
    if (event?.kind === 'grind') this.player.enterGrind(event.mesh);
    else if (event?.kind === 'launch') this.player.launch(event.power);

    // Deck scoreMul boosts distance, grind, and platform points.
    const sm = this.player.stats.scoreMul;
    this.score += CONFIG.distanceScoreRate * this.speed * dt * 0.1 * sm;
    // Grinds pay more the longer you hold the balance.
    if (this.player.grinding) {
      this.score +=
        (CONFIG.grindScoreRate + CONFIG.grindScoreRamp * this.player.grindTime) * dt * sm;
    } else if (!this.player.airborne && this.player.y > 0.5) {
      // Riding along a raised platform (container top) pays a steady bonus.
      this.score += CONFIG.platformScoreRate * dt * sm;
    }

    this.hud.update(this.score, this.coinCount, this.player, this.level);
  }

  updateCamera(dt) {
    const cam = this.camera;

    // Loading, selection & store use a close, forward-facing skater preview.
    if (this.state === 'loading' || this.state === 'select' || this.state === 'store') {
      cam.position.set(0, 1.5, 4.3);
      cam.lookAt(0, 0.95, 0);
      if (Math.abs(cam.fov - CONFIG.fovBase) > 0.01) {
        cam.fov = CONFIG.fovBase;
        cam.updateProjectionMatrix();
      }
      return;
    }

    const targetX = this.player.x * 0.5;
    this.camX = dt ? this.camX + (targetX - this.camX) * Math.min(1, dt * 8) : targetX;
    // Lift the camera and its look target with the player so a rider up on a
    // container stays comfortably framed instead of climbing out of view.
    const followY = this.player.y * 0.55;
    cam.position.set(this.camX, CONFIG.camHeight + followY, CONFIG.camBack);
    cam.lookAt(this.camX * 0.6, 1.2 + followY, CONFIG.camLookAhead);

    // FOV pushes out with speed for a sense of acceleration.
    const speedT =
      this.state === 'playing'
        ? (this.speed - CONFIG.baseSpeed) / (CONFIG.maxSpeed - CONFIG.baseSpeed)
        : 0;
    const targetFov = CONFIG.fovBase + (CONFIG.fovMax - CONFIG.fovBase) * speedT;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
