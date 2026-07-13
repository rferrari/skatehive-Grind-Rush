// Player: lane movement, jump/slide/grind state machine, air tricks, the
// grind balance minigame, and all procedural animation. Every animated
// transform is derived from state each frame — nothing accumulates — so
// reset() is trivial and poses can't drift.
//
// Gameplay events (trick landed, balance bail, ...) are queued on
// this.events and drained by game.js via popEvents().
import { CONFIG } from './config.js';
import { buildSkater } from './meshes.js';

const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach.
const approach = (current, target, dt, tau) =>
  lerp(current, target, 1 - Math.exp(-dt / tau));

export class Player {
  constructor(scene) {
    const { group, parts } = buildSkater();
    this.group = group;
    this.parts = parts;
    scene.add(group);
    this.reset();
  }

  reset() {
    this.laneIndex = 1;
    this.x = CONFIG.lanes[1];
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.sliding = false;
    this.slideTime = 0;
    this.grinding = false;
    this.grindMesh = null;
    this.grindTime = 0;
    this.balance = 0; // -1..1 while grinding; tip past the ends = bail
    this.trick = null; // active air trick name
    this.trickT = 0; // 0..1 progress through the spin
    this.lastTrickEnd = -10; // this.time when the last trick finished
    this.events = [];
    this.bailing = false;
    this.bailT = 0;
    this.time = 0;
    this.group.rotation.set(0, 0, 0);
    this.group.position.set(this.x, 0, 0);
    const { board, body, torso, arms } = this.parts;
    board.position.set(0, 0, 0);
    board.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    body.position.y = 0.29;
    torso.rotation.set(0, 0, 0);
    arms.rotation.set(0, 0, 0);
    arms.children[0].rotation.set(0, 0, 0);
    arms.children[1].rotation.set(0, 0, 0);
  }

  get topY() {
    return this.y + (this.sliding ? CONFIG.slideHeight : CONFIG.playerHeight);
  }

  popEvents() {
    if (!this.events.length) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------- actions ---
  moveLane(dir) {
    if (this.bailing) return;
    if (this.grinding) {
      // On a rail, <-/-> steer the balance needle instead of changing lanes.
      this.balance += dir * CONFIG.balanceNudge;
      return;
    }
    const next = this.laneIndex + dir;
    if (next < 0 || next >= CONFIG.lanes.length) return;
    this.laneIndex = next;
  }

  jump() {
    if (this.bailing) return;
    if (this.grinding) {
      this.exitGrind(CONFIG.jumpVelocity); // full jump off the rail
    } else if (!this.airborne) {
      this.vy = CONFIG.jumpVelocity;
      this.airborne = true;
      this.sliding = false;
    }
  }

  slide() {
    if (this.bailing || this.airborne || this.grinding) return;
    this.sliding = true;
    this.slideTime = 0;
  }

  // Air tricks: only while airborne with the board free. Points are awarded
  // by game.js when the spin completes ('trick' event) — bail out of the sky
  // early and the trick is simply lost. `replace` lets a fast motion combo
  // (left→right) upgrade an in-progress trick into a bigger one.
  tryTrick(name, replace = false) {
    if (this.bailing || this.grinding || !this.airborne) return false;
    if (this.trick && !replace) return false;
    this.trick = name;
    this.trickT = 0;
    return true;
  }

  enterGrind(mesh) {
    // Landing a trick straight onto the rail is worth a combo bonus.
    if (this.trick || this.time - this.lastTrickEnd < 0.4) {
      this.events.push({ type: 'trickIntoGrind' });
    }
    this.trick = null;
    this.grinding = true;
    this.grindMesh = mesh;
    this.grindTime = 0;
    this.balance = (Math.random() - 0.5) * 0.2;
    this.airborne = false;
    this.vy = 0;
    this.y = CONFIG.railTop;
  }

  exitGrind(upVelocity) {
    this.grinding = false;
    this.grindMesh = null;
    this.balance = 0;
    this.airborne = true;
    this.vy = upVelocity;
  }

  bail() {
    this.bailing = true;
    this.bailT = 0;
  }

  // -------------------------------------------------------------- update ---
  update(dt) {
    this.time += dt;

    if (this.bailing) {
      this.bailT = Math.min(this.bailT + dt / 0.45, 1);
      this.applyBailPose();
      return;
    }

    // Lateral: exponential approach to the target lane.
    const targetX = CONFIG.lanes[this.laneIndex];
    this.x = approach(this.x, targetX, dt, CONFIG.laneChangeTime / 3);
    if (Math.abs(this.x - targetX) < 0.01) this.x = targetX;

    // Active trick spins the board; finishing it fires the score event.
    if (this.trick) {
      this.trickT += dt / CONFIG.trickDuration;
      if (this.trickT >= 1) {
        this.events.push({ type: 'trick', name: this.trick });
        this.lastTrickEnd = this.time;
        this.trick = null;
        this.trickT = 0;
      }
    }

    if (this.grinding) {
      this.grindTime += dt;
      this.y = CONFIG.railTop;

      // Balance drifts toward whichever way you're leaning, harder the
      // longer the grind lasts. Tip past the ends and you're off.
      if (this.grindTime > CONFIG.balanceGrace) {
        const lean = this.balance === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(this.balance);
        const pressure = 0.45 + Math.min(this.grindTime * 0.2, 1.1);
        this.balance += lean * CONFIG.balanceDriftMax * pressure * dt;
      }
      if (Math.abs(this.balance) > 1) {
        this.events.push({ type: 'balanceBail' });
        this.balance = Math.sign(this.balance); // freeze the pose at the tip
      }

      // Rail end passed the player → auto-drop with a small hop.
      const m = this.grindMesh;
      if (m && m.position.z - m.userData.collider.halfDepth > 0.5) {
        this.exitGrind(2.5);
      }
    } else if (this.airborne) {
      this.y += this.vy * dt;
      this.vy -= CONFIG.gravity * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.trick = null; // landed mid-spin: trick fizzles, no points
        this.trickT = 0;
      }
    } else if (this.sliding) {
      this.slideTime += dt;
      if (this.slideTime > CONFIG.slideDuration) this.sliding = false;
    }

    this.applyPose(dt);
  }

