// Навигация по разделам: порядок обхода, «Дальше», шторка, крошки, переходы, подсказки «зачем».
import { A, sectionStatus, commsRows, gaps } from './model.js';
import { esc } from './util.js';
import { pill } from './ui.js';

// Порядок обхода: разделы ЧЛ-01…09, связь, прочие, контроль, итог, подписи.
export function flow() {
  const cfg = A.cfg, S = A.S, out = [];
  cfg.sections.filter(s => s.kind !== 'misc').forEach(s => {
    const st = sectionStatus(s.id);
    out.push({
      key: s.id, href: s.id === 'CL01' ? '#/access' : `#/sec/${s.id}`, num: s.num, title: s.title,
      code: st.code, label: st.label, done: S.sections[s.id].state === 'closed',
    });
  });
  const rows = commsRows(), cd = rows.filter(r => r.complete).length;
  out.push({
    key: 'comms', href: '#/comms', num: 'ЧЛ-10', title: 'Связь и питание',
    code: cd === rows.length ? 'closed' : cd ? 'in_progress' : 'not_started',
    label: cd === rows.length ? 'заполнено' : cd ? 'в работе' : 'не начато', done: cd === rows.length,
  });
  const m = cfg.sections.find(s => s.kind === 'misc'), ms = sectionStatus(m.id);
  out.push({ key: m.id, href: `#/sec/${m.id}`, num: m.num, title: 'Прочие объекты', code: ms.code, label: ms.label, done: true });
  const gp = gaps().length;
  out.push({
    key: 'control', href: '#/control', num: 'ЧЛ-13', title: 'Контроль перед уходом',
    code: gp ? 'in_progress' : 'closed', label: gp ? 'есть пробелы' : 'чисто', done: gp === 0,
  });
  out.push({ key: 'summary', href: '#/summary', num: '', title: 'Итог и PASS', code: 'not_started', label: '', done: true });
  out.push({
    key: 'sign', href: '#/sign', num: '', title: 'Подписи и передача',
    code: S.status === 'signed' ? 'closed' : 'not_started',
    label: S.status === 'signed' ? 'подписано' : S.status === 'sealed' ? 'ждут подписей' : '', done: S.status === 'signed',
  });
  return out;
}

const name = i => (i.num ? `${i.num} · ${i.title}` : i.title);

export function nextStep() { return flow().find(i => !i.done) || null; }

// Какой раздел открыт сейчас (по адресу). null — карта, камера, служебные экраны.
export function currentKey(hash = location.hash) {
  const parts = (hash.slice(1).split('?')[0] || '/').split('/').filter(Boolean).map(decodeURIComponent);
  const r = parts[0];
  if (r === 'access') return 'CL01';
  if (r === 'sec') return parts[1] || null;
  if (r === 'obj') return A.S.objects[parts[1]]?.section || null;
  if (['comms', 'control', 'summary', 'sign'].includes(r)) return r;
  return null;
}

// Строка под шапкой: где я (крошки) и что дальше.
export function subnavHtml(hash = location.hash) {
  const list = flow(), key = currentKey(hash), cur = list.find(i => i.key === key);
  const next = nextStep();
  const parts = hash.slice(1).split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  let crumbs = '<a href="#/map">Карта</a>';
  if (cur) {
    crumbs += parts[0] === 'obj'
      ? ` › <a href="${cur.href}">${esc(name(cur))}</a> › <span>${esc(parts[1])}</span>`
      : ` › <span>${esc(name(cur))}</span>`;
  }
  const showNext = next && next.key !== key;
  return `<div class="subnav"><div class="crumbs" aria-label="Где вы">${crumbs}</div>
    ${showNext ? `<a class="nx" href="${next.href}">Дальше: ${esc(name(next))} ›</a>` : ''}</div>`;
}

// Кнопки «‹ предыдущий / следующий ›» внизу раздела.
export function pagerHtml(hash = location.hash) {
  const parts = hash.slice(1).split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'obj') return '';
  const list = flow(), key = currentKey(hash), i = list.findIndex(x => x.key === key);
  if (i < 0) return '';
  const p = list[i - 1], n = list[i + 1];
  const a = (x, dir) => x
    ? `<a class="pg ${dir}" href="${x.href}"><span>${dir === 'prev' ? '‹ ' : ''}${esc(x.num || x.title)}${dir === 'next' ? ' ›' : ''}</span><small>${esc(x.num ? x.title : '')}</small></a>`
    : '<span></span>';
  return `<nav class="pager" aria-label="Переход между разделами">${a(p, 'prev')}${a(n, 'next')}</nav>`;
}

// Окно со списком всех разделов.
export function drawerHtml(hash = location.hash) {
  const key = currentKey(hash);
  const rows = flow().map(i => `<a class="drw-i${i.key === key ? ' cur' : ''}" href="${i.href}" data-act="modal-close-go">
    <span class="mt"><b>${esc(name(i))}</b></span>${i.label ? pill(i.code, i.label) : ''}</a>`).join('');
  return `<h3>Разделы обследования</h3><div class="drw">${rows}</div>
    <div class="row"><a class="btn ghost" href="#/map" data-act="modal-close-go">Карта обхода</a>
    <a class="btn ghost" href="#/about" data-act="modal-close-go">Зачем это обследование</a></div>
    <button class="btn" data-act="modal-close">Закрыть</button>`;
}

// Блок «Зачем этот раздел».
export function why(p) {
  if (!p || !p.purpose) return '';
  return `<div class="why"><div><b>Зачем.</b> ${esc(p.purpose)}</div>${p.gets ? `<div><b>Нужно получить.</b> ${esc(p.gets)}</div>` : ''}</div>`;
}

// Горизонтальная полоса разделов: листается пальцем, текущий раздел подсвечен.
const SHORT = { summary: 'Итог', sign: 'Подписи' };
export function stripHtml(hash = location.hash) {
  const key = currentKey(hash);
  const items = flow().map(i => {
    const top = i.num || SHORT[i.key] || i.title;
    const sub = i.num ? i.title.replace(/ \(.*\)$/, '') : '';
    const cls = ['sc', i.key === key ? 'on' : '', i.done && !['summary', 'MISC'].includes(i.key) && i.code === 'closed' ? 'ok' : '', i.code === 'no_access' ? 'na' : ''].filter(Boolean).join(' ');
    return `<a class="${cls}" href="${i.href}"${i.key === key ? ' aria-current="page"' : ''}><b>${esc(top)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`;
  }).join('');
  return `<nav class="strip" aria-label="Разделы обследования">${items}</nav>`;
}
