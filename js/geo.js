// Привязка здания к карте города: GPS телефона, уточнение метки пальцем, ручной ввод координат.
// Карта: Leaflet (локальная копия в vendor/) и плитки OpenStreetMap. Без интернета подложка не грузится,
// но координаты можно получить по GPS, ввести и сохранить.
import { A, canEdit, setGeo, clearGeo, haversineKm, SEMEY, activeObjects } from './model.js';
import { ui, dis, toast } from './ui.js';
import { esc } from './util.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const osmLink = g => `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=19/${g.lat}/${g.lng}`;
export const geoText = g => (g ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}` : 'не задана');
export const geoSourceLabel = s => ({ gps: 'GPS телефона', pin: 'метка на карте', manual: 'ввод вручную', address: 'поиск по адресу' }[s] || s || '—');

// Точка здания в формате GeoJSON (для городских карт и GIS). Порядок координат: долгота, широта.
export function geoFeature() {
  const S = A.S, g = S.geo;
  return {
    type: 'FeatureCollection',
    name: `${S.object_code}_building`,
    features: g ? [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
      properties: {
        object_code: S.object_code, address: S.address, protocol_code: S.protocol_code, revision: S.revision,
        accuracy_m: g.accuracy_m, source: g.source, set_at: g.set_at, set_by: g.set_by,
        gps_fix: g.gps_fix || null, pin_offset_m: g.pin_offset_m ?? null,
        components: activeObjects().length, photos: [...A.PH.values()].filter(p => !p.void).length,
      },
    }] : [],
    note: g ? undefined : 'Привязка к карте не задана',
  };
}

// ---------- карта ----------
let L = null, map = null, marker = null, circle = null;
let draft = null, saved = null, gpsFix = null;
let startMode = false, onChange = null;
let onAddr = null;
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
let baseKind = 'osm', baseLayer = null;
try { if (localStorage.getItem('hm_base') === 'sat') baseKind = 'sat'; } catch { /* необязательно */ }
function setBase(kind) {
  baseKind = kind;
  try { localStorage.setItem('hm_base', kind); } catch { /* необязательно */ }
  if (map && L) {
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = kind === 'sat'
      ? L.tileLayer(SAT, { maxZoom: 19, maxNativeZoom: 17, attribution: 'Esri World Imagery' })
      : L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' });
    baseLayer.addTo(map); baseLayer.bringToBack();
  }
  document.querySelectorAll('[data-act="geo-base"]').forEach(b => b.classList.toggle('on', b.dataset.b === kind));
}
function pinIcon() {
  return L.divIcon({
    className: 'hm-pin', iconSize: [36, 46], iconAnchor: [18, 46],
    html: '<svg viewBox="0 0 36 46" width="36" height="46"><path d="M18 45C18 45 3 28 3 17a15 15 0 0 1 30 0c0 11-15 28-15 28z" fill="#e5484d" stroke="#fff" stroke-width="2.5"/><circle cx="18" cy="17" r="6" fill="#fff"/></svg>',
  });
}
function labelText() {
  const f = startMode ? (document.getElementById('f-addr')?.value.trim() || (lastRev && lastRev.field) || '') : (A.S ? A.S.address : '');
  return String(f).replace(/^\s*(г\.\s*|г\s+|город\s+)?[^,]*,\s*(?=.*,)/i, '').trim();
}
export function refreshLabel() {
  if (!marker) return;
  const t = labelText();
  if (marker.getTooltip()) marker.unbindTooltip();
  if (t) marker.bindTooltip(document.createTextNode ? Object.assign(document.createElement('span'), { textContent: t }) : t, { permanent: true, direction: 'top', offset: [0, -46], className: 'hm-tip' }).openTooltip();
}
let revTimer = null, revSeq = 0, lastRev = null, addrPoint = null;
export const lastReverse = () => lastRev;
export function noteAddressPoint(p) { addrPoint = p; refresh(false); }
export const startGeo = () => (startMode ? draft : null);

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => res(window.L);
    s.onerror = () => rej(new Error('Не удалось загрузить карту'));
    document.head.appendChild(s);
  });
}

const same = (a, b) => !!a && !!b && a.lat === b.lat && a.lng === b.lng;

function statusHtml() {
  const g = draft;
  if (!g) return '<div class="blk"><b>Привязка не задана</b><br>Встаньте у здания и нажмите кнопку «Определить по GPS» ниже или поставьте метку на карте.</div>';
  const unsaved = !startMode && !same(saved, g);
  const warn = [];
  if (g.accuracy_m != null && g.accuracy_m > 30) warn.push(`Точность GPS низкая (±${g.accuracy_m} м). Выйдите на открытое место или уточните метку вручную.`);
  if (addrPoint && g.source !== 'address') {
    const m = Math.round(haversineKm(g, addrPoint) * 1000);
    if (m > 150) warn.push(`Метка в ${m} м от места, найденного по набранному адресу. Если вы не у здания, перенесите метку на дом или нажмите «Найти на карте по адресу».`);
  }
  if (haversineKm(g, SEMEY) > 25) warn.push('Точка далеко от Семея. Проверьте координаты.');
  return `<div class="${unsaved ? 'blk' : 'done'}"><b>${unsaved ? 'Не сохранено' : startMode ? '✓ Точка выбрана' : '✓ Сохранено'}</b><br>
    <span class="uid">${esc(geoText(g))}</span>${g.accuracy_m != null ? ` · ±${g.accuracy_m} м` : ''}<br>Источник: ${esc(geoSourceLabel(g.source))}</div>
    ${warn.map(w => `<p class="hint bad-t">${esc(w)}</p>`).join('')}`;
}

function refresh(pan) {
  const el = document.getElementById('geo-status');
  if (el) el.innerHTML = statusHtml();
  const la = document.getElementById('geo-lat'), ln = document.getElementById('geo-lng');
  if (draft && la && document.activeElement !== la && document.activeElement !== ln) { la.value = draft.lat; ln.value = draft.lng; }
  const lk = document.getElementById('geo-link');
  if (lk) lk.innerHTML = draft ? `<a href="${esc(osmLink(draft))}" target="_blank" rel="noopener">Открыть точку в OpenStreetMap ›</a>` : '';
  if (!map || !draft) return;
  const ll = [draft.lat, draft.lng];
  if (!marker) {
    marker = L.marker(ll, { draggable: startMode || canEdit(), icon: pinIcon() }).addTo(map);
    refreshLabel();
    marker.on('dragend', () => { const p = marker.getLatLng(); setDraft({ lat: p.lat, lng: p.lng }, 'pin', false); });
  } else marker.setLatLng(ll);
  if (circle) { map.removeLayer(circle); circle = null; }
  if (draft.accuracy_m != null && draft.source === 'gps') circle = L.circle(ll, { radius: draft.accuracy_m, weight: 2, dashArray: '5 6', color: '#2f7fe0', fill: false }).addTo(map);
  if (pan) map.setView(ll, draft.source === 'gps' ? 18 : 19);
}

function setAddrBox(html) { const el = document.getElementById('geo-addr'); if (el) el.innerHTML = html; }
function scheduleReverse() {
  clearTimeout(revTimer);
  if (!draft || draft.source === 'address') { lastRev = null; setAddrBox(''); return; }
  setAddrBox('<span class="hint">Определяю адрес по метке…</span>');
  const my = ++revSeq, g = draft;
  revTimer = setTimeout(async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&zoom=18&addressdetails=1&lat=${g.lat}&lon=${g.lng}`, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (my !== revSeq) return;
      if (!j || j.error) { lastRev = null; setAddrBox('<span class="hint">Адрес по этой точке не найден.</span>'); return; }
      const a = j.address || {};
      const city = a.city || a.town || a.village || '';
      const road = a.road || a.pedestrian || '';
      const field = road ? [city && 'г. ' + city, road, a.house_number].filter(Boolean).join(', ') : '';
      lastRev = { name: j.display_name, field, hasHouse: !!a.house_number };
      if (startMode && onAddr && field) onAddr(lastRev);
      setAddrBox(`<div class="hint">Адрес по метке: <b>${esc(j.display_name)}</b></div>` +
        (startMode && field ? `<button class="btn ghost" data-act="addr-use">Подставить в поле «Адрес здания»${a.house_number ? '' : ' (допишите номер дома)'}</button>` : ''));
    } catch { if (my === revSeq) { lastRev = null; setAddrBox('<span class="hint">Адрес по метке не определён (нужен интернет).</span>'); } }
  }, 900);
}

