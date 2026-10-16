// Точка входа: маршрутизация, события, регистрация офлайн-службы.
import { A, initState, setAt, getAt, logTextChange, setRepRemarks, flush, exportState } from './model.js';
import { ui, hydrate, toast, closeModal, safetyBanner } from './ui.js';
import * as SA from './screens-a.js';
import * as SB from './screens-b.js';
import { esc } from './util.js';

const root = document.getElementById('app');

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [p, qs] = raw.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || '') };
}

function routeScreen() {
  const { parts, q } = parseHash();
  const r = parts[0] || '';
  if (r === 'service') return SB.screenService();
  if (!A.S) return SA.screenStart();
  switch (r) {
    case 'access': return SA.screenAccess();
    case 'sec': return SA.screenSection(parts[1]);
    case 'obj': ui.state.objId = parts[1]; return SA.screenObject(parts[1], q.get('t') || 'card');
    case 'cam': return SA.screenCam(q);
    case 'comms': return SB.screenComms();
    case 'control': return SB.screenControl();
    case 'summary': return SB.screenSummary();
    case 'sign': return SB.screenSign();
    default: return SA.screenMap();
  }
}

function indicatorText() {
  if (A.saveState === 'saving') return 'сохраняю…';
  if (!A.S || A.S.status !== 'signed') return 'сохранено локально';
  return exportState() === 'exported' ? 'выгружено' : 'ожидает выгрузки';
}
function updateIndicator() {
  const el = document.getElementById('save-ind');
  if (!el) return;
  el.textContent = indicatorText();
  el.dataset.s = A.saveState === 'saving' ? 'saving' : (A.S && A.S.status === 'signed' ? exportState() : 'saved');
}

const NAV = [['#/map', 'Карта', '▦'], ['#/comms', 'Связь', '⌁'], ['#/control', 'Контроль', '✓'], ['#/summary', 'Итог', '∑'], ['#/sign', 'Подписи', '✎']];
function chrome(scr) {
  const hash = location.hash || '#/';
  const lock = A.S && A.S.status !== 'draft' ? `<div class="lock">🔒 ${A.S.status === 'signed' ? 'Обследование подписано. Данные закрыты для правок.' : 'Данные закрыты для подписания.'}</div>` : '';
  const nav = scr.nav && A.S ? `<nav class="bnav" aria-label="Разделы">${NAV.map(([h, l, i]) =>
    `<a href="${h}" class="${hash.startsWith(h) ? 'on' : ''}"><i>${i}</i>${l}</a>`).join('')}</nav>` : '';
  return `<header class="top">
    ${scr.back ? `<a class="back" href="${scr.back}" aria-label="Назад">‹</a>` : '<span class="back ph"></span>'}
    <div class="tt"><h1>${esc(scr.title)}</h1>${scr.sub ? `<small>${esc(scr.sub)}</small>` : ''}</div>
    <span id="save-ind" class="sind" data-s="saved">${indicatorText()}</span>
    <a class="menu" href="#/service" aria-label="Служебное">⋯</a></header>
    ${lock}${scr.safety ? safetyBanner() : ''}
    <main>${scr.html}</main>${nav}`;
}

export function render(keepScroll = false) {
  if (ui.cleanup) { ui.cleanup(); ui.cleanup = null; }
  const y = window.scrollY;
  let scr;
  try { scr = routeScreen(); } catch (e) { console.error(e); scr = { title: 'Ошибка', back: '#/map', html: `<div class="blk">Ошибка экрана: ${esc(e.message)}</div>` }; }
  if (scr.full) {
    root.innerHTML = scr.html;
    document.body.classList.add('cam-on');
  } else {
    root.innerHTML = chrome(scr);
    document.body.classList.remove('cam-on');
  }
  document.title = (scr.title ? scr.title + ' · ' : '') + 'HouseMaster Field';
  hydrate(root);
  window.scrollTo(0, keepScroll ? y : 0);
  if (scr.mount) scr.mount();
  updateIndicator();
}
ui.render = render;
ui.go = h => { if (location.hash === h) render(); else location.hash = h; };

// ---------- события ----------
ui.actions.set = el => {
  const path = el.dataset.path;
  const cur = getAt(A.S, path.split('.'));
  const val = el.dataset.val;
  setAt(path, cur === val ? null : val);
  render(true);
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ui.actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t.dataset && t.dataset.path && !t.dataset.sel) t.dataset.old = t.value;
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'rep-remarks') { setRepRemarks(t.value); return; }
  const p = t.dataset && t.dataset.path;
  if (!p || t.dataset.sel || p === '__newzone') return;
  let v = t.value;
  if (t.dataset.type === 'int') { v = v === '' ? null : parseInt(v, 10); if (Number.isNaN(v) || v < 0) v = null; }
  setAt(p, v, { log: false });
  t.classList.remove('err');
});
document.addEventListener('change', e => {
  const t = e.target;
  const p = t.dataset && t.dataset.path;
  if (!p || p === '__newzone') return;
  if (t.dataset.sel) { setAt(p, t.value || null); render(true); return; }
  if (t.dataset.old !== undefined) {
    const nv = t.dataset.type === 'int' ? (t.value === '' ? null : parseInt(t.value, 10)) : t.value;
    logTextChange(p, t.dataset.old, nv);
    t.dataset.old = t.value;
  }
});
window.addEventListener('hashchange', () => { closeModal(); render(false); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', () => { flush(); });
A.listeners.add(updateIndicator);
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

SA.registerScreenActions();
SB.registerScreenActionsB();

// ---------- офлайн-служба ----------
function showUpdate() {
  const b = document.getElementById('upd');
  b.hidden = false;
  b.innerHTML = 'Доступна новая версия приложения. <button class="btn" id="upd-go">Обновить</button>';
  document.getElementById('upd-go').onclick = () => location.reload();
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
    });
  }).catch(() => { /* офлайн-режим недоступен, приложение работает онлайн */ });
}

// ---------- запуск ----------
(async () => {
  try {
    await initState();
  } catch (e) {
    root.innerHTML = `<div class="blk" style="margin:16px"><b>Не удалось открыть хранилище.</b><br>${esc(e.message)}<br>Закройте приватную вкладку и откройте приложение в обычном режиме.</div>`;
    return;
  }
  render();
})();
