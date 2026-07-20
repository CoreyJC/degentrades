/**
 * Sound effects for DegenTrades — fresh AudioContext per play to avoid suspend issues.
 */

function beep({ freq = 440, freq2, duration = 0.3, volume = 0.25, type = 'sine' } = {}) {
  try {
    const ac   = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freq2) osc.frequency.linearRampToValueAtTime(freq2, ac.currentTime + duration * 0.7);

    gain.gain.setValueAtTime(volume, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);

    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
    osc.onended = () => ac.close();
  } catch (e) {
    console.warn('[sounds] error:', e);
  }
}

/** 🟢 Buy — bright ascending ding */
export function playBuy() {
  beep({ freq: 523, freq2: 1047, duration: 0.28, volume: 0.22 }); // C5 → C6
}

/** 🔴 Sell — softer descending tone */
export function playSell() {
  beep({ freq: 659, freq2: 392, duration: 0.28, volume: 0.18 }); // E5 → G4
}

/** 💀 Rug — low rumble (optional) */
export function playRug() {
  beep({ freq: 110, freq2: 55, duration: 0.5, volume: 0.20, type: 'sawtooth' });
}

/** No-op — kept for compatibility */
export function primeAudio() {}
