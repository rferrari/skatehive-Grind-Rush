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
import { CONFIG, PART_SLOTS, DEFAULT_LOADOUT, partById } from './config.js';

const KEYS = {
  wallet: 'skatehive-wallet', // reused from the pre-economy wallet
  owned: 'skatehive-owned',
  equipped: 'skatehive-equipped',
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
    // Owned parts always include the free starter loadout.
    this.owned = new Set([
      ...Object.entries(DEFAULT_LOADOUT).map(([slot, id]) => `${slot}:${id}`),
      ...this._json(KEYS.owned, []),
    ]);
    this.equipped = { ...DEFAULT_LOADOUT, ...this._json(KEYS.equipped, {}) };
    // Drop any equipped part that isn't owned (e.g. catalog changed).
    for (const slot of PART_SLOTS) {
      if (!this.owns(slot, this.equipped[slot])) this.equipped[slot] = DEFAULT_LOADOUT[slot];
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

  // Plain spend (e.g. continues). Store purchases go through buy() so the pot
  // cut is applied there, not on every spend.
  async spend(amount, _reason = '') {
    if (amount > this.wallet) return { ok: false, balance: this.wallet };
    this.wallet -= amount;
    this._save(KEYS.wallet, String(this.wallet));
    return { ok: true, balance: this.wallet };
  }

  // ----------------------------------------------------------- inventory ---
  owns(slot, id) {
    return this.unlockAll || this.owned.has(`${slot}:${id}`);
  }

  async buy(slot, id) {
    const part = partById(slot, id);
    if (this.owns(slot, id)) return { ok: false, reason: 'owned' };
    if (part.cost > this.wallet) return { ok: false, reason: 'poor' };
    await this.spend(part.cost, `buy ${id}`);
    this._addPot(part.cost * CONFIG.potCutPct);
    this.owned.add(`${slot}:${id}`);
    this._save(KEYS.owned, [...this.owned]);
    return { ok: true, balance: this.wallet };
  }

  getLoadout() {
    return { ...this.equipped };
  }
  getEquipped(slot) {
    return this.equipped[slot];
  }

  async equip(slot, id) {
    if (!this.owns(slot, id)) return { ok: false };
    this.equipped[slot] = id;
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
