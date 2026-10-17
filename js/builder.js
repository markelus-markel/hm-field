// Конструктор набора метрик: цель обследования -> предложение приложения -> уточнение пользователем.
// Каталог лежит в data/catalog.json. Предложение строится по типовым целям и ключевым словам (без ИИ и без сервера).
// Итог: собственная копия протокола (cfg) для этого обследования. Стандартный протокол AG-CN-SUTO-13A-FIELD-01 не меняется.
import { A, clone } from './model.js';
import { ui, toast } from './ui.js';
import { esc } from './util.js';
import * as db from './db.js';

let CAT = null;
export async function loadCatalog() {
  if (CAT) return CAT;
  CAT = window.__CATALOG__ || await (await fetch('data/catalog.json')).json();
  return CAT;
}
export const catalog = () => CAT;

const fresh = () => ({
  mode: 'standard', goalIds: [], goalText: '', proposed: false, ready: false, reasons: [],
  sys: {}, zones: {}, open: {},
  off: { items: {}, slots: {}, readings: {}, types: {} },
  add: { items: {}, slots: [], readings: {}, types: {} },
});
export async function loadBuilder() {
  try { A.builder = { ...fresh(), ...((await db.kvGet('builder')) || {}) }; } catch { A.builder = fresh(); }
  return A.builder;
}
export const builder = () => A.builder || (A.builder = fresh());
export function saveBuilder() { db.kvSet('builder', A.builder).catch(() => {}); }
export async function resetBuilder() { A.builder = fresh(); try { await db.kvDelete('builder'); } catch { /* необязательно */ } }

// ---------- предложение по цели ----------
export function propose(b = builder()) {
  const sys = {}, zones = {}, reasons = [];
  const mark = (kind, id, why) => {
    const bag = kind === 'sys' ? sys : zones;
    if (!bag[id]) reasons.push({ kind, id, why });
    bag[id] = true;
  };
  b.goalIds.forEach(gid => {
    const g = CAT.goals.find(x => x.id === gid);
    if (!g) return;
    g.systems.forEach(s => mark('sys', s, `цель «${g.label}»`));
    g.zones.forEach(z => mark('zone', z, `цель «${g.label}»`));
  });
  const text = (b.goalText || '').toLowerCase();
  if (text.trim()) {
    CAT.goals.forEach(g => {
      const hit = g.kw.find(k => text.includes(k));
      if (hit) { g.systems.forEach(s => mark('sys', s, `в тексте цели есть «${hit}»`)); g.zones.forEach(z => mark('zone', z, `в тексте цели есть «${hit}»`)); }
    });
    CAT.systems.forEach(s => { const hit = s.kw.find(k => text.includes(k)); if (hit) mark('sys', s.id, `в тексте цели есть «${hit}»`); });
    CAT.zones.forEach(z => { const hit = z.kw.find(k => text.includes(k)); if (hit) mark('zone', z.id, `в тексте цели есть «${hit}»`); });
  }
  b.sys = sys; b.zones = zones; b.reasons = reasons; b.proposed = true; b.ready = false;
  b.off = { items: {}, slots: {}, readings: {}, types: {} };
  b.add = { items: {}, slots: [], readings: {}, types: {} };
  return reasons.length > 0;
}

// ---------- сборка протокола ----------
const CTRL_NEEDS = {
  heat_entry: ['sys', 'HEAT'], heat_photo: ['sys', 'HEAT'], cws_entry: ['sys', 'CWS'], hws_checked: ['sys', 'HWS'],
  sewer_checked: ['sys', 'SEWER'], grsh_found: ['sys', 'ELECTRICAL'],
  basement_checked: ['zone', 'basement'], lifts_counted: ['zone', 'lift'], roof_checked: ['zone', 'roof'],
};
const ZONE_ITEM = { basement: 'i05', grsh: 'i06', lift: 'i07', roof: 'i08' };
const SEC_OF = { HEAT: 'CL03', CWS: 'CL04', HWS: 'CL05', SEWER: 'CL06', ELECTRICAL: 'CL07', NET: 'CL14' };

