/**
 * Lightweight Web Audio API sound effects for DegenTrades.
 * No files — all synthesized. AudioContext is created lazily on first call.
 */

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Resume if suspended (browsers require user gesture first)
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function playTone({ freq, freq2, duration = 0.35, volume = 0.25, type = 'sine', delay = 0 }) {
  try {
    const c    = getCtx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    if (freq2) osc.frequency.linearRampToValueAtTime(freq2, c.currentTime + delay + duration * 0.6);

    gain.gain.setValueAtTime(0, c.currentTime + delay);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);

    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration);
  } catch (_) {}
}

/** 🟢 Buy — bright ascending double-ding */
export function playBuy() {
  playTone({ freq: 523, freq2: 784, duration: 0.3, volume: 0.20, type: 'sine' });        // C5 → G5
  playTone({ freq: 784, freq2: 1047, duration: 0.25, volume: 0.12, type: 'sine', delay: 0.18 }); // G5 → C6
}

/** 🔴 Sell — neutral descending tone */
export function playSell() {
  playTone({ freq: 659, freq2: 494, duration: 0.3, volume: 0.18, type: 'sine' });        // E5 → B4
  playTone({ freq: 494, freq2: 392, duration: 0.25, volume: 0.10, type: 'sine', delay: 0.15 }); // B4 → G4
}

/** 💀 Rug — low rumble */
export function playRug() {
  playTone({ freq: 120, freq2: 60, duration: 0.6, volume: 0.22, type: 'sawtooth' });
}
