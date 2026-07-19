// DOM overlay: score readouts, level indicator, trick/level toasts, the
// grind balance bar, menu / store / game-over screens, high score persistence.
import { CONFIG, RIDES, RIDE_SLOTS } from './config.js';

const HISCORE_KEY = 'skatehive-runner-highscore';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const RIDE_LABELS = { skate: '🛹 SKATE', hover: '🛸 HOVER' };
const SLOT_LABELS = {
  deck: 'DECK', wheels: 'WHEELS', trucks: 'TRUCKS', spinners: 'SPINNERS',
  thrusters: 'THRUSTERS', maglocks: 'MAG-LOCKS', fluxcore: 'FLUX CORE',
};
// One representative stat per slot for the tile readout.
const SLOT_STAT = {
  deck: (s) => `score ×${s.scoreMul ?? 1}`,
  wheels: (s) => `speed ×${s.speedMul ?? 1}`,
  trucks: (s) => `grip ×${s.handlingMul ?? 1}`,
  spinners: (s) => `trick ×${s.trickScoreMul ?? 1}`,
  thrusters: (s) => `speed ×${s.speedMul ?? 1}`,
  maglocks: (s) => `lock ×${s.handlingMul ?? 1}`,
  fluxcore: (s) => `trick ×${s.trickScoreMul ?? 1}`,
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
  { key: 'slideBrakeMul', label: 'SLIDE BRAKE', min: 0.85, max: 1.45 },
  { key: 'slideLenMul', label: 'SLIDE LENGTH', min: 1, max: 1.5 },
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
      storeCheckout: document.getElementById('store-checkout'),
      boostCount: document.getElementById('boost-count'),
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

  // Energy drinks ⚡: count of full charges + a bar brewing toward the next
  // one. Bar glows when a drink is ready and goes gold while burning.
  showBoost(value, surging) {
    const count = Math.floor(value + 1e-6);
    const frac = count >= CONFIG.boostMax ? 1 : value - count;
    const pct = Math.round(frac * 50) * 2; // 2% steps to avoid style churn
    const key = count * 1000 + pct;
    if (key !== this.lastBoost) {
      this.el.boostFill.style.width = `${pct}%`;
      this.el.boostCount.textContent = `⚡×${count}`;
      this.lastBoost = key;
    }
    this.el.boostTrack.classList.toggle('surge', surging);
    this.el.boostTrack.classList.toggle('ready', !surging && count >= 1);
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
    for (const key of ['loading', 'store', 'howto', 'menu', 'gameover']) {
      this.el[key].classList.toggle('hidden', key !== name);
    }
    this.el.hud.classList.toggle('hidden', name !== null);
  }

  showHowto() {
    this.showScreen('howto');
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

    this.carousels = [];
    this.rideRows = { skate: [], hover: [] };
    this.lastState = null;
    this.el.storeSlots.innerHTML = '';

    // Three sections behind tabs: SKATER (who), CLOTHES (what you wear),
    // RIDE (what you ride).
    this.storeTab = this.storeTab ?? 'skater';
    const tabBar = document.createElement('div');
    tabBar.className = 'store-tabs';
    this.tabBtns = {};
    for (const [key, label] of [['skater', '🧢 SKATER'], ['clothes', '👕 FIT'], ['ride', '🛹 RIDE']]) {
      const b = document.createElement('button');
      b.className = 'store-tab';
      b.textContent = label;
      b.addEventListener('click', () => this.setStoreTab(key));
      stopTouch(b);
      tabBar.appendChild(b);
      this.tabBtns[key] = b;
    }
    this.el.storeSlots.appendChild(tabBar);
    this.sections = {
      skater: document.createElement('div'),
      clothes: document.createElement('div'),
      ride: document.createElement('div'),
    };
    for (const s of Object.values(this.sections)) s.className = 'store-section';

    // Carousel row: ◂ [selected item card] ▸ with a position counter — one
    // fixed-height row per slot, catalog-style, so the panel never becomes an
    // endless scroll as catalogs grow. Arrows browse; for auto-pick rows the
    // centered item IS the staged selection (live turntable preview). Rows
    // with `onCardTap` (skills) browse freely and act on card tap instead.
    const addCarousel = (section, label, cfg) => {
      const row = document.createElement('div');
      row.className = 'car-row';
      row.innerHTML = `<span class="sel-label">${label}</span>`;
      const mk = (cls, text) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = text;
        stopTouch(b);
        return b;
      };
      const prev = mk('car-btn', '◂');
      const card = mk('car-card', '');
      card.innerHTML =
        `<span class="tile-chip"></span>` +
        `<span class="car-mid"><span class="tile-name"></span><span class="tile-stat"></span></span>` +
        `<span class="car-right"><span class="tile-cost"></span><span class="car-pos"></span></span>`;
      const next = mk('car-btn', '▸');
      row.append(prev, card, next);
      this.sections[section].appendChild(row);

      const entry = {
        ...cfg,
        row,
        els: {
          chip: card.querySelector('.tile-chip'),
          name: card.querySelector('.tile-name'),
          stat: card.querySelector('.tile-stat'),
          cost: card.querySelector('.tile-cost'),
          pos: card.querySelector('.car-pos'),
          card,
        },
      };
      const step = (dir) => {
        const i = (entry.indexOf(this.lastState) + dir + cfg.items.length) % cfg.items.length;
        cfg.onArrow(i);
      };
      prev.addEventListener('click', () => step(-1));
      next.addEventListener('click', () => step(1));
      if (cfg.onCardTap) card.addEventListener('click', () => cfg.onCardTap(entry.indexOf(this.lastState)));
      this.carousels.push(entry);
      return entry;
    };

    // -- SKATER section: preset, stance, skills.
    addCarousel('skater', 'PRESET', {
      items: CONFIG.characters,
      indexOf: (s) => s.charIndex,
      onArrow: (i) => onSelect('character', i),
      render: (c) => ({ chip: hex(c.colors.shirt), name: c.name, stat: '', cost: 'RIDING' }),
    });
    addCarousel('skater', 'STANCE', {
      items: CONFIG.stances,
      indexOf: (s) => Math.max(0, CONFIG.stances.indexOf(s.stance)),
      onArrow: (i) => onSelect('stance', CONFIG.stances[i]),
      render: (stance) => ({
        chip: null,
        name: stance.toUpperCase(),
        stat: stance === 'goofy' ? 'kick/heel inputs swap' : 'natural lead foot',
        cost: 'RIDING',
      }),
    });
    // Skills browse with arrows; tapping the card learns / un-carts.
    const skillBrowse = { i: 0 };
    addCarousel('skater', 'SKILLS', {
      items: CONFIG.skills,
      indexOf: () => skillBrowse.i,
      onArrow: (i) => {
        skillBrowse.i = i;
        this.renderStore(this.lastState);
      },
      onCardTap: (i) => onSelect('skill', CONFIG.skills[i].id),
      render: (skill, i, state) => {
        const s = state.skills[i];
        return {
          chip: null,
          name: skill.name,
          stat: skill.desc,
          cost: s.owned
            ? 'OWNED'
            : s.staged
              ? state.free ? 'OWNED' : `IN CART ⚙️ ${skill.cost}`
              : state.free || skill.cost === 0 ? 'TAP TO LEARN' : `TAP · ⚙️ ${skill.cost}`,
          active: s.owned || s.staged,
        };
      },
    });

    // -- FIT section: brand first, then the color slots.
    for (const slot of ['brand', 'shirt', 'pants', 'cap']) {
      addCarousel('clothes', slot.toUpperCase(), {
        items: CONFIG.outfits[slot],
        indexOf: (s) => s.outfit[slot],
        onArrow: (i) => onSelect(slot, i),
        render: (item) => ({
          chip: item.color == null ? null : hex(item.color),
          name: item.logo && item.logo.length <= 3 ? `${item.logo} ${item.name}` : item.name,
          stat: '',
          cost: 'WORN',
        }),
      });
    }

    // -- RIDE section: ride type + that ride's part slots.
    addCarousel('ride', 'TYPE', {
      items: RIDES,
      indexOf: (s) => Math.max(0, RIDES.indexOf(s.ride)),
      onArrow: (i) => onSelect('ride', RIDES[i]),
      render: (ride) => ({ chip: null, name: RIDE_LABELS[ride], stat: '', cost: 'ACTIVE' }),
    });
    for (const ride of RIDES) {
      for (const slot of RIDE_SLOTS[ride]) {
        const items = CONFIG.parts[ride][slot];
        const entry = addCarousel('ride', SLOT_LABELS[slot], {
          items,
          indexOf: (s) => Math.max(0, items.findIndex((p) => p.id === s.equipped[ride][slot])),
          onArrow: (i) => onSelect(slot, items[i].id),
          render: (part, i, state) => {
            const owned = state.owned[ride][slot][i];
            return {
              chip: hex(slot === 'deck' ? (part.glow ?? part.deck) : part.cosmetic.color),
              name: part.name,
              stat: SLOT_STAT[slot](part.stats),
              cost: owned || state.free ? 'EQUIPPED' : `IN CART ⚙️ ${part.cost}`,
            };
          },
        });
        this.rideRows[ride].push(entry.row);
      }
    }

    this.el.storeSlots.appendChild(this.sections.skater);
    this.el.storeSlots.appendChild(this.sections.clothes);
    this.el.storeSlots.appendChild(this.sections.ride);
    this.setStoreTab(this.storeTab);
  }

  setStoreTab(key) {
    this.storeTab = key;
    for (const [k, section] of Object.entries(this.sections)) {
      section.classList.toggle('hidden', k !== key);
      this.tabBtns[k].classList.toggle('active', k === key);
    }
  }

  renderStore(state) {
    this.lastState = state; // arrows step relative to the latest snapshot
    this.el.storeBalance.textContent = state.balance;
    this.el.storePot.textContent = state.pot;
    this.el.storeFree.classList.toggle('hidden', !state.free);

    // Checkout button: nothing staged/unpaid → APPLY; else show the total.
    const btn = this.el.storeCheckout;
    if (state.free || state.cartTotal === 0) {
      btn.textContent = 'APPLY ✓';
      btn.disabled = false;
    } else {
      btn.textContent = `CHECKOUT — ⚙️ ${state.cartTotal}`;
      btn.disabled = !state.canAfford;
    }

    // Animate the dashboard to the staged loadout's stats.
    for (const { fill, delta, spec } of Object.values(this.dashBars)) {
      const v = state.stats[spec.key] ?? 1;
      const t = Math.max(0, Math.min(1, (v - spec.min) / (spec.max - spec.min)));
      fill.style.width = `${Math.round(12 + t * 88)}%`; // floor so stock is visible
      const pct = spec.key === 'trickSpeedMul' ? Math.round((1 - v) * 100) : Math.round((v - 1) * 100);
      delta.textContent = pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : 'STOCK';
      delta.classList.toggle('boosted', pct > 0);
    }

    // Only the active ride's gear carousels show.
    for (const ride of RIDES) {
      for (const row of this.rideRows[ride]) row.classList.toggle('hidden', ride !== state.ride);
    }

    // Update every carousel card to its current item.
    for (const c of this.carousels) {
      const i = c.indexOf(state);
      const item = c.items[i];
      if (!item) continue;
      const r = c.render(item, i, state);
      c.els.chip.style.background = r.chip ?? 'transparent';
      c.els.chip.classList.toggle('hidden', r.chip == null);
      c.els.name.textContent = r.name;
      c.els.stat.textContent = r.stat ?? '';
      c.els.cost.textContent = r.cost ?? '';
      c.els.pos.textContent = `${i + 1}/${c.items.length}`;
      c.els.card.classList.toggle('equipped', r.active ?? true);
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
