import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CONFIG.fovBase,
  innerWidth / innerHeight,
  0.1,
  220
);

const game = new Game(scene, camera);

// ---- PWA install button (mobile menu screen) ----
// Chrome/Android fires beforeinstallprompt when the app is installable; we
// stash the event and replay it from our own button. iOS Safari never fires
// it, so it gets a "Share → Add to Home Screen" hint instead.
const installBtn = document.getElementById('install-btn');
const iosHint = document.getElementById('ios-hint');
const isMobile = matchMedia('(pointer: coarse)').matches;
const isStandalone =
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (isMobile && !isStandalone) installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.classList.add('hidden');
});

addEventListener('appinstalled', () => {
  installBtn.classList.add('hidden');
  iosHint.classList.add('hidden');
});

if (isMobile && !isStandalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
  iosHint.classList.remove('hidden');
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp tab-switch jumps
  game.update(dt);
  renderer.render(scene, camera);
});
