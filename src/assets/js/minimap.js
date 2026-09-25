// Small maps on entry and place pages. MapLibre is only loaded when a map scrolls into view.
import { CATEGORY } from './lib.js';
import { loadMapLibre, webglSupported, pickStyle, FALLBACK_NOTE } from './map-common.js';

async function render(el) {
  const { center, markers } = JSON.parse(el.dataset.minimap);
  if (!webglSupported()) return;
  const [lib, { style, fallback }] = await Promise.all([loadMapLibre(), pickStyle()]);
  el.classList.add('live');
  const map = new lib.Map({
    container: el, style, center, zoom: 12,
    attributionControl: { compact: true }, cooperativeGestures: true, dragRotate: false,
  });
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
  for (const m of markers) {
    const node = document.createElement(m.href ? 'a' : 'div');
    node.className = `pin${m.main ? ' pin-main' : ''}`;
    node.style.setProperty('--c', CATEGORY[m.category].color);
    node.title = m.title;
    if (m.href) { node.href = m.href; node.setAttribute('aria-label', m.title); }
    else node.setAttribute('role', 'img'), node.setAttribute('aria-label', `Location of ${m.title}`);
    new lib.Marker({ element: node, anchor: 'center' }).setLngLat([m.lon, m.lat]).addTo(map);
  }
  if (markers.length > 1) {
    const b = markers.reduce((acc, m) => acc.extend([m.lon, m.lat]), new lib.LngLatBounds([markers[0].lon, markers[0].lat], [markers[0].lon, markers[0].lat]));
    map.fitBounds(b, { padding: 40, maxZoom: 13, duration: 0 });
  }
  map.once('load', () => { el.dataset.ready = '1'; });
  if (fallback) el.insertAdjacentHTML('afterend', `<p class="small">${FALLBACK_NOTE}</p>`);
  el.querySelector('.minimap-fallback')?.setAttribute('hidden', '');
}

const maps = document.querySelectorAll('[data-minimap]');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((list) => {
    for (const it of list) if (it.isIntersecting) { io.unobserve(it.target); render(it.target).catch((e) => console.warn(e)); }
  }, { rootMargin: '200px' });
  maps.forEach((m) => io.observe(m));
} else maps.forEach((m) => render(m).catch((e) => console.warn(e)));
