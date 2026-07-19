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
window.__game = game; // dev/test handle (drives headless route + screenshot checks)

// All character/gear selection now lives in the Skate Lab (staged + checkout);
// the old two-step select screens are gone.

// Keep taps on UI controls from also reaching the window touch handler (which
// would queue a spurious "start"/jump).
function stopTouch(el) {
  for (const type of ['touchstart', 'touchend']) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

// Continue the ended run by spending banked coins.
const continueBtn = document.getElementById('continue-btn');
continueBtn.addEventListener('click', () => game.continueRun());
stopTouch(continueBtn);

// Give up: back to the start menu instead of retrying.
const giveupBtn = document.getElementById('giveup-btn');
giveupBtn.addEventListener('click', () => game.goToMenu());
stopTouch(giveupBtn);

// Store: build tiles once, wire buy/equip (game decides which), re-render.
game.hud.buildStore(async (slot, id) => {
  const state = await game.storeSelect(slot, id);
  game.hud.renderStore(state);
});
const menuStore = document.getElementById('menu-store');
menuStore.addEventListener('click', () => game.goToStore());
stopTouch(menuStore);

const storeBack = document.getElementById('store-back');
storeBack.addEventListener('click', () => game.goToMenu());
stopTouch(storeBack);

// Commit the staged Lab configuration (buys anything unowned).
const storeCheckout = document.getElementById('store-checkout');
storeCheckout.addEventListener('click', async () => {
  game.hud.renderStore(await game.checkout());
});
stopTouch(storeCheckout);

const menuRanked = document.getElementById('menu-ranked');
menuRanked.addEventListener('click', () => game.startRun('ranked'));
stopTouch(menuRanked);

const menuFree = document.getElementById('menu-free');
menuFree.addEventListener('click', () => game.startRun('casual'));
stopTouch(menuFree);

const menuHowto = document.getElementById('menu-howto');
menuHowto.addEventListener('click', () => game.goToHowto());
stopTouch(menuHowto);

// Mute toggle (persists; icon reflects state). Also unlocks audio on first tap.
const muteBtn = document.getElementById('mute-btn');
muteBtn.textContent = game.audio.muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', () => {
  game.audio.resume();
  muteBtn.textContent = game.audio.toggleMute() ? '🔇' : '🔊';
});
stopTouch(muteBtn);

const howtoBack = document.getElementById('howto-back');
howtoBack.addEventListener('click', () => game.goToMenu());
stopTouch(howtoBack);

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
stopTouch(installBtn);

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
