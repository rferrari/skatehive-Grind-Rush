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

// Skate Lab dashboard bars: how each loadout stat maps to a 0–100% fill.
// min = stock value, max = best part in the catalog (trickSpeed inverts:
// lower multiplier = faster spins = fuller bar).
const STAT_BARS = [
  { key: 'speedMul', label: 'MAX SPEED', min: 1, max: 1.25 },
  { key: 'handlingMul', label: 'HANDLING', min: 1, max: 1.3 },
  { key: 'balanceMul', label: 'GRIND GRIP', min: 1, max: 1.25 },
  { key: 'scoreMul', label: 'SCORE BONUS', min: 1, max: 1.25 },
  { key: 'trickSpeedMul', label: 'SPIN SPEED', min: 1, max: 0.7 },
  { key: 'trickScoreMul', label: 'TRICK PAYOUT', min: 1, max: 1.35 },
];

export class Hud {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      score: document.getElementById('score'),
      coins: document.getElementById('coins'),
      level: document.getElementById('level'),
      speed: document.getElementById('speed'),
      grind: document.getElementById('grind-ticker'),
      balance: document.getElementById('balance'),
      balanceNeedle: document.getElementById('balance-needle'),
      trick: document.getElementById('trick-ticker'),
      toast: document.getElementById('level-toast'),
      effects: document.getElementById('effects'),
      boostTrack: document.getElementById('boost-track'),
      boostFill: document.getElementById('boost-fill'),
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
      storeDash: document.getElementById('store-dash'),
      storeFree: document.getElementById('store-free'),
    };
    this.lastScore = -1;
    this.lastCoins = -1;
    this.lastLevel = 0;
    this.lastSpeed = -1;
    this.lastEffects = '';
    this.lastBoost = -1;
    this.trickTimer = null;
    this.toastTimer = null;
    this.storeTiles = null; // built lazily by buildStore()
  }

  // Nitro meter: fill width tracks the charge; the bar glows while burning.
  showBoost(value, surging) {
    const pct = Math.round(value * 50) * 2; // 2% steps to avoid style churn
    if (pct !== this.lastBoost) {
      this.el.boostFill.style.width = `${pct}%`;
      this.lastBoost = pct;
    }
    this.el.boostTrack.classList.toggle('surge', surging);
    this.el.boostTrack.classList.toggle('ready', !surging && value >= 0.34);
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

  // player is null on the game-over screen (hides the balance bar). `speed` is
  // the current world speed (units/s) shown as a stylized MPH readout.
  update(score, coins, player, level, speed = 0) {
    const s = Math.floor(score);
    if (s !== this.lastScore) {
      this.el.score.textContent = s;
      this.lastScore = s;
    }
    const mph = Math.round(speed * 3); // arcade units → punchy MPH-ish number
    if (mph !== this.lastSpeed) {
      this.el.speed.firstChild.textContent = `${mph} `;
      this.lastSpeed = mph;
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

  // ------------------------------------------------------------ skate lab ---
  // Build once: stat-bar dashboard + character row + part slots. onSelect
  // (slot, id) fires on tap; renderStore() re-styles tiles and animates bars.
  buildStore(onSelect) {
    // Dashboard bars.
    this.dashBars = {};
    this.el.storeDash.innerHTML = '';
    for (const spec of STAT_BARS) {
      const row = document.createElement('div');
      row.className = 'dash-row';
      row.innerHTML =
        `<span class="dash-label">${spec.label}</span>` +
        `<span class="dash-track"><span class="dash-fill"></span></span>` +
        `<span class="dash-delta"></span>`;
      this.el.storeDash.appendChild(row);
      this.dashBars[spec.key] = {
        fill: row.querySelector('.dash-fill'),
        delta: row.querySelector('.dash-delta'),
        spec,
      };
    }

    const stopTouch = (el) => {
      for (const type of ['touchstart', 'touchend']) el.addEventListener(type, (e) => e.stopPropagation());
    };
    const makeTile = (chipColor, name, statText, onTap) => {
      const t = document.createElement('button');
      t.className = 'store-tile';
      t.innerHTML =
        `<span class="tile-chip" style="background:${chipColor}"></span>` +
        `<span class="tile-name">${name}</span>` +
        (statText ? `<span class="tile-stat">${statText}</span>` : '') +
        `<span class="tile-cost"></span>`;
      t.addEventListener('click', onTap);
      stopTouch(t);
      return t;
    };

    this.storeTiles = {};
    this.el.storeSlots.innerHTML = '';

    // Character row (free cosmetics, Session-style preset picker).
    const charRow = document.createElement('div');
    charRow.className = 'store-row';
    charRow.innerHTML = `<span class="sel-label">SKATER</span>`;
    const charTiles = document.createElement('div');
    charTiles.className = 'store-tiles';
    this.storeTiles.character = CONFIG.characters.map((c, i) => {
      const t = makeTile(hex(c.colors.shirt), c.name, '', () => onSelect('character', i));
      charTiles.appendChild(t);
      return t;
    });
    charRow.appendChild(charTiles);
    this.el.storeSlots.appendChild(charRow);

    // Part slots.
    for (const slot of PART_SLOTS) {
      const row = document.createElement('div');
      row.className = 'store-row';
      row.innerHTML = `<span class="sel-label">${SLOT_LABELS[slot]}</span>`;
      const tiles = document.createElement('div');
      tiles.className = 'store-tiles';
      this.storeTiles[slot] = CONFIG.parts[slot].map((part) => {
        const swatch = slot === 'deck' ? (part.glow ?? part.deck) : part.cosmetic.color;
        const t = makeTile(hex(swatch), part.name, SLOT_STAT[slot](part.stats), () =>
          onSelect(slot, part.id));
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
    this.el.storeFree.classList.toggle('hidden', !state.free);

    // Animate the dashboard to the equipped loadout's stats.
    for (const { fill, delta, spec } of Object.values(this.dashBars)) {
      const v = state.stats[spec.key] ?? 1;
      const t = Math.max(0, Math.min(1, (v - spec.min) / (spec.max - spec.min)));
      fill.style.width = `${Math.round(12 + t * 88)}%`; // floor so stock is visible
      const pct = spec.key === 'trickSpeedMul' ? Math.round((1 - v) * 100) : Math.round((v - 1) * 100);
      delta.textContent = pct > 0 ? `+${pct}%` : 'STOCK';
      delta.classList.toggle('boosted', pct > 0);
    }

    // Character tiles.
    this.storeTiles.character.forEach((tile, i) => {
      const equipped = i === state.charIndex;
      tile.classList.toggle('equipped', equipped);
      tile.querySelector('.tile-cost').textContent = equipped ? 'RIDING' : 'PICK';
    });

    // Part tiles (free-test mode: everything equips, no prices).
    for (const slot of PART_SLOTS) {
      CONFIG.parts[slot].forEach((part, i) => {
        const tile = this.storeTiles[slot][i];
        const owned = state.owned[slot][i];
        const equipped = state.equipped[slot] === part.id;
        tile.classList.toggle('owned', owned && !equipped);
        tile.classList.toggle('equipped', equipped);
        const affordable = owned || part.cost <= state.balance;
        tile.classList.toggle('locked', !state.free && !affordable);
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
