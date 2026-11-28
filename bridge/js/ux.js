// Small accessibility hooks that need no change to app.js (feature: ux).
// Every dialog gets an accessible name from its first heading (screen readers announced "dialog" with no name).
(function () {
  const root = document.getElementById('modalRoot');
  if (!root || typeof MutationObserver === 'undefined') return;
  let n = 0;
  const name = () => {
    const m = root.querySelector('.modal[role="dialog"]');
    if (!m || m.hasAttribute('aria-label') || m.hasAttribute('aria-labelledby')) return;
    const h = m.querySelector('h1, h2, h3, h4');
    if (h) { if (!h.id) h.id = 'mdlh' + (++n); m.setAttribute('aria-labelledby', h.id); }
    else m.setAttribute('aria-label', 'Dialog');
  };
  new MutationObserver(name).observe(root, { childList: true, subtree: true });
})();
// Home screen labels from saved state (Continue practice, Daily deals board n of 4) before the home screen is shown
// (style.css keeps it hidden until .home-ready): init in app.js sets them only after an await, and the longer daily label
// wrapped the mode buttons onto a third row, moving everything below by 46 px (layout shift 0.075 on reload).
try { if (typeof renderPracticeBtn === 'function') renderPracticeBtn(); if (typeof Daily !== 'undefined') Daily.renderHome(); } catch (e) { }
document.documentElement.classList.add('home-ready'); // style.css shows the home screen from here on
