// Tiny sound-effect helper shared by the teacher and student screens.
const SFX = (() => {
  const files = { jump: 0.6, explosion: 0.7, death: 0.6, gameover: 0.7 }; // name -> volume
  const base = {};
  for (const [name, vol] of Object.entries(files)) {
    const a = new Audio(`/sounds/${name}.mp3`);
    a.preload = 'auto'; a.volume = vol; base[name] = a;
  }
  let muted = false;
  try { muted = localStorage.getItem('krillion-muted') === '1'; } catch {}

  function play(name) {
    if (muted || !base[name]) return;
    // clone so rapid repeats (lots of students joining) can overlap
    const a = base[name].cloneNode();
    a.volume = base[name].volume;
    a.play().catch(() => {}); // ignore autoplay blocks
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('krillion-muted', m ? '1' : '0'); } catch {}
  }
  // Adds a small speaker toggle in the corner
  function addToggle() {
    const b = document.createElement('button');
    b.className = 'ghost';
    b.style.cssText = 'position:fixed;top:10px;right:10px;z-index:10;padding:8px 12px';
    const label = () => b.textContent = muted ? '🔇' : '🔊';
    b.title = 'Sound on/off';
    b.onclick = () => { setMuted(!muted); label(); if (!muted) play('jump'); };
    label();
    document.body.appendChild(b);
  }
  return { play, addToggle };
})();
