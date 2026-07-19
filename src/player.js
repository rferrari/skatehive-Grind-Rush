// Player: lane movement, jump/slide/grind state machine, air tricks, the
// grind balance minigame, and all procedural animation. Every animated
// transform is derived from state each frame — nothing accumulates — so
// reset() is trivial and poses can't drift.
//
// Gameplay events (trick landed, balance bail, ...) are queued on
// this.events and drained by game.js via popEvents().
import { Group, Mesh, CircleGeometry, ConeGeometry, MeshBasicMaterial, CanvasTexture } from 'three';
import { CONFIG } from './config.js';
import { buildSkater, DEFAULT_SKATER_PALETTE } from './meshes.js';

// Chest-logo textures, drawn once per brand on an offscreen canvas (emoji or
// the SKATEHIVE wordmark) — no image assets, works offline. Browser-only.
const brandTextures = new Map();
function brandTexture(brand) {
  if (brandTextures.has(brand.id)) return brandTextures.get(brand.id);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (brand.logo.length > 3) {
    // Wordmark: stacked bold text with an outline so it reads on any shirt.
    g.font = 'bold 64px "Courier New", monospace';
    g.lineWidth = 10;
    g.strokeStyle = '#111';
    g.fillStyle = '#fff';
    g.strokeText('SKATE', 128, 96);
    g.fillText('SKATE', 128, 96);
    g.strokeText('HIVE', 128, 164);
    g.fillText('HIVE', 128, 164);
  } else {
    g.font = '170px serif'; // emoji glyph
    g.fillText(brand.logo, 128, 140);
  }
  const tex = new CanvasTexture(c);
  brandTextures.set(brand.id, tex);
  return tex;
}

const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach.
const approach = (current, target, dt, tau) =>
  lerp(current, target, 1 - Math.exp(-dt / tau));

