// Реестр компонентов (Component Register), реестр фото и схема мониторинга (Monitoring Map).
// Все три собираются из данных обследования автоматически: фото попадает в них сразу после съёмки.
import {
  A, allObjects, activeObjects, sectionCfg, sysCfg, photosOf, locString, readingDefs, evidenceFull, photoAttr,
  commsRows, zoneList, nowISO, elementTypeOf, linkEdges, model3dState,
} from './model.js';
import { esc, LBL, STATUS, download, fmtDT } from './util.js';
import { ui, pill, thumbs, hydrate, toast } from './ui.js';

const byId = (a, b) => (a.photo_id < b.photo_id ? -1 : 1);
const NA = 'Не указано';

export const attrOf = p => p.attr || { ...photoAttr(p.scope, p.ref, p.slot), snapshot: false };

// ---------- реестр фото ----------
export function photoRegister(files = {}) {
  return [...A.PH.values()].sort(byId).map(p => {
    const at = attrOf(p);
    const o = p.scope === 'object' ? A.S.objects[p.ref] : null;
    const now = o ? locString(o) : null;
    return {
      photo_id: p.photo_id, file: files[p.photo_id]?.path || '', sha256: files[p.photo_id]?.sha256 || '',
      subject: at.subject, field_id: at.field_id || '', object_uid: at.object_uid || (o && o.uid) || '', element_type: at.element_type || '', ifc_class: at.ifc_class || '', zone: at.zone_label || '',
      section: [at.section_num, at.section_title].filter(Boolean).join(' '), system: at.system || '',
      slot: p.slot, slot_label: at.slot_label || '',
      component: at.component_name || '', location_at_capture: at.location_text || '',
      location_now: now ?? '', location_changed: !!(now != null && at.snapshot !== false && now !== at.location_text),
      author: at.author || '', captured_at: p.captured_at, revision: at.revision ?? '',
      source: p.source, width: p.w, height: p.h, size: p.size,
      people_or_personal_data: !!(p.flags && p.flags.people), void: !!p.void, void_reason: p.void_reason || '',
      attributed_at_capture: at.snapshot !== false,
    };
  });
}

// ---------- реестр компонентов ----------
export function componentRegister() {
  return allObjects().map(o => {
    const sec = sectionCfg(o.section), sy = sysCfg(o.system);
    const ph = photosOf('object', o.field_id);
    const et = elementTypeOf(o), m3 = model3dState(o), ed = linkEdges();
    return {
      field_id: o.field_id, uid: o.uid || '', key: `${A.S.object_code} / ${o.field_id}`,
      element_type: et ? et.label : (o.element && o.element.type_other) || '', ifc_class: et ? et.ifc : '',
      manufacturer: o.plate.manufacturer, model: o.plate.model, serial: o.plate.serial, rating: o.plate.rating,
      dn_mm: o.dims.dn_mm, length_m: o.dims.length_m, size_mm: o.dims.size, position_note: o.dims.position_note, scale_ref_in_photo: o.dims.scale_ref || '',
      receives_from: ed.filter(e => e.type === 'feeds' && e.dst === o.field_id).map(e => e.src),
      feeds_to: ed.filter(e => e.type === 'feeds' && e.src === o.field_id).map(e => e.dst),
      connected_to: ed.filter(e => e.type === 'connected' && (e.src === o.field_id || e.dst === o.field_id)).map(e => (e.src === o.field_id ? e.dst : e.src)),
      has_type: m3.type, has_links: m3.links, has_dimensions: m3.dims, has_nameplate: m3.plate,
      system: o.system, system_label: sy.label, priority: sy.priority, section: sec.num,
      status: o.status, void_reason: o.void_reason || '',
      component_state: o.component.state || '', component_name: o.component.name || '',
      entrance: o.location.entrance || '', level: o.location.level || '', room: o.location.room || '', landmark: o.location.landmark || '',
      access: o.access || '', existing_instrument: o.instrument || '', power: o.power || '',
      mobile_signal: o.signal || '', potential_observation_location: o.obs_location || '',
      visible_anomaly: o.anomaly.state || '',
      readings: readingDefs(o).map(d => {
        const r = o.readings[d.id] || {};
        return r.value ? `${d.label}: ${r.value} ${r.unit || ''}`.trim() : '';
      }).filter(Boolean),
      evidence_full: o.status === 'active' ? evidenceFull(o) : false,
      photo_count: ph.length, photo_ids: ph.map(p => p.photo_id),
    };
  });
}

