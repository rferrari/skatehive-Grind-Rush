// Environment: leapfrogging road segments (with lane stripes and sidewalks
// parented to them), pooled edge scenery, lights, fog — and level themes.
// setTheme() retargets every environment color/intensity; update() eases
// toward the target so day fades into sunset, sunset into night.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
  buildBuilding, buildTree, buildStreetlight, buildRamp, buildFence,
  buildBench, buildBush, buildTunnelWall, buildTunnelArch, THEME_MATS,
} from './meshes.js';

const SEGMENT_LENGTH = 100;
const THEME_TAU = 1.4; // seconds; smaller = faster theme fade

// Per-location scenery recipes. edge = |x| distance from the road center
// (subway walls hug it, buildings sit back); centered items span the road.
const SCENERY_SETS = {
  city: {
    // Dense downtown: a near row of storefront blocks with trees/streetlights
    // between them, plus a far row of taller towers for a skyline backdrop.
    count: 40,
    build: (i) =>
      i % 8 === 4 ? buildTree() : i % 8 === 7 ? buildStreetlight() : buildBuilding(i * 13 + 7),
    edge: (i) => {
      if (i % 8 === 7) return 6.2; // streetlights hug the sidewalk
      if (i % 8 === 4) return 8.5; // trees between the buildings
      return i % 3 === 0 ? 17 + ((i * 7) % 6) : 9 + ((i * 5) % 5);
    },
    // Far-row buildings scale up into towers so the skyline reads deep.
    scale: (i) => (i % 3 === 0 && i % 8 !== 4 && i % 8 !== 7 ? 1.7 : 1),
    faceRoad: (i) => i % 8 === 7,
  },
  park: {
    count: 26,
    build: (i) => {
      const kind = i % 5;
      if (kind === 0) return buildFence(8);
      if (kind === 1) return buildRamp();
      if (kind === 2) return buildTree();
      if (kind === 3) return buildBush();
      return buildBench();
    },
    edge: (i) => (i % 5 === 0 ? 6.0 : 7.5 + ((i * 3) % 5)),
    faceRoad: (i) => i % 5 === 1 || i % 5 === 4, // ramps and benches face the road
  },
  subway: {
    count: 22,
    build: (i, side) => (i % 4 === 3 ? buildTunnelArch() : buildTunnelWall(side)),
    edge: (i) => (i % 4 === 3 ? 0 : 7.2),
    centered: (i) => i % 4 === 3,
  },
};

export class World {
  constructor(scene) {
    this.scene = scene;

    scene.background = new THREE.Color(CONFIG.skyColor);
    scene.fog = new THREE.Fog(CONFIG.skyColor, CONFIG.fogNear, CONFIG.fogFar);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8d8d94, 1.0);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    this.sun.position.set(6, 12, 4);
    scene.add(this.hemi, this.sun);

    // Shared road materials so theme changes repaint both segments at once.
    // The road multiplies its theme color with a baked vertex-color gradient
    // (darker gutters + a faint oil line) so the asphalt reads real.
    this.roadMat = new THREE.MeshLambertMaterial({ color: CONFIG.groundColor, vertexColors: true });
    this.walkMat = new THREE.MeshLambertMaterial({ color: CONFIG.sidewalkColor });

    // Two road segments leapfrog each other for an endless road.
    this.segments = [this.buildSegment(), this.buildSegment()];
    this.segments[0].position.z = -SEGMENT_LENGTH / 2 + 20;
    this.segments[1].position.z = this.segments[0].position.z - SEGMENT_LENGTH;
    scene.add(...this.segments);

    // One pooled scenery set per location, built up front; setTheme() shows
    // the active location's pool and hides the rest.
    this.pools = {};
    for (const [key, set] of Object.entries(SCENERY_SETS)) {
      const pool = [];
      for (let i = 0; i < set.count; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const obj = set.build(i, side);
        const centered = set.centered?.(i);
        obj.position.set(
          centered ? 0 : side * set.edge(i),
          0,
          10 - (i / set.count) * (CONFIG.spawnHorizon + 40)
        );
        if (!centered && set.faceRoad?.(i)) {
          obj.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
        }
        const s = set.scale?.(i) ?? 1;
        if (s !== 1) obj.scale.setScalar(s);
        obj.visible = false;
        scene.add(obj);
        pool.push(obj);
      }
      this.pools[key] = pool;
    }
    this.location = null;

