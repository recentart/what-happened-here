// Runs on every page. Images are served by Wikimedia; if one fails, show a quiet
// placeholder with a link to the file instead of a broken image.
function fallback(img) {
  if (img.dataset.failed) return;
  img.dataset.failed = '1';
  const box = document.createElement('div');
  box.className = 'img-missing';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', img.alt);
  const commons = img.closest('figure')?.querySelector('.credit a[href*="commons.wikimedia.org/wiki/File:"]');
  box.innerHTML = '<span>Image temporarily unavailable.</span>';
  if (commons) {
    const a = document.createElement('a');
    a.href = commons.href;
    a.textContent = 'View it on Wikimedia Commons';
    a.rel = 'noopener';
    box.append(document.createElement('br'), a);
  }
  img.replaceWith(box);
}

document.addEventListener('error', (ev) => { if (ev.target instanceof HTMLImageElement) fallback(ev.target); }, true);
for (const img of document.images) if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fallback(img);