// ---------- схема мониторинга ----------
export function monitoringMap() {
  const S = A.S, cfg = A.cfg;
  const lv = cfg.location.levels, rm = cfg.location.rooms;
  const order = (list, v) => { const i = list.indexOf(v); return i < 0 ? 999 : i; };
  const comp = o => {
    const ph = photosOf('object', o.field_id);
    const cover = ph.find(p => p.slot === 'whole_object') || ph[0];
    const et = elementTypeOf(o);
    return {
      field_id: o.field_id, uid: o.uid || '', element_type: et ? et.label : (o.element && o.element.type_other) || '', ifc_class: et ? et.ifc : '',
      nameplate: { ...o.plate }, dimensions: { dn_mm: o.dims.dn_mm, length_m: o.dims.length_m, size_mm: o.dims.size, position_note: o.dims.position_note, scale_ref_in_photo: o.dims.scale_ref },
      ready_3d: model3dState(o),
      system: o.system, system_label: sysCfg(o.system).label, priority: sysCfg(o.system).priority,
      name: o.component.name || (o.component.state === 'UNKNOWN' ? 'UNKNOWN' : sysCfg(o.system).label),
      component_state: o.component.state, landmark: o.location.landmark || '',
      monitoring: {
        existing_instrument: o.instrument, power_220v: o.power, mobile_signal: o.signal,
        potential_observation_location: o.obs_location,
        readings: readingDefs(o).map(d => ({ label: d.label, value: (o.readings[d.id] || {}).value || '', unit: (o.readings[d.id] || {}).unit || '' })).filter(r => r.value),
      },
      evidence_full: evidenceFull(o), photo_ids: ph.map(p => p.photo_id), cover_photo_id: cover ? cover.photo_id : null,
    };
  };
  const objs = activeObjects();
  const ents = new Map();
  objs.forEach(o => {
    const L = o.location, e = L.entrance || NA, l = L.level || NA, r = L.room || NA;
    if (!ents.has(e)) ents.set(e, new Map());
    const lm = ents.get(e);
    if (!lm.has(l)) lm.set(l, new Map());
    const rmm = lm.get(l);
    if (!rmm.has(r)) rmm.set(r, []);
    rmm.get(r).push(comp(o));
  });
  const entrances = [...ents.keys()].sort((a, b) => (a === NA) - (b === NA) || a.localeCompare(b, 'ru', { numeric: true })).map(e => ({
    entrance: e,
    levels: [...ents.get(e).keys()].sort((a, b) => order(lv, a) - order(lv, b)).map(l => ({
      level: l,
      rooms: [...ents.get(e).get(l).keys()].sort((a, b) => order(rm, a) - order(rm, b)).map(r => ({ room: r, components: ents.get(e).get(l).get(r) })),
    })),
  }));
  const areas = [
    { id: 'house', label: 'Дом целиком', access: null, photo_ids: photosOf('section', 'CL01', 'house_general').map(p => p.photo_id) },
    ...cfg.sections.filter(s => s.kind === 'area' && s.zone).map(s => ({
      id: s.id, label: `${s.num} ${s.title}`, access: S.zones[s.zone].access, photo_ids: photosOf('section', s.id, 'area').map(p => p.photo_id),
    })),
  ];
  const comms = commsRows().map(r => ({
    zone: r.zc.id, label: r.zc.label, no_access: !!r.noAccess, not_applicable: r.na || null,
    power_220v: r.power.value || null, mobile_signal: r.signal.value || null,
    screenshot_photo_ids: photosOf('zone', r.zc.id, 'screenshot').map(p => p.photo_id),
  }));
  // плоский граф для импорта в схемы и GIS
  const nodes = [{ id: S.object_code, type: 'building', label: S.address }], edges = [];
  entrances.forEach(e => {
    const eid = `${S.object_code}/${e.entrance}`;
    nodes.push({ id: eid, type: 'entrance', label: e.entrance }); edges.push({ from: S.object_code, to: eid, type: 'contains' });
    e.levels.forEach(l => {
      const lid = `${eid}/${l.level}`;
      nodes.push({ id: lid, type: 'level', label: l.level }); edges.push({ from: eid, to: lid, type: 'contains' });
      l.rooms.forEach(r => {
        const rid = `${lid}/${r.room}`;
        nodes.push({ id: rid, type: 'room', label: r.room }); edges.push({ from: lid, to: rid, type: 'contains' });
        r.components.forEach(c => {
          nodes.push({ id: c.field_id, type: 'component', label: c.name, system: c.system, uid: c.uid, element_type: c.element_type, ifc_class: c.ifc_class }); edges.push({ from: rid, to: c.field_id, type: 'contains' });
          c.photo_ids.forEach(pid => { edges.push({ from: c.field_id, to: pid, type: 'evidenced_by' }); });
        });
      });
    });
  });
  const connections = linkEdges().map(e => ({ from: e.src, to: e.dst, type: e.type, note: e.note }));
  connections.forEach(e => edges.push({ from: e.from, to: e.to, type: e.type, note: e.note }));
  A.PH.forEach(p => { if (!p.void) nodes.push({ id: p.photo_id, type: 'photo', label: attrOf(p).slot_label || p.slot }); });
  return {
    kind: 'hm-field-monitoring-map', generated_at: nowISO(),
    object: { code: S.object_code, address: S.address, geo: S.geo || null }, revision: S.revision, status: S.status,
    entrances, areas, comms_power: comms, connections,
    counters: { components: objs.length, photos: [...A.PH.values()].filter(p => !p.void).length },
    graph: { nodes, edges },
  };
}