    this.setTheme(CONFIG.levels[0], true);
  }

  setLocation(key) {
    if (key === this.location) return;
    if (this.location) for (const obj of this.pools[this.location]) obj.visible = false;
    for (const obj of this.pools[key]) obj.visible = true;
    this.location = key;
  }

  buildSegment() {
    const seg = new THREE.Group();
    // Road with a baked shading gradient: brightness dips toward the gutters
    // and along a faint oil line up the center — multiplied with the theme
    // color, so it survives day/night transitions.
    const roadGeo = new THREE.BoxGeometry(7.5, 0.1, SEGMENT_LENGTH, 14, 1, 1);
    const pos = roadGeo.attributes.position;
    const shade = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const edge = Math.abs(x) / 3.75;
      let b = 1 - 0.32 * edge ** 1.6; // gutter grime
      b -= 0.08 * Math.exp(-((x / 0.55) ** 2)); // center oil line
      shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = b;
    }
    roadGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    const road = new THREE.Mesh(roadGeo, this.roadMat);
    road.position.y = -0.05;
    seg.add(road);

    for (const x of [-5.5, 5.5]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.24, SEGMENT_LENGTH), this.walkMat);
      walk.position.set(x, -0.02, 0);
      seg.add(walk);
    }

    // Soft contact shadow where the curb meets the street.
    const curbShadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false,
    });
    for (const x of [-3.5, 3.5]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.005, SEGMENT_LENGTH), curbShadowMat);
      strip.position.set(x, 0.055, 0);
      seg.add(strip);
    }

    // Dashed lane stripes at the two lane boundaries.
    const stripeMat = new THREE.MeshLambertMaterial({ color: CONFIG.laneLineColor });
    const stripeGeo = new THREE.BoxGeometry(0.12, 0.02, 1.6);
    for (const x of [-1, 1]) {
      for (let z = -SEGMENT_LENGTH / 2; z < SEGMENT_LENGTH / 2; z += 4) {
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.position.set(x, 0.01, z);
        seg.add(stripe);
      }
    }
    return seg;
  }

  // Retarget the environment to a level theme; colors ease over in update().
  setTheme(theme, instant = false) {
    this.setLocation(theme.scenery);
    this.target = {
      sky: new THREE.Color(theme.sky),
      ground: new THREE.Color(theme.ground),
      sidewalk: new THREE.Color(theme.sidewalk),
      sunColor: new THREE.Color(theme.sunColor),
      sunIntensity: theme.sunIntensity,
      hemiIntensity: theme.hemiIntensity,
      fogNear: theme.fogNear,
      fogFar: theme.fogFar,
      windowGlow: new THREE.Color(theme.windowGlow),
      lampGlow: new THREE.Color(theme.lampGlow),
    };
    if (instant) this.applyTheme(1);
  }

  applyTheme(t) {
    const tg = this.target;
    this.scene.background.lerp(tg.sky, t);
    this.scene.fog.color.lerp(tg.sky, t);
    this.scene.fog.near += (tg.fogNear - this.scene.fog.near) * t;
    this.scene.fog.far += (tg.fogFar - this.scene.fog.far) * t;
    this.roadMat.color.lerp(tg.ground, t);
    this.walkMat.color.lerp(tg.sidewalk, t);
    this.sun.color.lerp(tg.sunColor, t);
    this.sun.intensity += (tg.sunIntensity - this.sun.intensity) * t;
    this.hemi.intensity += (tg.hemiIntensity - this.hemi.intensity) * t;
    // Building windows and streetlamps glow at night.
    THEME_MATS.window.emissive.lerp(tg.windowGlow, t);
    THEME_MATS.lamp.emissive.lerp(tg.lampGlow, t);
  }

  update(dt, speed) {
    this.applyTheme(1 - Math.exp(-dt / THEME_TAU));

    const dz = speed * dt;
    for (const seg of this.segments) {
      seg.position.z += dz;
      if (seg.position.z - SEGMENT_LENGTH / 2 > 20) {
        seg.position.z -= SEGMENT_LENGTH * 2;
      }
    }
    for (const obj of this.pools[this.location]) {
      obj.position.z += dz;
      if (obj.position.z > 25) {
        obj.position.z -= CONFIG.spawnHorizon + 65;
      }
    }
  }
}