function setDraft(p, source, pan = true) {
  let g = { lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6), accuracy_m: source === 'gps' ? Math.round(p.accuracy) : null, source };
  if (source === 'gps') gpsFix = { lat: g.lat, lng: g.lng, accuracy_m: g.accuracy_m };
  if (source === 'pin' && gpsFix) { g.gps_fix = gpsFix; g.pin_offset_m = Math.round(haversineKm(gpsFix, g) * 1000); }
  draft = g;
  refresh(pan);
  scheduleReverse();
  if (onChange) onChange(draft);
}

function mapCards(d, intro) {
  return `<section class="card"><h2>Здание на карте</h2>
      ${intro}
      <div id="geo-status">${statusHtml()}</div>
      <div id="geo-addr"></div>
      <div class="row"><button class="btn big" data-act="geo-gps"${d}>📍 Определить по GPS</button></div>
      <div class="seg"><button data-act="geo-base" data-b="osm" class="${baseKind === 'osm' ? 'on' : ''}">Схема</button><button data-act="geo-base" data-b="sat" class="${baseKind === 'sat' ? 'on' : ''}">Спутник</button></div>
      <div id="geomap" class="geo-map"><p class="hint">Карта загружается…</p></div>
      <p class="hint">Нажмите на карту или перетащите метку, чтобы поставить её точно на здание. Без интернета подложка не загрузится, но GPS и координаты работают.</p>
      <button class="btn ghost" data-act="geo-center">К метке</button></section>
    <section class="card"><h2>Координаты</h2>
      <label class="fl">Широта<input class="in" id="geo-lat" inputmode="decimal" placeholder="например: 50.4111" value="${draft ? draft.lat : ''}" autocomplete="off"${d}></label>
      <label class="fl">Долгота<input class="in" id="geo-lng" inputmode="decimal" placeholder="например: 80.2275" value="${draft ? draft.lng : ''}" autocomplete="off"${d}></label>
      <button class="btn ghost" data-act="geo-apply"${d}>Применить координаты</button>
      <div id="geo-link" class="hint">${draft ? `<a href="${esc(osmLink(draft))}" target="_blank" rel="noopener">Открыть точку в OpenStreetMap ›</a>` : ''}</div></section>`;
}

