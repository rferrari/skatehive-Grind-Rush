// Game orchestration: state machine (menu / playing / gameover), the
// per-frame update pipeline, speed ramp, scoring and camera follow.
import { CONFIG } from './config.js';
import { Player } from './player.js';
import { World } from './world.js';
import { CoinManager } from './coins.js';
import { ChunkManager } from './chunks.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { checkCollisions } from './collision.js';

const RESTART_LOCKOUT = 0.7; // seconds before game-over screen accepts input

export class Game {
  constructor(scene, camera) {
    this.camera = camera;
    this.world = new World(scene);
    this.player = new Player(scene);
    this.coins = new CoinManager(scene);
    this.chunks = new ChunkManager(scene, this.coins);
    this.input = new Input();
    this.hud = new Hud();

    this.state = 'menu';
    this.stateTime = 0;
    this.score = 0;
    this.coinCount = 0;
    this.distance = 0;
    this.speed = 0;
    this.level = 1;
    this.lastAirDir = 0;
    this.lastAirDirTime = -1;
    this.camX = 0;

    this.hud.showMenu();
    this.updateCamera(0);
  }

  get currentSpeed() {
    return Math.min(
      CONFIG.maxSpeed,
      CONFIG.baseSpeed +
        this.distance * CONFIG.speedRamp +
        (this.level - 1) * CONFIG.levelSpeedBoost
    );
  }

  currentLevel() {
    let level = 1;
    for (let i = 0; i < CONFIG.levels.length; i++) {
      if (this.distance >= CONFIG.levels[i].distance) level = i + 1;
    }
    return level;
  }

  startRun() {
    this.player.reset();
    this.coins.reset();
    this.chunks.reset();
    this.score = 0;
    this.coinCount = 0;
    this.distance = 0;
    this.level = 1;
    this.lastAirDir = 0;
    this.world.setTheme(CONFIG.levels[0]);
    this.chunks.setBanned(CONFIG.levels[0].banned);
    this.hud.hideOverlays();
    this.hud.update(0, 0, this.player, 1);
    this.state = 'playing';
    this.stateTime = 0;
  }

  gameOver() {
    this.player.bail();
    const finalScore = Math.floor(this.score);
    const prev = this.hud.loadHighScore();
    const isRecord = finalScore > prev;
    if (isRecord) this.hud.saveHighScore(finalScore);
    this.hud.showGameOver(finalScore, Math.max(prev, finalScore), isRecord);
    this.hud.update(this.score, this.coinCount, null, this.level);
    this.state = 'gameover';
    this.stateTime = 0;
  }

  update(dt) {
    this.stateTime += dt;
    const actions = this.input.poll();

    switch (this.state) {
      case 'menu':
        this.world.update(dt, 5); // slow scroll behind the title
        this.player.update(dt);
        if (actions.includes('start')) this.startRun();
        break;

      case 'playing':
        this.updatePlaying(dt, actions);
        break;

      case 'gameover':
        this.player.update(dt); // bail animation plays out
        if (this.stateTime > RESTART_LOCKOUT && actions.includes('start')) {
          this.startRun();
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
      p.tryTrick('shuvit', true);
      this.lastAirDir = 0;
      return;
    }
    p.tryTrick('heelflip');
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
        // Second jump input while already in the air = kickflip.
        if (this.player.airborne && !this.player.grinding) this.player.tryTrick('kickflip');
        else this.player.jump();
      } else if (action === 'slide') {
        this.player.slide();
      } else if (action in CONFIG.tricks) {
        this.player.tryTrick(action); // Z/X/C shortcuts still work
      }
    }

    this.player.update(dt);
    this.world.update(dt, this.speed);
    this.chunks.update(dt, this.speed, this.distance);
    const picked = this.coins.update(dt, this.speed, this.player);
    if (picked) {
      this.coinCount += picked;
      this.score += picked * CONFIG.coinValue;
    }

    // Player-generated events: landed tricks, combos, balance falls.
    for (const ev of this.player.popEvents()) {
      if (ev.type === 'trick') {
        const def = CONFIG.tricks[ev.name];
        this.score += def.score;
        this.hud.showTrick(`${def.label} +${def.score}`);
      } else if (ev.type === 'trickIntoGrind') {
        this.score += CONFIG.trickIntoGrindBonus;
        this.hud.showTrick(`TRICK INTO GRIND +${CONFIG.trickIntoGrindBonus}`);
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

    this.score += CONFIG.distanceScoreRate * this.speed * dt * 0.1;
    // Grinds pay more the longer you hold the balance.
    if (this.player.grinding) {
      this.score +=
        (CONFIG.grindScoreRate + CONFIG.grindScoreRamp * this.player.grindTime) * dt;
    }

    this.hud.update(this.score, this.coinCount, this.player, this.level);
  }

  updateCamera(dt) {
    const cam = this.camera;
    const targetX = this.player.x * 0.5;
    this.camX = dt ? this.camX + (targetX - this.camX) * Math.min(1, dt * 8) : targetX;
    cam.position.set(this.camX, CONFIG.camHeight + this.player.y * 0.25, CONFIG.camBack);
    cam.lookAt(this.camX * 0.6, 1.2, CONFIG.camLookAhead);

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
