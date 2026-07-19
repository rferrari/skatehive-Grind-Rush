// AudioManager: WebAudio-synthesized skate SFX (zero downloads, works offline)
// plus an HTMLAudio music playlist. All synth, so sound is ON immediately;
// music plays whatever mp3s exist under /audio/music/ (see MUSIC_TRACKS) and
// silently skips any that are missing.
//
// Browsers block audio until a user gesture — call resume() from the first
// tap/space (game start), which also kicks off the music.
const MUTE_KEY = 'skatehive-muted';

// Playlist order: 3 rap then 3 punk (all Pixabay/CC0, commercial-safe — see
// README credits). Drop the files in public/audio/music/ to activate; missing
// files are skipped so the game runs silent-but-fine without them.
export const MUSIC_TRACKS = [
  'rap-1.mp3', 'rap-2.mp3', 'rap-3.mp3',
  'punk-1.mp3', 'punk-2.mp3', 'punk-3.mp3',
];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.started = false;
    this.trackIndex = 0;
    this.errorStreak = 0;
    this.music = null;
  }

  // Create the context + node graph on the first user gesture.
  resume() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);

    // Shared noise buffer for rolling/grind/impacts.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Persistent rolling-wheels loop (gain rides with speed).
    this.roll = this._loopNoise(0, 420, 'lowpass');
    // Persistent grind loop (starts silent).
    this.grind = this._loopNoise(0, 1800, 'bandpass', 900);
  }

  _loopNoise(gain, freq, type, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start();
    return { g, filter };
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
    if (this.music) this.music.muted = m;
    return m;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  // Per-frame drive for the continuous loops.
  update(dt, { rolling, speedT, grinding, balance }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rollTarget = rolling ? 0.06 + speedT * 0.14 : 0;
    this.roll.g.gain.setTargetAtTime(rollTarget, t, 0.08);
    this.roll.filter.frequency.setTargetAtTime(300 + speedT * 900, t, 0.1);
    const grindTarget = grinding ? 0.16 : 0;
    this.grind.g.gain.setTargetAtTime(grindTarget, t, 0.03);
    if (grinding) {
      // Brighter/edgier the more the balance tips — audible danger cue.
      this.grind.filter.frequency.setTargetAtTime(1400 + Math.abs(balance) * 2600, t, 0.05);
    }
  }

  // ------------------------------------------------------------ one-shots ---
  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'ollie': return this._blip(240, 620, 0.09, 'triangle');
      case 'launch': return this._blip(200, 900, 0.28, 'sawtooth');
      case 'trick': return this._blip(520, 880, 0.12, 'square', 0.15);
      case 'bearing': return this._blip(1040, 1560, 0.09, 'sine', 0.25);
      case 'boost': return this._sweep(300, 1400, 0.35);
      case 'land': return this._thud(0.12, 260);
      case 'bail': this._thud(0.25, 140); return this._blip(320, 60, 0.4, 'sawtooth');
      default: return undefined;
    }
  }

  _blip(f0, f1, dur, type = 'sine', vol = 0.3) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _sweep(f0, f1, dur) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _thud(dur, freq) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // --------------------------------------------------------------- music ---
  playMusic() {
    if (this.started || typeof Audio === 'undefined') return;
    this.started = true;
    this.music = new Audio();
    this.music.muted = this.muted;
    this.music.volume = 0.55;
    this.music.addEventListener('ended', () => this.nextTrack());
    this.music.addEventListener('error', () => {
      // Missing file → skip on. Stop after a full failed pass (no files yet).
      this.errorStreak++;
      if (this.errorStreak <= MUSIC_TRACKS.length) this.nextTrack();
    });
    this._loadTrack(0);
  }

  _loadTrack(i) {
    if (!this.music) return;
    this.trackIndex = (i + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    this.music.src = `/audio/music/${MUSIC_TRACKS[this.trackIndex]}`;
    const p = this.music.play();
    if (p) p.then(() => { this.errorStreak = 0; }).catch(() => {});
  }

  nextTrack() {
    if (this.music) this._loadTrack(this.trackIndex + 1);
  }
}
