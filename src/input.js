// Keyboard + touch swipe, normalized to a queue of action strings:
// 'left' | 'right' | 'jump' | 'slide' | 'start'
// plus air tricks: 'kickflip' | 'heelflip' | 'shuvit'
const SWIPE_THRESHOLD = 30; // px

export class Input {
  constructor() {
    this.queue = [];
    this.touchStart = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          this.queue.push('left');
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.queue.push('right');
          break;
        case 'ArrowUp':
        case 'KeyW':
          this.queue.push('jump');
          break;
        case 'Space':
          this.queue.push('jump', 'start');
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.queue.push('slide');
          break;
        case 'KeyZ':
        case 'KeyJ':
          this.queue.push('kickflip');
          break;
        case 'KeyX':
        case 'KeyK':
          this.queue.push('heelflip');
          break;
        case 'KeyC':
        case 'KeyL':
          this.queue.push('shuvit');
          break;
        default:
          return;
      }
      e.preventDefault();
    });

    addEventListener(
      'touchstart',
      (e) => {
        if (e.target.closest('#install-btn')) return; // button taps aren't game input
        const t = e.changedTouches[0];
        this.touchStart = { x: t.clientX, y: t.clientY };
      },
      { passive: true }
    );

    addEventListener(
      'touchend',
      (e) => {
        if (!this.touchStart) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - this.touchStart.x;
        const dy = t.clientY - this.touchStart.y;
        this.touchStart = null;
        if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
          this.queue.push('jump', 'start'); // tap
        } else if (Math.abs(dx) > Math.abs(dy)) {
          this.queue.push(dx > 0 ? 'right' : 'left');
        } else {
          this.queue.push(dy > 0 ? 'slide' : 'jump');
        }
      },
      { passive: true }
    );
  }

  // Drain and return all actions queued since the last poll.
  poll() {
    const actions = this.queue;
    this.queue = [];
    return actions;
  }
}
