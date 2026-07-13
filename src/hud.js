// DOM overlay: score readouts, level indicator, trick/level toasts, the
// grind balance bar, menu and game-over screens, high score persistence.
const HISCORE_KEY = 'skatehive-runner-highscore';

export class Hud {
  constructor() {
    this.el = {
      score: document.getElementById('score'),
      coins: document.getElementById('coins'),
      level: document.getElementById('level'),
      grind: document.getElementById('grind-ticker'),
      balance: document.getElementById('balance'),
      balanceNeedle: document.getElementById('balance-needle'),
      trick: document.getElementById('trick-ticker'),
      toast: document.getElementById('level-toast'),
      menu: document.getElementById('menu'),
      menuHiscore: document.getElementById('menu-hiscore'),
      gameover: document.getElementById('gameover'),
      finalScore: document.getElementById('final-score'),
      goHiscore: document.getElementById('go-hiscore'),
      newRecord: document.getElementById('new-record'),
    };
    this.lastScore = -1;
    this.lastCoins = -1;
    this.lastLevel = 0;
    this.trickTimer = null;
    this.toastTimer = null;
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
      this.el.coins.textContent = `🛹 ${coins}`;
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

  showMenu() {
    this.el.menuHiscore.textContent = this.loadHighScore();
    this.el.menu.classList.remove('hidden');
    this.el.gameover.classList.add('hidden');
  }

  showGameOver(score, highScore, isRecord) {
    this.el.finalScore.textContent = Math.floor(score);
    this.el.goHiscore.textContent = highScore;
    this.el.newRecord.classList.toggle('hidden', !isRecord);
    this.el.gameover.classList.remove('hidden');
  }

  hideOverlays() {
    this.el.menu.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.trick.classList.add('hidden');
    this.el.toast.classList.add('hidden');
  }
}