async function mountMap() {
  const box = document.getElementById('geomap');
  try {
    L = await loadLeaflet();
    if (!document.getElementById('geomap')) return;
    box.innerHTML = '';
    L.Icon.Default.imagePath = 'vendor/leaflet/images/';
    map = L.map(box, { zoomControl: true }).setView(draft ? [draft.lat, draft.lng] : [SEMEY.lat, SEMEY.lng], draft ? 19 : 13);
    baseLayer = null; setBase(baseKind);
    if (startMode || canEdit()) map.on('click', e => setDraft(e.latlng, 'pin', false));
    marker = null; circle = null;
    refresh(false);
    ui.cleanup = () => { if (map) { map.remove(); map = null; marker = null; circle = null; } startMode = false; onChange = null; onAddr = null; };
  } catch (e) {
    box.innerHTML = `<div class="blk">${esc(e.message)}. Координаты можно ввести вручную.</div>`;
  }
}

// Редактор точки на экране старта нового обследования (до создания записи).
export function startGeoEditor(change, addrCb) {
  startMode = true; onChange = change; onAddr = addrCb || null; saved = null; gpsFix = null; addrPoint = null; lastRev = null;
  return { html: mapCards('', ''), mount: mountMap };
}
export function resetStartGeo() { draft = null; addrPoint = null; lastRev = null; }

