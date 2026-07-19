// Ledger — the single source of truth for coins, part ownership, the equipped
// loadout, the prize pot, and the leaderboard.
//
// The API is async even though LocalLedger is backed by synchronous
// localStorage, so a networked adapter can drop in later WITHOUT changing any
// caller. Read methods (getBalance/owns/getLoadout/getPot/getLeaderboard) stay
// sync for cheap rendering; anything that mutates value is async.
//
// TRUST BOUNDARY: LocalLedger is client-side and therefore NOT authoritative —
// a user can edit localStorage. That is fine while coins are cosmetic/offline.
// Before real tokens or a shared pot exist, replace LocalLedger with:
//   • Phase 2  ApiLedger  — same interface, talks to a backend that owns the
//     real balances/inventory/pot/leaderboard and validates run results.
//   • Phase 3  HiveLedger — aioha login links a Hive account; withdraw() cashes
//     off-chain coins to on-chain tokens; a weekly job settles the pot to the
//     top 3. connectHive()/withdraw() below mark those seams.
import { CONFIG, RIDES, RIDE_SLOTS, DEFAULT_LOADOUT, partById } from './config.js';

const KEYS = {
  wallet: 'skatehive-wallet', // reused from the pre-economy wallet
  owned: 'skatehive-owned2', // v2: keys are ride:slot:id (v1 data is dropped)
  equipped: 'skatehive-equipped2', // v2: { ride, skate:{...}, hover:{...} }
  pot: 'skatehive-pot',
  board: 'skatehive-leaderboard',
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LEADERBOARD_MAX = 20;

export class LocalLedger {
  constructor(storage = globalThis.localStorage, { unlockAll = CONFIG.devUnlockAll } = {}) {
    this.s = storage;
    this.unlockAll = unlockAll; // dev free-test mode: everything owned
    this.wallet = this._num(KEYS.wallet, 0);
    this.pot = this._num(KEYS.pot, 0);
    // Owned parts always include the free starter items of BOTH ride types
    // (keyed ride:slot:id).
    const starters = [];
    for (const ride of RIDES) {
      for (const [slot, id] of Object.entries(DEFAULT_LOADOUT[ride])) {
        starters.push(`${ride}:${slot}:${id}`);
      }
    }
    this.owned = new Set([...starters, ...this._json(KEYS.owned, [])]);

    const saved = this._json(KEYS.equipped, {});
    this.equipped = {
      ride: RIDES.includes(saved.ride) ? saved.ride : DEFAULT_LOADOUT.ride,
      skate: { ...DEFAULT_LOADOUT.skate, ...(saved.skate ?? {}) },
      hover: { ...DEFAULT_LOADOUT.hover, ...(saved.hover ?? {}) },
    };
    // Drop any equipped part that isn't owned (e.g. catalog changed).
    for (const ride of RIDES) {
      for (const slot of RIDE_SLOTS[ride]) {
        if (!this.owns(ride, slot, this.equipped[ride][slot])) {
          this.equipped[ride][slot] = DEFAULT_LOADOUT[ride][slot];
        }
      }
    }
    this.board = this._json(KEYS.board, []);
  }

  // eslint-disable-next-line class-methods-use-this
  async ready() {}

  // ------------------------------------------------------------- storage ---
  _num(key, dflt) {
    const v = Number(this.s.getItem(key));
    return Number.isFinite(v) ? v : dflt;
  }
  _json(key, dflt) {
    try {
      return JSON.parse(this.s.getItem(key)) ?? dflt;
    } catch {
      return dflt;
    }
  }
  _save(key, value) {
    this.s.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  // --------------------------------------------------------------- coins ---
  getBalance() {
    return this.wallet;
  }

  async earn(amount, _reason = '') {
    this.wallet += Math.max(0, Math.round(amount));
    this._save(KEYS.wallet, String(this.wallet));
    return this.wallet;
  }

  // Store-style charge for non-part purchases (skills): spend + pot cut.
  async charge(amount, reason = '') {
    const r = await this.spend(amount, reason);
    if (r.ok) this._addPot(amount * CONFIG.potCutPct);
    return r;
  }

  // Plain spend (e.g. continues). Store purchases go through buy() so the pot
  // cut is applied there, not on every spend.
  async spend(amount, _reason = '') {
    if (amount > this.wallet) return { ok: false, balance: this.wallet };
    this.wallet -= amount;
    this._save(KEYS.wallet, String(this.wallet));
    return { ok: true, balance: this.wallet };
  }

  // ----------------------------------------------------------- inventory ---
  owns(ride, slot, id) {
    return this.unlockAll || this.owned.has(`${ride}:${slot}:${id}`);
  }

  async buy(ride, slot, id) {
    const part = partById(ride, slot, id);
    if (this.owns(ride, slot, id)) return { ok: false, reason: 'owned' };
    if (part.cost > this.wallet) return { ok: false, reason: 'poor' };
    await this.spend(part.cost, `buy ${id}`);
    this._addPot(part.cost * CONFIG.potCutPct);
    this.owned.add(`${ride}:${slot}:${id}`);
    this._save(KEYS.owned, [...this.owned]);
    return { ok: true, balance: this.wallet };
  }

  getLoadout() {
    return {
      ride: this.equipped.ride,
      skate: { ...this.equipped.skate },
      hover: { ...this.equipped.hover },
    };
  }
  getRide() {
    return this.equipped.ride;
  }
  getEquipped(ride, slot) {
    return this.equipped[ride][slot];
  }

  async setRide(ride) {
    if (!RIDES.includes(ride)) return { ok: false };
    this.equipped.ride = ride;
    this._save(KEYS.equipped, this.equipped);
    return { ok: true };
  }

  async equip(ride, slot, id) {
    if (!this.owns(ride, slot, id)) return { ok: false };
    this.equipped[ride][slot] = id;
    this._save(KEYS.equipped, this.equipped);
    return { ok: true };
  }

  // ----------------------------------------------------------------- pot ---
  getPot() {
    return Math.round(this.pot);
  }
  _addPot(amount) {
    this.pot += amount;
    this._save(KEYS.pot, String(this.pot));
  }

  // --------------------------------------------------------- leaderboard ---
  // Local mock: top scores in the current weekly window. Non-authoritative —
  // the real ranked board lives server-side in Phase 2.
  getLeaderboard(now = Date.now()) {
    const weekStart = now - (now % WEEK_MS);
    return this.board
      .filter((e) => e.ts >= weekStart)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  async submitScore(entry) {
    if (entry.mode !== 'ranked') return; // only ranked runs are competitive
    this.board.push({ score: Math.floor(entry.score), mode: entry.mode, ts: entry.ts });
    this.board.sort((a, b) => b.score - a.score);
    this.board = this.board.slice(0, LEADERBOARD_MAX);
    this._save(KEYS.board, this.board);
  }

  // ------------------------------------------------ integration seams ------
  // eslint-disable-next-line class-methods-use-this
  async connectHive() {
    throw new Error('Hive connect is coming soon');
  }
  // eslint-disable-next-line class-methods-use-this
  async withdraw() {
    throw new Error('Token withdrawal is coming soon');
  }
}
