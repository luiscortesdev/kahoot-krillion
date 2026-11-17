// Tiny synthesized sound effects: no audio files, so it works offline on a school LAN.
const Sfx = (() => {
  let ctx, muted = false;
  try { muted = localStorage.getItem('krillion-mute') === '1'; } catch {}
  const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  function tone(freq, dur, { type = 'sine', vol = .2, to, delay = 0 } = {}) {
    if (muted) return;
    const c = ac(), t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .05);
  }
  // wire a mute button; browsers only allow audio after a user gesture, so unlock on first click
  function bindMute(btn) {
    const label = () => btn.textContent = muted ? 'Sound off' : 'Sound on';
    label();
    btn.onclick = () => { muted = !muted; try { localStorage.setItem('krillion-mute', muted ? '1' : '0'); } catch {} label(); if (!muted) pop(); };
    addEventListener('pointerdown', () => ac().resume(), { once: true });
  }
  const pop = () => tone(520, .12, { to: 900, vol: .15 });
  return {
    bindMute, pop,
    tick: () => tone(1100, .05, { type: 'square', vol: .04 }),
    ping: () => { tone(1320, 1.4, { vol: .12 }); tone(1320, 1, { vol: .04, delay: .4 }); }, // sonar
    bloop: () => tone(440, .55, { to: 80, vol: .22 }),
    buzz: () => tone(140, .35, { type: 'sawtooth', vol: .07 }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? .7 : .25, { type: 'triangle', vol: .16, delay: i * .13 })),
  };
})();