  // --------------------------------------------------------------- poses ---
  applyPose(dt) {
    const { board, body, legs, torso } = this.parts;
    const targetX = CONFIG.lanes[this.laneIndex];

    this.group.position.set(this.x, this.y, 0);

    // Bank into lane changes, board a touch more than the body. While
    // grinding, the lean IS the balance needle.
    const bank = this.grinding
      ? -this.balance * 0.55
      : Math.max(-0.35, Math.min(0.35, (this.x - targetX) * 0.3));
    this.group.rotation.z = bank;
    board.rotation.z = bank * 0.6;

    // Board pitch follows vertical velocity: nose up on the ascent.
    const pitch = this.airborne
      ? -Math.sign(this.vy) * Math.min(Math.abs(this.vy) / CONFIG.jumpVelocity, 1) * 0.4
      : 0;
    board.rotation.x = approach(board.rotation.x, pitch, dt, 0.05);

    // Deck turns 90°: boardslide on rails, powerslide on the ground.
    const boardYaw = this.grinding ? Math.PI / 2 : this.sliding ? -Math.PI / 2 : 0;
    board.rotation.y = approach(board.rotation.y, boardYaw, dt, 0.07);

    // Trick spins override the board pose for their duration.
    if (this.trick) {
      const spin = this.trickT * Math.PI * 2;
      if (this.trick === 'kickflip') board.rotation.z = -spin;
      else if (this.trick === 'heelflip') board.rotation.z = spin;
      else if (this.trick === 'shuvit') board.rotation.y = spin;
    }

    // Body height/crouch per state. Sliding is a powerslide: a low crouch
    // twisted sideways rather than laying down flat.
    let bodyScaleY = 1;
    let torsoPitch = 0;
    let torsoYaw = 0;
    if (this.sliding) {
      bodyScaleY = 0.55;
      torsoPitch = 0.35;
      torsoYaw = -1.0; // shoulders turn with the sideways board
    } else if (this.grinding) {
      bodyScaleY = 0.85;
      torsoPitch = 0.2;
    } else if (this.airborne) {
      bodyScaleY = 0.85; // legs tuck in the air
    }
    body.scale.y = approach(body.scale.y, bodyScaleY, dt, 0.05);
    torso.rotation.x = approach(torso.rotation.x, torsoPitch, dt, 0.07);
    torso.rotation.y = approach(torso.rotation.y, torsoYaw, dt, 0.07);

    // Arms out for balance while grinding — windmilling against the lean.
    // Powerslide: lead arm out front, trailing hand reaching back to the
    // ground. Relaxed sway otherwise.
    const armL = this.parts.arms.children[0];
    const armR = this.parts.arms.children[1];
    let armSpread, armSpreadR;
    if (this.grinding) {
      armSpread = 1.2 + this.balance * 0.8;
      armSpreadR = 1.2 - this.balance * 0.8;
    } else if (this.sliding) {
      armSpread = 0.9; // lead arm out for balance
      armSpreadR = 0.15;
    } else {
      armSpread = armSpreadR = Math.sin(this.time * 6) * 0.08;
    }
    armL.rotation.z = approach(armL.rotation.z, armSpread, dt, 0.08);
    armR.rotation.z = approach(armR.rotation.z, -armSpreadR, dt, 0.08);
    // Trailing hand swings back and down to skim the tarmac mid-slide.
    armL.rotation.x = approach(armL.rotation.x, this.sliding ? -0.45 : 0, dt, 0.08);
    armR.rotation.x = approach(armR.rotation.x, this.sliding ? 1.35 : 0, dt, 0.08);

    // Rolling bob when on the ground.
    const grounded = !this.airborne && !this.grinding;
    body.position.y = 0.29 + (grounded ? Math.sin(this.time * 9) * 0.02 : 0);
    legs.scale.y = 1; // legs length lives in body.scale.y
  }

  applyBailPose() {
    const t = this.bailT;
    const ease = t * (2 - t); // ease-out
    this.group.position.set(this.x, Math.max(0, this.y * (1 - ease)), 0);
    this.group.rotation.z = ease * 1.9;
    this.group.rotation.y = ease * 0.6;
    // Board shoots out ahead.
    this.parts.board.position.z = -ease * 2.2;
    this.parts.board.rotation.z = ease * 3;
  }
}
