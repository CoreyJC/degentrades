/**
 * Pleasant lightweight sound effects for DegenTrades.
 * Shared AudioContext is primed synchronously on click, then reused after async API calls.
 */

let _ctx = null;

function ctx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function tone(ac, { freq, freq2, start, duration, volume = 0.08, type = 'sine' }) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  const filter = ac.createBiquadFilter();

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);

  osc.type = type;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4200, start);
  filter.Q.setValueAtTime(0.6, start);

  osc.frequency.setValueAtTime(freq, start);
  if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, start + duration * 0.45);

  // Soft bell envelope: fast gentle attack, smooth natural decay.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function bell({ base = 880, start = 0, volume = 0.08 } = {}) {
  const ac = ctx();
  const t = ac.currentTime + start;

  // Soft major-chord bell: root + fifth + octave shimmer.
  tone(ac, { freq: base,        freq2: base * 1.01, start: t,        duration: 0.42, volume,        type: 'sine' });
  tone(ac, { freq: base * 1.5,  freq2: base * 1.5,  start: t + 0.015, duration: 0.34, volume: volume * 0.38, type: 'triangle' });
  tone(ac, { freq: base * 2.0,  freq2: base * 2.0,  start: t + 0.04,  duration: 0.28, volume: volume * 0.22, type: 'sine' });
}

/** Must be called synchronously inside a click handler before any await. */
export function primeAudio() {
  try { ctx(); } catch (_) {}
}

/** 🟢 Buy — pleasant bright ding */
export function playBuy() {
  try { bell({ base: 880, volume: 0.075 }); } catch (e) { console.warn('[sound] buy:', e); }
}

/** 🔴 Sell — same family, slightly lower/warmer ding */
export function playSell() {
  try { bell({ base: 740, volume: 0.07 }); } catch (e) { console.warn('[sound] sell:', e); }
}

/** 💀 Rug (optional) */
export function playRug() {
  try {
    const ac = ctx();
    const t = ac.currentTime;
    tone(ac, { freq: 110, freq2: 55, start: t, duration: 0.5, volume: 0.12, type: 'sawtooth' });
  } catch (e) {}
}