export class Player {
  constructor(scene) {
    const { group, parts, mats } = buildSkater();
    this.scene = scene;
    // The model renders scaled-down (compact view) inside an unscaled outer
    // group; all pose/physics transforms target the outer group in world
    // units, so gameplay tuning is unaffected by the visual scale.
    this.model = group;
    this.model.scale.setScalar(CONFIG.playerVisualScale);
    this.group = new Group();
    this.group.add(this.model);
    this.parts = parts;
    this.mats = mats; // per-part materials, recolored by applyPalette()
    this.looseBoard = null; // board mesh once detached on a bail
    this.looseBoardSpeed = 0;
    this.ride = 'skate'; // 'skate' | 'hover' — survives reset()
    // Loadout stat multipliers (game.js sets these per run from computeStats);
    // neutral by default so headless/test callers behave like base tuning.
    this.stats = {
      speedMul: 1, handlingMul: 1, balanceMul: 1, scoreMul: 1,
      trickSpeedMul: 1, trickScoreMul: 1, slideBrakeMul: 1, slideLenMul: 1,
    };
    // Soft blob shadow that grounds the skater; shrinks/fades with air height.
    this.shadowMat = new MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
    });
    this.shadow = new Mesh(new CircleGeometry(0.5, 20), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
    this.floorY = 0; // support height under the player (set each update)

    // Flame trails off the rear wheels — ignite at high speed / while boosting.
    this.fireIntensity = 0;
    this.flames = [];
    const flameGeo = new ConeGeometry(0.16, 0.9, 7);
    for (const x of [-0.15, 0.15]) {
      const mat = new MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false });
      const flame = new Mesh(flameGeo, mat);
      flame.rotation.x = Math.PI / 2; // apex trails backward (+z, toward camera)
      flame.position.set(x, 0.12, 0.5);
      flame.visible = false;
      this.parts.board.add(flame);
      this.flames.push(flame);
    }

    scene.add(this.group);
    this.reset();
  }

  // Fire VFX intensity 0..1 (game drives this from speed + boost).
  setFire(intensity) {
    this.fireIntensity = intensity;
    const on = intensity > 0.01;
    for (const f of this.flames) f.visible = on;
  }

  // Apply the cosmetic side of the equipped loadout for the active ride.
  // Skate: wheel color/size + truck color. Hover: thruster jet color/size +
  // mag-lock pod color. (Deck color/glow + ride go via applyPalette/setRide.)
  applyLoadoutCosmetics(ride, partA, partB) {
    if (ride === 'skate') {
      if (partA?.cosmetic) {
        this.mats.wheel.color.setHex(partA.cosmetic.color);
        const r = partA.cosmetic.radius ?? 0.09;
        for (const w of this.parts.wheels) w.scale.setScalar(r / 0.09);
      }
      if (partB?.cosmetic) this.mats.truck.color.setHex(partB.cosmetic.color);
    } else {
      if (partA?.cosmetic) {
        this.mats.thruster.color.setHex(partA.cosmetic.color);
        this.mats.thruster.emissive.setHex(partA.cosmetic.color);
        // Jets are unit boxes whose DIMENSIONS live in scale — multiply the
        // remembered base, never overwrite it (that made a giant neon cube).
        const s = partA.cosmetic.size ?? 1;
        for (const jet of this.parts.thrusterJets) {
          jet.userData.baseScale ??= jet.scale.clone();
          jet.scale.copy(jet.userData.baseScale).multiplyScalar(s);
        }
      }
      if (partB?.cosmetic) this.mats.pod.color.setHex(partB.cosmetic.color);
    }
  }

  // Recolor the skater/board live from a selected character + board palette.
  applyPalette(palette) {
    const p = { ...DEFAULT_SKATER_PALETTE, ...palette };
    for (const key of Object.keys(this.mats)) {
      if (p[key] === undefined) continue;
      this.mats[key].color.setHex(p[key]);
      if (key === 'glow') this.mats.glow.emissive.setHex(p[key]);
    }
  }

  // Stance: goofy mirrors the whole model (lead foot flips).
  setStance(stance) {
    const s = CONFIG.playerVisualScale;
    this.model.scale.set(stance === 'goofy' ? -s : s, s, s);
  }

  // Chest brand print (null/NONE hides it). No-op headless (no canvas).
  applyBrand(brand) {
    const logo = this.parts.logo;
    if (!brand?.logo || typeof document === 'undefined') {
      logo.visible = false;
      return;
    }
    this.mats.logo.map = brandTexture(brand);
    this.mats.logo.needsUpdate = true;
    logo.visible = true;
  }

  // Hide/show the whole skater (menu screens run the world without them).
  setVisible(v) {
    this.group.visible = v;
    this.shadow.visible = v;
    if (this.looseBoard) this.looseBoard.visible = v;
  }

  // Swap between skateboard (wheels) and hoverboard (glow + thruster pods).
  setRide(ride) {
    this.ride = ride;
    this.parts.skateGear.visible = ride === 'skate';
    this.parts.hoverGear.visible = ride === 'hover';
  }

  get isHover() {
    return this.ride === 'hover';
  }

  // Rail snap distance — the hoverboard magnet-locks from farther away.
  get grindSnapWindow() {
    return this.isHover ? CONFIG.hoverGrindSnapWindow : CONFIG.grindSnapWindow;
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
    // Re-attach the board if a previous bail detached it into the scene
    // (back inside the scaled model, so its local scale returns to 1).
    if (this.looseBoard) {
      this.scene.remove(this.looseBoard);
      this.looseBoard.scale.setScalar(1);
      this.model.add(this.looseBoard);
      this.looseBoard = null;
      this.looseBoardSpeed = 0;
    }
    board.position.set(0, 0, 0);
    board.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    body.position.y = 0.29;
    torso.rotation.set(0, 0, 0);
    arms.rotation.set(0, 0, 0);
    arms.children[0].rotation.set(0, 0, 0);
    arms.children[1].rotation.set(0, 0, 0);
    if (this.flames) this.setFire(0);
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
      // Popping off a rail carries the grind's energy — extra height, enough
      // to reach a container top or chain onto something big.
      this.exitGrind(CONFIG.highJumpVelocity);
    } else if (!this.airborne) {
      // "Second-level" ollie: jumping from an elevated surface (container,
      // rooftop) also pops higher than a flat-ground ollie.
      this.vy = this.y > 0.5 ? CONFIG.highJumpVelocity : CONFIG.jumpVelocity;
      this.airborne = true;
      this.sliding = false;
    }
  }

  // Popped into the air by a kicker ramp — a bigger boost than a manual ollie,
  // enough to clear onto a container top.
  launch(power) {
    if (this.bailing || this.grinding || this.airborne) return;
    this.vy = power;
    this.airborne = true;
    this.sliding = false;
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

  // Wipe out: the board pops off and keeps rolling down the street (at the
  // speed you were carrying) while the skater tumbles. Detached from the
  // scaled model into the scene, it keeps its rendered size explicitly.
  bail(speed = 0) {
    this.bailing = true;
    this.bailT = 0;
    const board = this.parts.board;
    this.model.remove(board);
    this.scene.add(board);
    board.scale.setScalar(CONFIG.playerVisualScale);
    board.position.set(this.x, this.y + 0.02, 0);
    board.rotation.set(0, 0, 0);
    this.looseBoard = board;
    this.looseBoardSpeed = Math.max(speed, 6);
  }

  // -------------------------------------------------------------- update ---
  // floorY is the support height directly under the player this frame (0 on
  // the ground, a container top when riding one) — supplied by game.js from
  // queryFloor(). glideHeld: jump input held (hoverboards fall slower).
  // Defaults keep headless/unit callers simple.
  update(dt, floorY = 0, glideHeld = false) {
    this.time += dt;
    this.floorY = floorY;
    this.gliding = this.isHover && this.airborne && glideHeld && this.vy < 0;
    this.updateShadow();

    if (this.bailing) {
      this.bailT = Math.min(this.bailT + dt / 0.45, 1);
      this.applyBailPose();
      // The detached board rolls on ahead, slowing to a stop, wheels spinning.
      if (this.looseBoard) {
        this.looseBoardSpeed = Math.max(0, this.looseBoardSpeed - 7 * dt);
        this.looseBoard.position.z += this.looseBoardSpeed * dt;
        for (const w of this.parts.wheels) w.rotation.x += this.looseBoardSpeed * dt * 4;
      }
      return;
    }

    // Lateral: exponential approach to the target lane. Better trucks (higher
    // handlingMul) shorten the time constant for snappier lane changes.
    const targetX = CONFIG.lanes[this.laneIndex];
    this.x = approach(this.x, targetX, dt, CONFIG.laneChangeTime / (3 * this.stats.handlingMul));
    if (Math.abs(this.x - targetX) < 0.01) this.x = targetX;

    // Active trick spins the board; finishing it fires the score event.
    // Faster spinners (trickSpeedMul < 1) complete the spin sooner.
    if (this.trick) {
      this.trickT += dt / (CONFIG.trickDuration * this.stats.trickSpeedMul);
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
        // The hoverboard magnet-locks onto rails: balance drifts at half rate.
        // Better trucks (higher balanceMul) further resist the drift.
        const magnet = this.isHover ? CONFIG.hoverBalanceDrift : 1;
        this.balance += (lean * CONFIG.balanceDriftMax * pressure * magnet * dt) / this.stats.balanceMul;
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
      // Hover-glide: holding jump on a hoverboard softens gravity on the way
      // down, stretching airtime off kickers and container drops.
      this.vy -= CONFIG.gravity * (this.gliding ? CONFIG.hoverGlideGravity : 1) * dt;
      // Land on whatever surface is under us — ground or a container top.
      // queryFloor only reports a container top once we've risen to within a
      // step of it, so this also "catches" a launched player onto a ledge on
      // the way up (ollie-onto-ledge) rather than needing a perfect descent.
      if (this.y <= floorY) {
        this.y = floorY;
        this.vy = 0;
        this.airborne = false;
        this.trick = null; // landed mid-spin: trick fizzles, no points
        this.trickT = 0;
      }
    } else {
      // Grounded (rolling or sliding). If the floor dropped away beneath us
      // — rolled off the end of a container — step off into a fall.
      if (this.y > floorY + 0.02) {
        this.airborne = true;
        this.vy = 0;
      } else {
        this.y = floorY;
      }
      if (this.sliding) {
        this.slideTime += dt;
        // Wheel choice stretches or shortens how long a powerslide holds.
        if (this.slideTime > CONFIG.slideDuration * this.stats.slideLenMul) this.sliding = false;
      }
    }

    this.applyPose(dt);
  }

  // Blob shadow tracks the support surface under the player (road or
  // container top) and shrinks/fades the higher they fly above it.
  updateShadow() {
    const h = Math.max(0, this.y - this.floorY);
    const s = Math.max(0.35, 1 - h * 0.16);
    this.shadow.position.set(this.x, this.floorY + 0.02, 0);
    this.shadow.scale.setScalar(s);
    this.shadowMat.opacity = 0.3 * Math.max(0.3, 1 - h * 0.2);
  }

  // --------------------------------------------------------------- poses ---
  applyPose(dt) {
    const { board, body, legs, torso } = this.parts;
    const targetX = CONFIG.lanes[this.laneIndex];

    // Hoverboards float and bob above the surface while riding; the NEON DASH
    // trick lunges the whole rider forward and back.
    const hoverLift =
      this.isHover && !this.airborne && !this.grinding
        ? CONFIG.hoverHeight + Math.sin(this.time * CONFIG.hoverBobFreq) * CONFIG.hoverBobAmp
        : 0;
    const trickZ = this.trick === 'neondash' ? -Math.sin(this.trickT * Math.PI) * 1.6 : 0;
    this.group.position.set(this.x, this.y + hoverLift, trickZ);

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
      else if (this.trick === 'hoverspin') board.rotation.y = spin * 2; // 720°
      else if (this.trick === 'gravflip') {
        // The board flips end-over-end while orbiting the rider.
        board.rotation.x = spin;
        board.position.y = (1 - Math.cos(spin)) * 0.45;
        board.position.z = -Math.sin(spin) * 0.45;
      } else if (this.trick === 'neondash') {
        board.rotation.x = -Math.sin(spin / 2) * 0.5; // nose-down surge
      }
    } else {
      // Recover board offsets left by a cancelled mid-air gravflip.
      board.position.y = approach(board.position.y, 0, dt, 0.08);
      board.position.z = approach(board.position.z, 0, dt, 0.08);
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

    // Flame flicker: length rides intensity, color shifts orange→yellow hot.
    if (this.fireIntensity > 0.01) {
      for (let i = 0; i < this.flames.length; i++) {
        const f = this.flames[i];
        const flick = 0.75 + Math.sin(this.time * 40 + i * 2.1) * 0.25;
        f.scale.set(0.7 + this.fireIntensity * 0.5, 1, 0.7 + this.fireIntensity * 0.5);
        f.scale.y = (0.8 + this.fireIntensity * 2.2) * flick; // length back
        f.material.color.setHex(this.fireIntensity > 0.75 ? 0xffd23d : 0xff7a1a);
        f.material.opacity = 0.55 + this.fireIntensity * 0.4;
      }
    }
  }

  applyBailPose() {
    const t = this.bailT;
    const ease = t * (2 - t); // ease-out
    // The skater tumbles and drops; the board is detached and rolls on its own
    // (see update()), so it isn't touched here.
    this.group.position.set(this.x, Math.max(0, this.y * (1 - ease)), 0);
    this.group.rotation.z = ease * 1.9;
    this.group.rotation.y = ease * 0.6;
  }
}