// ---------- реестр связей ----------
export function connectionRegister() {
  const idx = Object.fromEntries(allObjects().map(o => [o.field_id, o]));
  const lab = id => (idx[id] ? idx[id].component.name || '' : '');
  return linkEdges().map(e => ({
    from_field_id: e.src, from_uid: idx[e.src].uid || '', from_name: lab(e.src),
    to_field_id: e.dst, to_uid: idx[e.dst].uid || '', to_name: lab(e.dst),
    type: e.type === 'feeds' ? 'передаёт (направленная)' : 'соединён (без направления)', note: e.note,
  }));
}

// ---------- CSV ----------
const cell = v => {
  if (v == null) return '';
  const t = typeof v === 'boolean' ? (v ? 'да' : 'нет') : Array.isArray(v) ? v.join(' | ') : String(v);
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function toCSV(rows) {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => cell(r[c])).join(';'))].join('\r\n');
}

// ---------- блок для печатного протокола ----------
export function registryReportHTML(gallery) {
  const comps = componentRegister(), phs = photoRegister().filter(p => !p.void), map = monitoringMap(), conns = connectionRegister();
  const tree = map.entrances.map(e => `<h3>${esc(e.entrance)}</h3>${e.levels.map(l => `<p class="m"><b>${esc(l.level)}</b></p>${l.rooms.map(r =>
    `<div class="obj"><b>${esc(r.room)}</b><table class="t">${r.components.map(c => `<tr><td><b>${esc(c.field_id)}</b><br>${esc(c.system_label)}</td>
    <td>${esc(c.name)}${c.landmark ? `<br><span class="m">${esc(c.landmark)}</span>` : ''}</td>
    <td class="s">220 В: ${esc(c.monitoring.power_220v || '—')} · сеть: ${esc(c.monitoring.mobile_signal || '—')} · место наблюдения: ${esc(c.monitoring.potential_observation_location || '—')}</td></tr>
    <tr><td colspan="3">${gallery(c.photo_ids)}</td></tr>`).join('')}</table></div>`).join('')}`).join('')}`).join('');
  const areas = map.areas.map(a => `<p><b>${esc(a.label)}</b>${a.access ? ' — доступ ' + esc(LBL.access[a.access] || a.access) : ''}</p>${gallery(a.photo_ids)}`).join('');
  return `<section><h2>СХЕМА МОНИТОРИНГА (MONITORING MAP)</h2><p class="m">Расположение компонентов: подъезд → уровень → помещение. Фото привязаны к компонентам.</p>${tree || '<p>Компонентов нет.</p>'}<h3>Общие виды и зоны</h3>${areas}</section>
  <section><h2>РЕЕСТР КОМПОНЕНТОВ (COMPONENT REGISTER)</h2><table class="t"><tr><th>Field ID</th><th>Система</th><th>Компонент</th><th>Тип (IFC)</th><th>Локация</th><th>Статус</th><th>Фото</th></tr>${comps.map(c =>
    `<tr><td>${esc(c.field_id)}</td><td>${esc(c.system_label)}</td><td>${esc(c.component_name || c.component_state || '—')}</td><td>${esc(c.element_type || '—')}${c.ifc_class ? '<br><span class="m">' + esc(c.ifc_class) + '</span>' : ''}</td><td>${esc([c.entrance, c.level, c.room].filter(Boolean).join(' · '))}${c.landmark ? ' — ' + esc(c.landmark) : ''}</td><td>${c.status === 'void' ? 'VOID' : c.evidence_full ? 'полное evidence' : 'не полностью'}</td><td>${c.photo_count}</td></tr>`).join('')}</table></section>
  <section><h2>СВЯЗИ КОМПОНЕНТОВ</h2>${conns.length ? `<table class="t"><tr><th>От</th><th>Связь</th><th>К</th><th>Примечание</th></tr>${conns.map(c => `<tr><td>${esc(c.from_field_id)} ${esc(c.from_name)}</td><td>${esc(c.type)}</td><td>${esc(c.to_field_id)} ${esc(c.to_name)}</td><td>${esc(c.note)}</td></tr>`).join('')}</table>` : '<p>Связи между компонентами не указаны.</p>'}</section>
  <section><h2>РЕЕСТР ФОТО</h2><table class="t"><tr><th>Photo ID</th><th>К чему относится</th><th>Кадр</th><th>Где</th><th>Снято</th></tr>${phs.map(p =>
    `<tr><td>${esc(p.photo_id)}</td><td>${esc(p.field_id || p.zone || p.section)}</td><td>${esc(p.slot_label)}</td><td>${esc(p.location_at_capture || '—')}</td><td>${esc(fmtDT(p.captured_at))}, ${esc(p.author)}</td></tr>`).join('')}</table></section>`;
}

