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

// ---- Character + board selector (menu screen) ----
// Swatch buttons that recolor the live skater and persist the choice. The
// skater is on-screen behind the menu, so picks preview instantly.
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function buildSwatches(containerId, items, colorOf, getActive, onPick) {
  const wrap = document.getElementById(containerId);
  const buttons = items.map((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.style.background = hex(colorOf(item));
    btn.title = item.name;
    // Hoverboards glow in the picker too (via --glow so .active still styles).
    if (item.ride === 'hover') {
      btn.classList.add('swatch-hover');
      btn.style.setProperty('--glow', hex(item.glow));
    }
    btn.addEventListener('click', () => {
      onPick(i);
      refresh();
    });
    wrap.appendChild(btn);
    return btn;
  });
  // Swallow touch on the selector so a tap doesn't also start the run.
  for (const type of ['touchstart', 'touchend']) {
    wrap.addEventListener(type, (e) => e.stopPropagation());
  }
  function refresh() {
    const active = getActive();
    buttons.forEach((b, i) => b.classList.toggle('active', i === active));
  }
  refresh();
}

buildSwatches('char-options', CONFIG.characters, (c) => c.colors.shirt,
  () => game.charIndex, (i) => game.selectCharacter(i));
buildSwatches('board-options', CONFIG.boards, (b) => (b.ride === 'hover' ? b.glow : b.deck),
  () => game.boardIndex, (i) => game.selectBoard(i));

// Keep taps on UI controls from also reaching the window touch handler (which
// would queue a spurious "start"/jump).
function stopTouch(el) {
  for (const type of ['touchstart', 'touchend']) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

// Screen navigation: select → start, and start → back to selection.
const selectGo = document.getElementById('select-go');
selectGo.addEventListener('click', () => game.goToMenu());
stopTouch(selectGo);

const menuChange = document.getElementById('menu-change');
menuChange.addEventListener('click', () => game.goToSelect());
stopTouch(menuChange);

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
