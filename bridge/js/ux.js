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