// ---------- экран «Реестр и схема» ----------
const SYS_CLS = { HEAT: 'heat', CWS: 'cws', HWS: 'hws', SEWER: 'sew', ELECTRICAL: 'el', LIFT: 'lift', ENV: 'env', OTHER: 'oth' };
const tag = c => `<span class="sys s-${SYS_CLS[c.system] || 'oth'}">${esc(c.system)}</span>`;
const lab = (l, v) => `${l} ${v ? esc(v) : '—'}`;

function compBlock(c) {
  return `<div class="cmp"><a class="cmp-h" href="#/obj/${esc(c.field_id)}">${tag(c)}<b>${esc(c.field_id)}</b> ${esc(c.name)}</a>
    ${c.landmark ? `<div class="hint">${esc(c.landmark)}</div>` : ''}
    ${c.element_type ? `<div class="hint">Тип: ${esc(c.element_type)}${c.ifc_class ? ' · ' + esc(c.ifc_class) : ''}</div>` : ''}
    <div class="mon"><span>${lab('220 В', c.monitoring.power_220v)}</span><span>${lab('сеть', c.monitoring.mobile_signal)}</span><span>${lab('место наблюдения', c.monitoring.potential_observation_location)}</span></div>
    ${thumbs(c.photo_ids, { empty: 'Фото пока нет' })}</div>`;
}

