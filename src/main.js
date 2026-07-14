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

function buildSwatches(containerId, items, colorOf, getActive, onPick, isLocked = null) {
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
    buttons.forEach((b, i) => {
      b.classList.toggle('active', i === active);
      if (isLocked) b.classList.toggle('locked', isLocked(items[i]));
    });
  }
  refresh();
}

buildSwatches('char-options', CONFIG.characters, (c) => c.colors.shirt,
  () => game.charIndex, (i) => game.selectCharacter(i));

// Board row: owned decks equip; locked ones show their price and point at the
// store. The info line under the swatches explains whichever was tapped.
function boardInfoFor(deck) {
  if (game.ledger.owns('deck', deck.id)) {
    const equipped = game.ledger.getEquipped('deck') === deck.id;
    return equipped ? `${deck.name} — equipped ✓` : `${deck.name} — tap to equip`;
  }
  return `🔒 ${deck.name} — ⚙️ ${deck.cost} in the store`;
}
buildSwatches('board-options', CONFIG.boards, (b) => (b.ride === 'hover' ? b.glow : b.deck),
  () => game.boardIndex,
  (i) => {
    game.selectBoard(i);
    game.hud.showBoardInfo(boardInfoFor(CONFIG.boards[i]));
  },
  (b) => !game.ledger.owns('deck', b.id));

// Keep taps on UI controls from also reaching the window touch handler (which
// would queue a spurious "start"/jump).
function stopTouch(el) {
  for (const type of ['touchstart', 'touchend']) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

// Screen navigation: menu → char select → board select → back to menu.
const menuChange = document.getElementById('menu-change');
menuChange.addEventListener('click', () => game.goToSelectChar());
stopTouch(menuChange);

const charNext = document.getElementById('char-next');
charNext.addEventListener('click', () => {
  game.hud.showBoardInfo(boardInfoFor(CONFIG.boards[game.boardIndex]));
  game.goToSelectBoard();
});
stopTouch(charNext);

const boardBack = document.getElementById('board-back');
boardBack.addEventListener('click', () => game.goToSelectChar());
stopTouch(boardBack);

const boardDone = document.getElementById('board-done');
boardDone.addEventListener('click', () => game.goToMenu());
stopTouch(boardDone);

const boardStore = document.getElementById('board-store');
boardStore.addEventListener('click', () => game.goToStore());
stopTouch(boardStore);

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

const menuRanked = document.getElementById('menu-ranked');
menuRanked.addEventListener('click', () => game.startRun('ranked'));
stopTouch(menuRanked);

const menuFree = document.getElementById('menu-free');
menuFree.addEventListener('click', () => game.startRun('casual'));
stopTouch(menuFree);

const menuHowto = document.getElementById('menu-howto');
menuHowto.addEventListener('click', () => game.goToHowto());
stopTouch(menuHowto);

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
