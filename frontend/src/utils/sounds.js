/**
 * Sound effects for DegenTrades.
 *
 * Chrome loses the user-gesture context at the first `await`, so we can't
 * create a new AudioContext after an API call. Instead we keep ONE shared
 * context that is created (and therefore unlocked) synchronously on the
 * first user click, then reused for every subsequent sound.
 *
 * Call primeAudio() at the TOP of any click handler (before any await)
 * to ensure the context is running by the time playBuy/playSell fires.
 */

let _ctx = null;

function ctx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function tone(ac, { freq, freq2, start, duration, volume = 0.2, type = 'sine' }) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freq2) osc.frequency.linearRampToValueAtTime(freq2, start + duration * 0.6);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.start(start);
  osc.stop(start + duration);
}

/** Must be called synchronously inside a click handler (before any await). */
export function primeAudio() {
  try { ctx(); } catch (_) {}
}

/** 🟢 Buy — ascending double-ding */
export function playBuy() {
  try {
    const ac = ctx();
    const t  = ac.currentTime;
    tone(ac, { freq: 523, freq2: 1047, start: t,        duration: 0.25, volume: 0.22 });
    tone(ac, { freq: 784, freq2: 1047, start: t + 0.15, duration: 0.20, volume: 0.13 });
  } catch (e) { console.warn('[sound] buy:', e); }
}

/** 🔴 Sell — descending tone */
export function playSell() {
  try {
    const ac = ctx();
    const t  = ac.currentTime;
    tone(ac, { freq: 659, freq2: 440, start: t,        duration: 0.25, volume: 0.18 });
    tone(ac, { freq: 440, freq2: 330, start: t + 0.15, duration: 0.20, volume: 0.10 });
  } catch (e) { console.warn('[sound] sell:', e); }
}

/** 💀 Rug (optional) */
export function playRug() {
  try {
    const ac = ctx();
    tone(ac, { freq: 110, freq2: 55, start: ac.currentTime, duration: 0.5, volume: 0.20, type: 'sawtooth' });
  } catch (e) {}
}