export function protocolCode(b) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `HMF-CUSTOM-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
export function goalLabel(b) {
  const labels = b.goalIds.map(id => (CAT.goals.find(g => g.id === id) || {}).label).filter(Boolean);
  return [labels.join('; '), (b.goalText || '').trim()].filter(Boolean).join('. ');
}

export function composeCfg(base, b) {
  const cfg = clone(base);
  const sysOn = id => !!b.sys[id], zoneOn = id => !!b.zones[id];
  // зоны
  cfg.access_zones = base.access_zones.filter(z => zoneOn(z.id));
  // системы
  const systems = {};
  Object.entries(base.systems).forEach(([id, s]) => {
    if (id === 'ENV' || id === 'OTHER') systems[id] = s;
    else if (id === 'LIFT') { if (zoneOn('lift')) systems[id] = s; }
    else if (sysOn(id)) systems[id] = s;
  });
  if (sysOn('NET')) {
    const n = CAT.net_system;
    systems.NET = { label: n.label, code: n.code, priority: n.priority, section: n.section };
  }
  cfg.systems = systems;
  // разделы
  const secs = [];
  base.sections.forEach(s => {
    if (s.kind === 'access') {
      const c = clone(s);
      c.items = c.items.filter(i => !Object.entries(ZONE_ITEM).some(([z, id]) => id === i.id && !zoneOn(z)));
      if (!cfg.access_zones.length) c.items = c.items.filter(i => i.id !== 'i04');
      secs.push(c);
    } else if (s.kind === 'area') { if (zoneOn(s.zone)) secs.push(clone(s)); }
    else if (s.kind === 'system') { if (sysOn(s.system)) secs.push(clone(s)); }
    else secs.push(clone(s));
  });
  if (sysOn('NET')) {
    const miscIdx = secs.findIndex(s => s.kind === 'misc');
    secs.splice(miscIdx < 0 ? secs.length : miscIdx, 0, clone(CAT.net_system.section_def));
  }
  // уточнения по разделам систем: пункты, показания, свои пункты и показания
  secs.forEach(s => {
    if (s.kind === 'access' && b.add.items.CL01) { /* свои пункты ЧЛ-01 не предусмотрены */ }
    if (!['system', 'area'].includes(s.kind)) return;
    const offI = b.off.items[s.id] || {};
    s.items = (s.items || []).filter(i => i.key || !offI[i.id]);
    const sysId = s.system;
    if (sysId && CAT.extra_items[sysId]) {
      CAT.extra_items[sysId].forEach((t, n) => {
        const id = 'e' + (n + 1);
        if (!offI[id]) s.items.push({ id, text: t, extra: true });
      });
    }
    (b.add.items[s.id] || []).forEach((t, n) => s.items.push({ id: 'x' + (n + 1), text: t, custom: true }));
    if (s.readings) {
      const offR = b.off.readings[s.id] || {};
      s.readings = s.readings.filter(r => !offR[r.id]);
      if (sysId && CAT.extra_readings[sysId]) CAT.extra_readings[sysId].forEach(r => { if (!offR[r.id]) s.readings.push(clone(r)); });
      (b.add.readings[s.id] || []).forEach((r, n) => s.readings.push({ id: 'xr' + (n + 1), label: r.label, units: [r.unit || 'ед.', 'другое'] }));
    }
  });
  cfg.sections = secs;
  // типы элементов
  const et = {};
  Object.entries(base.element_types).forEach(([sid, list]) => {
    if (!systems[sid]) return;
    const offT = b.off.types[sid] || {};
    const merged = clone(list).filter(t => !offT[t.id]);
    (CAT.element_types_add[sid] || []).forEach(t => { if (!offT[t.id] && !merged.some(m => m.id === t.id)) merged.splice(Math.max(0, merged.length - 1), 0, clone(t)); });
    (b.add.types[sid] || []).forEach((l, n) => merged.splice(Math.max(0, merged.length - 1), 0, { id: 'xt' + (n + 1), label: l, ifc: 'IfcBuildingElementProxy' }));
    et[sid] = merged;
  });
  if (systems.NET) et.NET = clone(CAT.net_system.element_types);
  cfg.element_types = et;
  // PASS, контроль, связь
  cfg.pass.systems = base.pass.systems.filter(sysOn);
  cfg.control = base.control.filter(c => {
    const need = CTRL_NEEDS[c.check];
    if (!need) return true;
    return need[0] === 'sys' ? sysOn(need[1]) : zoneOn(need[1]);
  });
  cfg.comms_zones = base.comms_zones
    .map(z => ({ ...z, systems: z.systems.filter(s => systems[s]) }))
    .filter(z => z.systems.length || (z.access_zone && zoneOn(z.access_zone)));
  // фото-слоты
  const locked = CAT.locked_slots;
  cfg.photo_slots = base.photo_slots.filter(s => locked.includes(s.id) || !b.off.slots[s.id]);
  b.add.slots.forEach((s, n) => cfg.photo_slots.push({ id: 'xs' + (n + 1), label: s.label, hint: s.hint || 'Свой кадр' }));
  // протокол
  const goal = goalLabel(b);
  cfg.protocol = { ...base.protocol, code: protocolCode(b), version: 'custom', title: 'Протокол под цель обследования',
    stage: 'Field Evidence (набор метрик собран под цель)', goal: goal || base.protocol.goal, template_of: base.protocol.code };
  cfg.custom = { template: CAT.template.id, goal_ids: b.goalIds.slice(), goal_text: b.goalText || '', built_at: new Date().toISOString() };
  return cfg;
}

export function summaryOf(cfg) {
  const secs = cfg.sections.filter(s => s.kind === 'system');
  const zones = cfg.access_zones.map(z => z.label);
  const cnt = secs.reduce((n, s) => n + (s.items || []).length, 0);
  return { systems: secs.map(s => s.title), zones, items: cnt, slots: cfg.photo_slots.length, readings: secs.reduce((n, s) => n + (s.readings || []).length, 0), controls: cfg.control.length };
}
export function chosen() {
  const b = builder();
  if (b.mode !== 'custom' || !b.ready || !A.base) return null;
  const cfg = composeCfg(A.base, b);
  return { cfg, goal: { ids: b.goalIds.slice(), text: b.goalText || '', label: goalLabel(b) }, summary: summaryOf(cfg) };
}
export function previewCfg() { return A.base ? composeCfg(A.base, builder()) : null; }

// ---------- экран ----------
const tgl = (on, text, act, data, locked) =>
  `<button type="button" class="tgl${on ? ' on' : ''}${locked ? ' lock' : ''}" data-act="${locked ? 'bld-lock' : act}" ${data}>
    <i>${locked ? '🔒' : on ? '✓' : ''}</i><span>${esc(text)}</span></button>`;
const dataStr = o => Object.entries(o).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');

function reasonHtml(b) {
  if (!b.proposed) return '';
  if (!b.reasons.length) return `<div class="blk">Не удалось подобрать метрики по этой цели. Выберите системы и зоны вручную ниже или уточните цель.</div>`;
  const nm = r => (r.kind === 'sys' ? CAT.systems : CAT.zones).find(x => x.id === r.id).label;
  return `<ul class="why-list">${b.reasons.map(r => `<li><b>${esc(nm(r))}</b> — ${esc(r.why)}</li>`).join('')}</ul>`;
}

function sysCard(b, base, id) {
  const sec = id === 'NET' ? CAT.net_system.section_def : base.sections.find(s => s.system === id);
  const label = id === 'NET' ? CAT.net_system.label : base.systems[id].label;
  const types = id === 'NET' ? CAT.net_system.element_types : [...(base.element_types[id] || [])];
  const typesAll = id === 'NET' ? types : [
    ...types.slice(0, Math.max(0, types.length - 1)),
    ...(CAT.element_types_add[id] || []).filter(t => !types.some(x => x.id === t.id)),
    ...types.slice(-1),
  ];
  const offI = b.off.items[sec.id] || {}, offR = b.off.readings[sec.id] || {}, offT = b.off.types[id] || {};
  const readings = [...(sec.readings || []), ...(CAT.extra_readings[id] || [])];
  const extraItems = (CAT.extra_items[id] || []).map((t, n) => ({ id: 'e' + (n + 1), text: t, extra: true }));
  const items = [...(sec.items || []), ...extraItems];
  const addI = b.add.items[sec.id] || [], addR = b.add.readings[sec.id] || [], addT = b.add.types[id] || [];
  return `<details class="card bld-sys" data-sys="${id}"${b.open[id] ? ' open' : ''}><summary><b>${esc(label)}</b>
      <small>типов ${typesAll.length - Object.keys(offT).length + addT.length} · пунктов ${items.length - Object.keys(offI).length + addI.length} · показаний ${readings.length - Object.keys(offR).length + addR.length}</small></summary>
    <h3>Типы элементов</h3>
    ${typesAll.map(t => tgl(!offT[t.id], t.label, 'bld-type', dataStr({ sys: id, id: t.id }))).join('')}
    ${addT.map((t, n) => `<div class="tgl on custom"><i>＋</i><span>${esc(t)}</span><button type="button" class="x" data-act="bld-del" data-kind="types" data-sys="${id}" data-n="${n}">×</button></div>`).join('')}
    <div class="addrow"><input class="in" id="bt-${id}" placeholder="свой тип элемента"><button class="btn sm" data-act="bld-add-type" data-sys="${id}">Добавить</button></div>
    <h3>Пункты чек-листа</h3>
    ${items.map(i => tgl(!offI[i.id], i.text, 'bld-item', dataStr({ sec: sec.id, id: i.id }), !!i.key)).join('')}
    ${addI.map((t, n) => `<div class="tgl on custom"><i>＋</i><span>${esc(t)}</span><button type="button" class="x" data-act="bld-del" data-kind="items" data-sec="${sec.id}" data-n="${n}">×</button></div>`).join('')}
    <div class="addrow"><input class="in" id="bi-${sec.id}" placeholder="свой пункт (да / нет / нет доступа)"><button class="btn sm" data-act="bld-add-item" data-sec="${sec.id}">Добавить</button></div>
    <h3>Показания</h3>
    ${readings.length ? readings.map(r => tgl(!offR[r.id], `${r.label} (${r.units[0]})`, 'bld-read', dataStr({ sec: sec.id, id: r.id }))).join('') : '<p class="hint">Показаний в этой системе по умолчанию нет.</p>'}
    ${addR.map((r, n) => `<div class="tgl on custom"><i>＋</i><span>${esc(r.label)} (${esc(r.unit)})</span><button type="button" class="x" data-act="bld-del" data-kind="readings" data-sec="${sec.id}" data-n="${n}">×</button></div>`).join('')}
    <div class="addrow"><input class="in" id="br-${sec.id}" placeholder="своё показание, например: влажность"><input class="in sm" id="bu-${sec.id}" placeholder="ед."><button class="btn sm" data-act="bld-add-read" data-sec="${sec.id}">Добавить</button></div>
  </details>`;
}

export function screenGoal() {
  const b = builder(), base = A.base;
  const custom = b.mode === 'custom';
  const goals = CAT.goals.map(g => `<button type="button" class="chip${b.goalIds.includes(g.id) ? ' on' : ''}" data-act="bld-goal" data-id="${g.id}">${esc(g.label)}</button>`).join('');
  let body = '';
  if (custom) {
    body = `<section class="card"><h2>Цель обследования</h2>
      <p class="hint">Выберите типовые цели и/или опишите свою. Приложение предложит системы и метрики, вы их уточните.</p>
      <div class="chips">${goals}</div>
      <label class="fl">Своими словами<textarea class="in" id="bld-text" rows="3" placeholder="например: оценить состояние электропроводки, водоснабжения и отопления в помещении перед установкой датчиков">${esc(b.goalText)}</textarea></label>
      <button class="btn big" data-act="bld-propose">Подобрать метрики</button></section>`;
    if (b.proposed) {
      const sysIds = CAT.systems.map(s => s.id);
      body += `<section class="card"><h2>Что предложило приложение</h2>${reasonHtml(b)}
        <p class="hint">Ниже можно включить и выключить любую зону и систему.</p></section>
        <section class="card"><h2>Зоны здания</h2>${CAT.zones.map(z => tgl(!!b.zones[z.id], z.label, 'bld-zone', dataStr({ id: z.id }))).join('')}</section>
        <section class="card"><h2>Системы</h2>${CAT.systems.map(s => tgl(!!b.sys[s.id], s.label, 'bld-sys', dataStr({ id: s.id }))).join('')}</section>
        ${sysIds.filter(id => b.sys[id]).map(id => sysCard(b, base, id)).join('')}
        <section class="card"><h2>Фото-кадры для каждого элемента</h2>
          <p class="hint">Для 🔒 кадров завязаны цепочка PASS и контроль перед уходом, их отключить нельзя.</p>
          ${base.photo_slots.map(s => tgl(!b.off.slots[s.id], s.label, 'bld-slot', dataStr({ id: s.id }), CAT.locked_slots.includes(s.id))).join('')}
          ${b.add.slots.map((s, n) => `<div class="tgl on custom"><i>＋</i><span>${esc(s.label)}</span><button type="button" class="x" data-act="bld-del" data-kind="slots" data-n="${n}">×</button></div>`).join('')}
          <div class="addrow"><input class="in" id="bs-new" placeholder="свой кадр, например: общий вид стены"><button class="btn sm" data-act="bld-add-slot">Добавить</button></div></section>`;
      const cfg = composeCfg(base, b), sm = summaryOf(cfg);
      body += `<section class="card"><h2>Итоговый набор</h2>
        <dl class="kv2"><dt>Системы</dt><dd>${sm.systems.length ? esc(sm.systems.join(', ')) : '—'}</dd><dt>Зоны</dt><dd>${sm.zones.length ? esc(sm.zones.join(', ')) : 'нет'}</dd>
        <dt>Пунктов</dt><dd>${sm.items}</dd><dt>Показаний</dt><dd>${sm.readings}</dd><dt>Фото-кадров</dt><dd>${sm.slots}</dd><dt>Проверок перед уходом</dt><dd>${sm.controls}</dd></dl>
        ${sm.systems.length || sm.zones.length ? '' : '<div class="blk">Не выбрано ни одной системы или зоны.</div>'}
        <button class="btn big" data-act="bld-use"${sm.systems.length || sm.zones.length ? '' : ' disabled'}>Использовать этот набор</button></section>`;
    }
  } else {
    body = `<section class="card"><p>Протокол <b>${esc(base.protocol.code)}</b> без изменений: подвал, ГРЩ, лифты, кровля, отопление, ХВС, ГВС, канализация и электроснабжение.</p>
      <a class="btn big" href="#/new" data-act="bld-std">Дальше: адрес и карта</a></section>`;
  }
  return {
    title: 'Цель обследования', sub: 'шаг 1 из 2', back: '#/', nav: false,
    html: `<section class="card"><h2>Как собрать обследование</h2>
      <div class="seg"><button type="button" class="${custom ? '' : 'on'}" data-act="bld-mode" data-m="standard">Стандартный протокол</button><button type="button" class="${custom ? 'on' : ''}" data-act="bld-mode" data-m="custom">Под мою цель</button></div>
      <p class="hint">${custom ? 'Вы описываете цель, приложение предлагает набор метрик, вы его уточняете.' : 'Готовый протокол «МКД: Huawei/Билайн», как раньше.'}</p></section>${body}`,
    mount: () => {
      const t = document.getElementById('bld-text');
      if (t) t.addEventListener('input', () => { builder().goalText = t.value; saveBuilder(); });
      const root = document.querySelector('main');
      if (root) root.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.sys) { builder().open[d.dataset.sys] = d.open; saveBuilder(); } }, true);
    },
  };
}

export function registerBuilderActions() {
  const a = ui.actions;
  const redraw = () => { saveBuilder(); ui.render(true); };
  const flip = (map, ...keys) => {
    let o = map;
    keys.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; });
    const k = keys[keys.length - 1];
    if (o[k]) delete o[k]; else o[k] = true;
  };
  a['bld-mode'] = el => { const b = builder(); b.mode = el.dataset.m; b.ready = false; redraw(); };
  a['bld-std'] = () => { const b = builder(); b.mode = 'standard'; b.ready = true; saveBuilder(); ui.go('#/new'); };
  a['bld-goal'] = el => { const b = builder(), id = el.dataset.id; b.goalIds = b.goalIds.includes(id) ? b.goalIds.filter(x => x !== id) : [...b.goalIds, id]; b.ready = false; redraw(); };
  a['bld-propose'] = () => {
    const b = builder();
    const t = document.getElementById('bld-text'); if (t) b.goalText = t.value;
    if (!b.goalIds.length && !b.goalText.trim()) { toast('Выберите цель или опишите её своими словами', 'err'); return; }
    propose(b); redraw();
    toast(b.reasons.length ? 'Метрики подобраны. Проверьте и уточните' : 'Метрики подобрать не удалось: выберите вручную', b.reasons.length ? 'ok' : 'err');
  };
  a['bld-zone'] = el => { const b = builder(); flip(b.zones, el.dataset.id); b.ready = false; redraw(); };
  a['bld-sys'] = el => { const b = builder(); flip(b.sys, el.dataset.id); b.ready = false; redraw(); };
  a['bld-item'] = el => { const b = builder(); flip(b.off.items, el.dataset.sec, el.dataset.id); b.ready = false; redraw(); };
  a['bld-read'] = el => { const b = builder(); flip(b.off.readings, el.dataset.sec, el.dataset.id); b.ready = false; redraw(); };
  a['bld-type'] = el => { const b = builder(); flip(b.off.types, el.dataset.sys, el.dataset.id); b.ready = false; redraw(); };
  a['bld-slot'] = el => { const b = builder(); flip(b.off.slots, el.dataset.id); b.ready = false; redraw(); };
  a['bld-lock'] = () => toast('Этот пункт нужен для цепочки PASS и контроля, отключить нельзя');
  const val = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  a['bld-add-type'] = el => { const t = val('bt-' + el.dataset.sys); if (!t) return; const b = builder(); (b.add.types[el.dataset.sys] = b.add.types[el.dataset.sys] || []).push(t); b.ready = false; redraw(); };
  a['bld-add-item'] = el => { const t = val('bi-' + el.dataset.sec); if (!t) return; const b = builder(); (b.add.items[el.dataset.sec] = b.add.items[el.dataset.sec] || []).push(t); b.ready = false; redraw(); };
  a['bld-add-read'] = el => { const t = val('br-' + el.dataset.sec); if (!t) return; const b = builder(); (b.add.readings[el.dataset.sec] = b.add.readings[el.dataset.sec] || []).push({ label: t, unit: val('bu-' + el.dataset.sec) || 'ед.' }); b.ready = false; redraw(); };
  a['bld-add-slot'] = () => { const t = val('bs-new'); if (!t) return; const b = builder(); b.add.slots.push({ label: t }); b.ready = false; redraw(); };
  a['bld-del'] = el => {
    const b = builder(), n = +el.dataset.n, k = el.dataset.kind;
    if (k === 'slots') b.add.slots.splice(n, 1);
    else if (k === 'types') b.add.types[el.dataset.sys].splice(n, 1);
    else b.add[k][el.dataset.sec].splice(n, 1);
    b.ready = false; redraw();
  };
  a['bld-use'] = () => {
    const b = builder();
    const cfg = composeCfg(A.base, b);
    if (!cfg.sections.some(s => s.kind === 'system' || s.kind === 'area')) { toast('Выберите хотя бы одну систему или зону', 'err'); return; }
    b.ready = true; saveBuilder();
    toast('Набор метрик сохранён', 'ok');
    ui.go('#/new');
  };
}