function schemeTab() {
  const m = monitoringMap();
  const tree = m.entrances.map(e => `<section class="card"><h2>${esc(e.entrance)}</h2>${e.levels.map(l => `<div class="lvl"><div class="lvl-h">${esc(l.level)}</div>${l.rooms.map(r =>
    `<div class="room"><div class="room-h">${esc(r.room)}</div>${r.components.map(compBlock).join('')}</div>`).join('')}</div>`).join('')}</section>`).join('');
  const areas = m.areas.filter(a => a.photo_ids.length).map(a => `<div class="room"><div class="room-h">${esc(a.label)}${a.access ? ` · доступ ${esc(LBL.access[a.access] || a.access)}` : ''}</div>${thumbs(a.photo_ids)}</div>`).join('');
  return `<p class="hint">Схема строится сама из карточек: подъезд, уровень, помещение, компонент и его фото. Чтобы объект попал в нужное место, заполните его локацию.</p>
  ${tree || '<div class="blk">Компонентов пока нет. Добавьте объекты в разделах ЧЛ-03…ЧЛ-12.</div>'}
  ${areas ? `<section class="card"><h2>Общие виды и зоны</h2>${areas}</section>` : ''}`;
}
function compTab() {
  const rows = componentRegister();
  return `<p class="hint">Реестр компонентов: все Field Objects, включая VOID. ${rows.length ? '' : 'Пока пусто.'}</p>` + rows.map(c =>
    `<a class="reg-i${c.status === 'void' ? ' void' : ''}" href="#/obj/${esc(c.field_id)}"><span class="fid">${esc(c.field_id)}</span>
    <span class="mt"><b>${esc(c.component_name || c.component_state || c.system_label)}</b><small>${esc([c.entrance, c.level, c.room].filter(Boolean).join(' · ')) || 'локация не указана'}</small>
    <small>${esc(c.element_type || 'тип не выбран')} · фото: ${c.photo_count}</small><small>для 3D: ${c.has_type ? '✓' : '—'} тип ${c.has_links ? '✓' : '—'} связи ${c.has_dimensions ? '✓' : '—'} размеры ${c.has_nameplate ? '✓' : '—'} шильдик</small></span>${pill(c.status === 'void' ? 'absent' : c.evidence_full ? 'closed' : 'in_progress', c.status === 'void' ? 'VOID' : c.evidence_full ? 'полное' : 'не полностью')}</a>`).join('');
}
function photoTab() {
  const rows = photoRegister();
  return `<p class="hint">Реестр фото: у каждого снимка записано, к чему он относится, где находится объект, кто и когда снял. Данные фиксируются в момент съёмки.</p>` + rows.map(p =>
    `<div class="reg-p${p.void ? ' void' : ''}">${thumbs([p.photo_id])}<div class="mt"><b>${esc(p.photo_id)}</b> ${p.void ? '· VOID' : ''}
    <small>${esc(p.field_id || p.zone || p.section)} · ${esc(p.slot_label)}</small>
    <small>${esc(p.location_at_capture || '—')}${p.location_changed ? ' (локация позже изменена: ' + esc(p.location_now) + ')' : ''}</small>
    <small>${esc(fmtDT(p.captured_at))} · ${esc(p.author)}${p.attributed_at_capture ? '' : ' · атрибуты восстановлены позже'}</small></div></div>`).join('');
}

export function screenRegistry(q) {
  const t = q.get('t') || 'scheme';
  const tabs = [['scheme', 'Схема'], ['comp', 'Компоненты'], ['photos', 'Фото']];
  const body = t === 'comp' ? compTab() : t === 'photos' ? photoTab() : schemeTab();
  return {
    title: 'Реестр и схема', sub: `компонентов: ${activeObjects().length} · фото: ${[...A.PH.values()].filter(p => !p.void).length}`,
    back: '#/map', nav: true,
    html: `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/registry?t=${k}" class="${t === k ? 'on' : ''}">${l}</a>`).join('')}</div>${body}
    <section class="card"><h2>Выгрузка</h2><p class="hint">Эти же файлы автоматически входят в итоговый пакет.</p>
    <div class="row"><button class="btn ghost" data-act="reg-csv-comp">Реестр компонентов (CSV)</button>
    <button class="btn ghost" data-act="reg-csv-photo">Реестр фото (CSV)</button>
    <button class="btn ghost" data-act="reg-csv-conn">Связи (CSV)</button>
    <button class="btn ghost" data-act="reg-json-map">Схема (JSON)</button></div></section>`,
  };
}

export function registerRegistryActions() {
  const a = ui.actions;
  const stamp = () => nowISO().slice(0, 10);
  a['reg-csv-comp'] = () => { download(new Blob([toCSV(componentRegister())], { type: 'text/csv;charset=utf-8' }), `${A.S.object_code}_component_register_${stamp()}.csv`); toast('Реестр компонентов скачан'); };
  a['reg-csv-photo'] = () => { download(new Blob([toCSV(photoRegister())], { type: 'text/csv;charset=utf-8' }), `${A.S.object_code}_photo_register_${stamp()}.csv`); toast('Реестр фото скачан'); };
  a['reg-csv-conn'] = () => { download(new Blob([toCSV(connectionRegister())], { type: 'text/csv;charset=utf-8' }), `${A.S.object_code}_connections_${stamp()}.csv`); toast('Реестр связей скачан'); };
  a['reg-json-map'] = () => { download(new Blob([JSON.stringify(monitoringMap(), null, 2)], { type: 'application/json' }), `${A.S.object_code}_monitoring_map_${stamp()}.json`); toast('Схема скачана'); };
}