// Поиск адреса в OpenStreetMap (Nominatim). Только онлайн; запросы редкие (пауза после ввода), как требует политика сервиса.
export async function geocodeAddress(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&countrycodes=kz&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json();
  if (!j.length) return null;
  return { lat: +j[0].lat, lng: +j[0].lon, name: j[0].display_name };
}
// Ставит метку по найденному адресу. Точку, которую человек уже поставил сам (GPS, палец, координаты), не трогает без force.
export function applyAddressPoint(p, force = false) {
  if (!force && draft && draft.source !== 'address') return false;
  setDraft(p, 'address', true);
  return true;
}

export function screenGeo() {
  startMode = false; onChange = null; addrPoint = null; lastRev = null;
  saved = A.S.geo || null;
  draft = saved ? { ...saved } : null;
  gpsFix = saved ? (saved.gps_fix || (saved.source === 'gps' ? { lat: saved.lat, lng: saved.lng, accuracy_m: saved.accuracy_m } : null)) : null;
  const d = dis();
  return {
    title: 'Привязка к карте', sub: A.S.object_code, back: '#/map', nav: true,
    html: `${mapCards(d, `<p class="hint">${esc(A.S.address)}</p>`)}
    <section class="card"><button class="btn big" data-act="geo-save"${d}>Сохранить привязку</button>
      ${saved ? `<button class="btn ghost danger" data-act="geo-clear"${d}>Снять привязку</button>` : ''}
      <p class="hint">Координаты записываются в паспорт обследования, схему мониторинга и файл building.geojson в пакете.</p></section>`,
    mount: mountMap,
  };
}

export function registerGeoActions() {
  const a = ui.actions;
  a['geo-gps'] = el => {
    if (!navigator.geolocation) { toast('Телефон не поддерживает определение места', 'err'); return; }
    el.disabled = true; toast('Определяю место…');
    navigator.geolocation.getCurrentPosition(pos => {
      el.disabled = false;
      setDraft({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, 'gps');
      toast('Место определено. Проверьте метку и сохраните', 'ok');
    }, err => {
      el.disabled = false;
      toast(err.code === 1 ? 'Нет разрешения на геолокацию. Разрешите её для сайта в настройках браузера' : err.code === 3 ? 'GPS не ответил вовремя. Выйдите на открытое место и повторите' : 'Не удалось определить место', 'err');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };
  a['geo-base'] = el => setBase(el.dataset.b);
  a['geo-center'] = () => {
    if (!draft) { toast('Метки пока нет: сначала определите место или введите адрес'); return; }
    if (!map) { toast('Карта не загрузилась (нужен интернет). Координаты метки: ' + geoText(draft), 'err'); return; }
    map.invalidateSize();
    map.setView([draft.lat, draft.lng], 19, { animate: false });
    toast('Карта перемещена к метке', 'ok');
  };
  a['geo-apply'] = () => {
    const lat = parseFloat(String(document.getElementById('geo-lat').value).replace(',', '.'));
    const lng = parseFloat(String(document.getElementById('geo-lng').value).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast('Проверьте координаты: широта до 90, долгота до 180', 'err'); return; }
    setDraft({ lat, lng }, 'manual');
  };
  a['geo-save'] = () => {
    if (!draft) { toast('Сначала определите место или поставьте метку', 'err'); return; }
    if (!setGeo(draft)) { toast('Не удалось сохранить', 'err'); return; }
    toast('Привязка сохранена', 'ok');
    ui.render(true);
  };
  a['geo-clear'] = () => { clearGeo(); toast('Привязка снята'); ui.render(true); };
}
