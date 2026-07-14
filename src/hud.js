// DOM overlay: score readouts, level indicator, trick/level toasts, the
// grind balance bar, menu / store / game-over screens, high score persistence.
import { CONFIG, PART_SLOTS, partById } from './config.js';

const HISCORE_KEY = 'skatehive-runner-highscore';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const SLOT_LABELS = { deck: 'DECK', wheels: 'WHEELS', trucks: 'TRUCKS', spinners: 'SPINNERS' };
// One representative stat per slot for the tile readout.
const SLOT_STAT = {
  deck: (s) => `score ×${s.scoreMul ?? 1}`,
  wheels: (s) => `speed ×${s.speedMul ?? 1}`,
  trucks: (s) => `grip ×${s.handlingMul ?? 1}`,
  spinners: (s) => `trick ×${s.trickScoreMul ?? 1}`,
};

export class Hud {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      score: document.getElementById('score'),
      coins: document.getElementById('coins'),
      level: document.getElementById('level'),
      grind: document.getElementById('grind-ticker'),
      balance: document.getElementById('balance'),
      balanceNeedle: document.getElementById('balance-needle'),
      trick: document.getElementById('trick-ticker'),
      toast: document.getElementById('level-toast'),
      effects: document.getElementById('effects'),
      loading: document.getElementById('loading'),
      loadingBar: document.getElementById('loading-bar'),
      selectChar: document.getElementById('select-char'),
      selectBoard: document.getElementById('select-board'),
      boardInfo: document.getElementById('board-info'),
      howto: document.getElementById('howto'),
      menu: document.getElementById('menu'),
      menuHiscore: document.getElementById('menu-hiscore'),
      gameover: document.getElementById('gameover'),
      finalScore: document.getElementById('final-score'),
      goHiscore: document.getElementById('go-hiscore'),
      newRecord: document.getElementById('new-record'),
      menuWallet: document.getElementById('menu-wallet'),
      continueBtn: document.getElementById('continue-btn'),
      goWallet: document.getElementById('go-wallet'),
      goLeaderboard: document.getElementById('go-leaderboard'),
      store: document.getElementById('store'),
      storeSlots: document.getElementById('store-slots'),
      storeBalance: document.getElementById('store-balance'),
      storePot: document.getElementById('store-pot'),
    };
    this.lastScore = -1;
    this.lastCoins = -1;
    this.lastLevel = 0;
    this.lastEffects = '';
    this.trickTimer = null;
    this.toastTimer = null;
    this.storeTiles = null; // built lazily by buildStore()
  }

  // Active powerup readout under the score (e.g. "🧲 4s · ⭐ 6s").
  showEffects(effects) {
    const icons = { magnet: '🧲', shield: '🛡', score2: '⭐', oil: '🛢' };
    const text = Object.entries(effects)
      .filter(([, t]) => t > 0)
      .map(([k, t]) => `${icons[k]} ${Math.ceil(t)}s`)
      .join(' · ');
    if (text !== this.lastEffects) {
      this.el.effects.textContent = text;
      this.lastEffects = text;
    }
  }

  loadHighScore() {
    return Number(localStorage.getItem(HISCORE_KEY)) || 0;
  }

  saveHighScore(score) {
    localStorage.setItem(HISCORE_KEY, String(score));
  }

  // player is null on the game-over screen (hides the balance bar).
  update(score, coins, player, level) {
    const s = Math.floor(score);
    if (s !== this.lastScore) {
      this.el.score.textContent = s;
      this.lastScore = s;
    }
    if (coins !== this.lastCoins) {
      this.el.coins.textContent = `⚙️ ${coins}`;
      this.lastCoins = coins;
    }
    if (level !== this.lastLevel) {
      this.el.level.textContent = `LVL ${level}`;
      this.lastLevel = level;
    }

    const grinding = Boolean(player?.grinding);
    this.el.grind.classList.toggle('hidden', !grinding);
    this.el.balance.classList.toggle('hidden', !grinding);
    if (grinding) {
      // balance is -1..1 → needle sweeps 5%..95% across the bar.
      const pct = 50 + player.balance * 45;
      this.el.balanceNeedle.style.left = `${pct}%`;
      this.el.balance.classList.toggle('danger', Math.abs(player.balance) > 0.7);
    }
  }

  showTrick(text) {
    this.el.trick.textContent = text;
    this.el.trick.classList.remove('hidden', 'pop');
    void this.el.trick.offsetWidth; // restart the pop animation
    this.el.trick.classList.add('pop');
    clearTimeout(this.trickTimer);
    this.trickTimer = setTimeout(() => this.el.trick.classList.add('hidden'), 1200);
  }

  showToast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden', 'pop');
    void this.el.toast.offsetWidth;
    this.el.toast.classList.add('pop');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), 2200);
  }

  // Show exactly one pre-game screen (or null for none). The in-game HUD
  // (score/level/bearings) only shows when no screen is up — the menus sit
  // over a clean scrolling world.
  showScreen(name) {
    for (const key of ['loading', 'selectChar', 'selectBoard', 'store', 'howto', 'menu', 'gameover']) {
      this.el[key].classList.toggle('hidden', key !== name);
    }
    this.el.hud.classList.toggle('hidden', name !== null);
  }

  showHowto() {
    this.showScreen('howto');
  }

  // Ownership line under the board swatches ("equipped" / "🔒 price").
  showBoardInfo(text) {
    this.el.boardInfo.textContent = text;
  }

  showLoading(progress) {
    this.el.loadingBar.style.width = `${Math.round(progress * 100)}%`;
  }

  showMenu(wallet = null) {
    this.el.menuHiscore.textContent = this.loadHighScore();
    if (wallet !== null) this.el.menuWallet.textContent = `BANK: ⚙️ ${wallet}`;
    this.showScreen('menu');
  }

  // info: { wallet, cost, pot, leaderboard, mode }. CONTINUE shows only when
  // affordable; the pot + top-3 board show on ranked runs.
  showGameOver(score, highScore, isRecord, info = null) {
    this.el.finalScore.textContent = Math.floor(score);
    this.el.goHiscore.textContent = highScore;
    this.el.newRecord.classList.toggle('hidden', !isRecord);
    if (info) {
      this.el.goWallet.textContent = `BANK: ⚙️ ${info.wallet}`;
      const affordable = info.wallet >= info.cost;
      this.el.continueBtn.textContent = `▶ CONTINUE — ⚙️ ${info.cost}`;
      this.el.continueBtn.classList.toggle('hidden', !affordable);

      const ranked = info.mode === 'ranked';
      this.el.goLeaderboard.classList.toggle('hidden', !ranked);
      if (ranked) {
        const rows = (info.leaderboard ?? [])
          .map((e, i) => `<div class="lb-row"><span>${['🥇', '🥈', '🥉'][i] ?? i + 1}</span><span>${e.score}</span></div>`)
          .join('');
        this.el.goLeaderboard.innerHTML =
          `<div class="lb-title">WEEKLY POT ⚙️ ${info.pot} <span class="preview-tag">PREVIEW</span></div>${rows || '<div class="lb-row">be the first!</div>'}`;
      }
    }
    this.showScreen('gameover');
  }

  // ----------------------------------------------------------------- store ---
  // Build tiles once; onSelect(slot, id) is called on tap (game decides buy
  // vs equip). Tiles are re-styled by renderStore().
  buildStore(onSelect) {
    this.storeTiles = {};
    this.el.storeSlots.innerHTML = '';
    for (const slot of PART_SLOTS) {
      const row = document.createElement('div');
      row.className = 'store-row';
      row.innerHTML = `<span class="sel-label">${SLOT_LABELS[slot]}</span>`;
      const tiles = document.createElement('div');
      tiles.className = 'store-tiles';
      this.storeTiles[slot] = CONFIG.parts[slot].map((part) => {
        const t = document.createElement('button');
        t.className = 'store-tile';
        const swatch = slot === 'deck' ? (part.glow ?? part.deck) : part.cosmetic.color;
        t.innerHTML =
          `<span class="tile-chip" style="background:${hex(swatch)}"></span>` +
          `<span class="tile-name">${part.name}</span>` +
          `<span class="tile-stat">${SLOT_STAT[slot](part.stats)}</span>` +
          `<span class="tile-cost"></span>`;
        t.addEventListener('click', () => onSelect(slot, part.id));
        for (const type of ['touchstart', 'touchend']) t.addEventListener(type, (e) => e.stopPropagation());
        tiles.appendChild(t);
        return t;
      });
      row.appendChild(tiles);
      this.el.storeSlots.appendChild(row);
    }
  }

  renderStore(state) {
    this.el.storeBalance.textContent = state.balance;
    this.el.storePot.textContent = state.pot;
    for (const slot of PART_SLOTS) {
      CONFIG.parts[slot].forEach((part, i) => {
        const tile = this.storeTiles[slot][i];
        const owned = state.owned[slot][i];
        const equipped = state.equipped[slot] === part.id;
        tile.classList.toggle('owned', owned && !equipped);
        tile.classList.toggle('equipped', equipped);
        const affordable = owned || part.cost <= state.balance;
        tile.classList.toggle('locked', !affordable);
        tile.querySelector('.tile-cost').textContent = equipped
          ? 'EQUIPPED'
          : owned
            ? 'EQUIP'
            : `⚙️ ${part.cost}`;
      });
    }
  }

  showStore(state) {
    this.renderStore(state);
    this.showScreen('store');
  }

  hideOverlays() {
    this.showScreen(null);
    this.el.trick.classList.add('hidden');
    this.el.toast.classList.add('hidden');
  }
}
