// Модель данных и правила протокола. Здесь же — вся «умная» логика:
// блокировки закрытия, контроль перед уходом (ЧЛ-13), итог, цепочка PASS.
import * as db from './db.js';

export const A = {
  cfg: null,
  S: null,
  PH: new Map(),   // метаданные фото (без самих файлов)
  log: [],
  saveState: 'saved',
  listeners: new Set(),
};

export const APP_VERSION = '0.2.0';

// ---------- общие помощники ----------
export function nowISO() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}
const pad = (n, w) => String(n).padStart(w, '0');
const clip = v => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v);
export const clone = v => JSON.parse(JSON.stringify(v));

export async function loadConfig() {
  if (window.__PROTOCOL__) { A.cfg = window.__PROTOCOL__; return A.cfg; }
  const r = await fetch('data/protocol.json');
  A.cfg = await r.json();
  return A.cfg;
}

export const sectionCfg = id => A.cfg.sections.find(s => s.id === id);
export const sysCfg = s => A.cfg.systems[s];
export const isP1 = o => A.cfg.systems[o.system].priority === 'P1';
export const canEdit = () => !!A.S && A.S.status === 'draft';

export function emit() { A.listeners.forEach(f => f()); }

// ---------- сохранение ----------
let timer = null;
export function scheduleSave(ms = 250) {
  A.saveState = 'saving';
  emit();
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}
export async function flush() {
  clearTimeout(timer);
  if (!A.S) return;
  await db.kvSet('survey', A.S);
  A.saveState = 'saved';
  emit();
}
function touch() { A.S.meta.last_change_at = nowISO(); }

export function addLog(e) {
  const entry = { ts: nowISO(), rev: A.S ? A.S.revision : 0, ...e };
  A.log.push(entry);
  db.logAdd(entry).catch(() => {});
}

export const getAt = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function setAt(path, value, { log = true } = {}) {
  if (!canEdit()) return false;
  const parts = Array.isArray(path) ? path : String(path).split('.');
  let o = A.S;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  const k = parts[parts.length - 1];
  const old = o[k];
  if (old === value) return false;
  o[k] = value;
  touch();
  if (log) addLog({ kind: 'set', path: parts.join('.'), old: clip(old), new: clip(value) });
  scheduleSave();
  return true;
}
export function logTextChange(path, oldV, newV) {
  if (oldV === newV) return;
  addLog({ kind: 'set', path, old: clip(oldV), new: clip(newV) });
}

// ---------- создание обследования ----------
export function createSurvey({ inspector, representative, representative_org }) {
  const cfg = A.cfg;
  const S = {
    schema_version: cfg.schema_version,
    protocol_code: cfg.protocol.code,
    protocol_version: cfg.protocol.version,
    object_code: cfg.object.code,
    address: cfg.object.address,
    id_prefix: cfg.object.id_prefix,
    revision: 1,
    revision_note: '',
    status: 'draft',
    started_at: nowISO(),
    finished_at: null,
    inspector: { name: inspector.trim() },
    representative: { name: representative.trim(), org: (representative_org || '').trim() },
    entrances_count: null,
    zones: {},
    sections: {},
    objects: {},
    comms: {},
    closure: { gap_reasons: {}, no_tamper: null, no_tamper_note: '', candidate: null, materials: {}, summary_note: '' },
    signatures: {},
    counters: { P: 0 },
    meta: { created_at: nowISO(), last_change_at: nowISO(), last_export_at: null, last_backup_at: null },
  };
  cfg.access_zones.forEach(z => {
    S.zones[z.id] = { id: z.id, label: z.label, values: z.values, builtin: true, access: null, granted_by: '', reason: '' };
  });
  cfg.sections.forEach(s => {
    S.sections[s.id] = { state: 'open', outcome: null, reason: '', closed_at: null, items: {}, fields: {}, observation: '' };
  });
  cfg.comms_zones.forEach(z => {
    S.comms[z.id] = { power: null, signal: null, no_shot_reason: '' };
  });
  Object.values(cfg.systems).forEach(s => { S.counters[s.code] = 0; });
  A.S = S;
  A.PH = new Map();
  A.log = [];
  addLog({ kind: 'survey_created' });
  return S;
}

export async function initState() {
  await loadConfig();
  const S = await db.kvGet('survey');
  if (!S) return false;
  A.S = S;
  const photos = await db.photoAll();
  A.PH = new Map(photos.map(p => [p.photo_id, stripBlobs(p)]));
  A.log = await db.logAll();
  reconcileCounters();
  return true;
}

function stripBlobs(p) { const { blob, thumb, ...meta } = p; return meta; }

// Если вкладка закрылась между записью фото и записью счётчика — не допускаем повторных номеров.
function reconcileCounters() {
  const S = A.S;
  for (const id of A.PH.keys()) {
    const n = parseInt(id.split('-P-')[1], 10);
    if (n > S.counters.P) S.counters.P = n;
  }
  for (const o of Object.values(S.objects)) {
    const code = sysCfg(o.system).code;
    const n = parseInt(o.field_id.split('-').pop(), 10);
    if (n > (S.counters[code] || 0)) S.counters[code] = n;
  }
}

export async function replaceFromBackup({ survey, photos, log, revisions }) {
  await db.replaceAll({ survey, photos, log, revisions });
  await initState();
}

export async function wipeDevice() {
  await db.wipeAll();
  A.S = null; A.PH = new Map(); A.log = [];
}

// ---------- зоны доступа ----------
export const zoneList = () => Object.values(A.S.zones);
export const zoneRestricted = z => ['LIMITED', 'NO', 'UNSAFE'].includes(z.access);
export function addZone(label) {
  if (!canEdit() || !label.trim()) return null;
  const n = Object.keys(A.S.zones).filter(k => k.startsWith('x')).length + 1;
  const id = 'x' + n;
  A.S.zones[id] = { id, label: label.trim(), values: ['YES', 'LIMITED', 'NO'], builtin: false, access: null, granted_by: '', reason: '' };
  addLog({ kind: 'zone_add', id, label });
  touch(); scheduleSave();
  return id;
}

// ---------- подъезды ----------
export function entranceOptions() {
  const out = ['Не применимо (общее)'];
  const n = A.S.entrances_count || 0;
  for (let i = 1; i <= n; i++) out.push(`Подъезд ${i}`);
  return out;
}

// ---------- объекты (Field Objects) ----------
export function addObject(system) {
  if (!canEdit()) return null;
  const S = A.S;
  const code = sysCfg(system).code;
  S.counters[code] = (S.counters[code] || 0) + 1;
  const fid = `${S.id_prefix}-${code}-${pad(S.counters[code], 3)}`;
  S.objects[fid] = {
    field_id: fid, system, section: sysCfg(system).section,
    created_at: nowISO(), status: 'active', void_reason: '',
    location: { entrance: null, level: null, room: null, landmark: '' },
    access: null,
    component: { state: null, name: '' },
    observation: '',
    instrument: null,
    readings: {},
    anomaly: { state: null, text: '' },
    power: null, signal: null, obs_location: null,
    items: {}, slots: {},
  };
  addLog({ kind: 'object_add', field_id: fid, system });
  touch(); scheduleSave(0);
  return fid;
}

export function voidObject(fid, reason) {
  if (!canEdit() || !reason.trim()) return false;
  const o = A.S.objects[fid];
  o.status = 'void'; o.void_reason = reason.trim(); o.voided_at = nowISO();
  addLog({ kind: 'object_void', field_id: fid, reason });
  touch(); scheduleSave(0);
  return true;
}
export function restoreObject(fid) {
  if (!canEdit()) return false;
  const o = A.S.objects[fid];
  o.status = 'active'; o.void_reason = '';
  addLog({ kind: 'object_restore', field_id: fid });
  touch(); scheduleSave(0);
  return true;
}

export const allObjects = () => Object.values(A.S.objects).sort((a, b) => (a.field_id < b.field_id ? -1 : 1));
export const activeObjects = f => allObjects().filter(o => o.status === 'active' && (!f || f(o)));

export function itemByKey(secId, key) { return (sectionCfg(secId).items || []).find(i => i.key === key); }
export function objItem(o, key) {
  const it = itemByKey(o.section, key);
  return it ? o.items[it.id] : undefined;
}

export function readingDefs(o) {
  const sec = sectionCfg(o.section);
  if (sec.readings && sec.readings.length) return sec.readings;
  return [{ id: 'value', label: 'Показание', units: ['кВт·ч', 'м³', '°C', 'МПа', 'другое'] }];
}
export const hasReading = o => Object.values(o.readings || {}).some(r => r && r.value && r.value.trim());

export function locString(o) {
  const L = o.location;
  return [L.entrance, L.level, L.room].filter(Boolean).join(' · ') + (L.landmark ? ` — ${L.landmark}` : '');
}

// ---------- фото ----------
export function photosOf(scope, ref, slot) {
  return [...A.PH.values()]
    .filter(p => !p.void && p.scope === scope && p.ref === ref && (slot == null || p.slot === slot))
    .sort((a, b) => (a.captured_at < b.captured_at ? -1 : 1));
}
export const slotPhotos = (o, slot) => photosOf('object', o.field_id, slot);

export async function addPhoto({ scope, ref, slot, blob, thumb, w, h, source }) {
  if (!canEdit()) throw new Error('Обследование закрыто для правок');
  const S = A.S;
  S.counters.P += 1;
  const id = `${S.id_prefix}-P-${pad(S.counters.P, 4)}`;
  const rec = {
    photo_id: id, scope, ref, slot, captured_at: nowISO(), w, h,
    size: blob.size, mime: blob.type || 'image/jpeg', source,
    void: false, void_reason: '', flags: { people: false }, blob, thumb,
  };
  await db.photoPut(rec);
  A.PH.set(id, stripBlobs(rec));
  addLog({ kind: 'photo_add', photo_id: id, scope, ref, slot });
  touch();
  await flush();
  return id;
}

export async function patchPhoto(id, patch) {
  const rec = await db.photoGet(id);
  if (!rec) return;
  Object.assign(rec, patch);
  await db.photoPut(rec);
  A.PH.set(id, stripBlobs(rec));
  touch();
  scheduleSave(0);
}
export async function voidPhoto(id, reason) {
  if (!canEdit()) return;
  addLog({ kind: 'photo_void', photo_id: id, reason });
  await patchPhoto(id, { void: true, void_reason: reason || '' });
}
export async function togglePeople(id) {
  if (!canEdit()) return;
  const m = A.PH.get(id);
  const flags = { ...(m.flags || {}), people: !(m.flags && m.flags.people) };
  addLog({ kind: 'photo_flag', photo_id: id, people: flags.people });
  await patchPhoto(id, { flags });
}

const urlCache = new Map();
export async function photoURL(id, full = false) {
  const key = id + (full ? ':f' : ':t');
  if (urlCache.has(key)) return urlCache.get(key);
  const rec = await db.photoGet(id);
  if (!rec) return null;
  const b = full ? rec.blob : (rec.thumb || rec.blob);
  const u = URL.createObjectURL(b);
  urlCache.set(key, u);
  return u;
}
export const photoRecord = id => db.photoGet(id);

// ---------- слоты фотопротокола ----------
export function slotState(o, slotId) {
  if (slotPhotos(o, slotId).length) return 'taken';
  const s = o.slots[slotId];
  if (s && s.na && s.reason && s.reason.trim()) return 'na';
  return 'missing';
}
export const slotsMissing = o => A.cfg.photo_slots.filter(s => slotState(o, s.id) === 'missing');

// ---------- проверки объекта ----------
export function objectBlockers(o) {
  const b = [];
  const add = (tab, text) => b.push({ tab, text });
  const p1 = isP1(o);
  const sec = sectionCfg(o.section);
  if (!o.component.state) add('card', 'Компонент: выберите IDENTIFIED или UNKNOWN');
  else if (o.component.state === 'IDENTIFIED' && !o.component.name.trim()) add('card', 'Компонент: напишите, что это');
  if (o.component.state === 'UNKNOWN') {
    if (!o.observation.trim()) add('card', 'UNKNOWN: опишите наблюдение');
    if (!slotPhotos(o, 'general_room').length && !slotPhotos(o, 'whole_object').length) add('photo', 'UNKNOWN: нужен общий фото-кадр');
  }
  const L = o.location;
  if (!L.entrance) add('card', 'Локация: подъезд');
  if (!L.level) add('card', 'Локация: уровень');
  if (!L.room) add('card', 'Локация: помещение');
  if (p1 && !L.landmark.trim()) add('card', 'Локация: ориентир (как найти повторно)');
  if (!o.access) add('card', 'Доступ не указан');
  if (!o.instrument) add('card', 'Существующий прибор: выберите ответ');
  if (!o.anomaly.state) add('card', 'Видимая аномалия: выберите ответ');
  else if (o.anomaly.state === 'YES') {
    if (!o.anomaly.text.trim()) add('card', 'Видимая аномалия: опишите, что видно');
    if (!o.observation.trim()) add('card', 'Аномалия: добавьте наблюдение');
  }
  if (!o.power) add('card', 'Питание: выберите ответ');
  if (!o.signal) add('card', 'Мобильный сигнал: выберите ответ');
  if (!o.obs_location) add('card', 'Возможное место наблюдения: выберите ответ');
  if (hasReading(o) && !slotPhotos(o, 'readings').length) add('photo', 'Показание введено, но нет фото показаний');
  const items = sec.items || [];
  const unset = items.filter(i => !o.items[i.id]);
  if (unset.length) add('list', `Чек-лист: не отмечено пунктов — ${unset.length}`);
  if (p1) {
    const miss = slotsMissing(o);
    if (miss.length) add('photo', `Фотопротокол: нет кадра или причины — ${miss.length} из ${A.cfg.photo_slots.length}`);
  }
  return b;
}

export function evidenceFull(o) {
  if (!isP1(o) || o.status !== 'active' || o.access === 'NO') return false;
  if (objectBlockers(o).length) return false;
  if (!o.observation.trim()) return false;
  return slotState(o, 'whole_object') === 'taken' && slotState(o, 'closeup') === 'taken';
}

export function objectStatus(o) {
  if (o.status === 'void') return 'void';
  return objectBlockers(o).length ? 'incomplete' : 'ready';
}

// Явное действие обследователя: «ко всему остальному нет доступа».
export function markObjectNoAccess(fid) {
  if (!canEdit()) return;
  const o = A.S.objects[fid];
  const sec = sectionCfg(o.section);
  (sec.items || []).forEach(i => { if (!o.items[i.id] && !i.attest) o.items[i.id] = 'no_access'; });
  if (isP1(o)) {
    A.cfg.photo_slots.forEach(s => {
      if (slotState(o, s.id) === 'missing') o.slots[s.id] = { na: true, reason: 'нет доступа' };
    });
  }
  addLog({ kind: 'object_no_access_bulk', field_id: fid });
  touch(); scheduleSave(0);
}

// ---------- разделы ----------
export function sectionBlockers(id) {
  const sec = sectionCfg(id), st = A.S.sections[id], S = A.S;
  const b = [];
  const T = (text, extra = {}) => b.push({ text, ...extra });
  if (sec.kind === 'access') {
    const unset = sec.items.filter(i => !st.items[i.id]);
    if (unset.length) T(`Чек-лист: не отмечено пунктов — ${unset.length}`);
    if (S.entrances_count == null) T('Укажите фактическое количество подъездов');
    if (!photosOf('section', 'CL01', 'house_general').length) T('Нужно фото общего вида дома');
    zoneList().forEach(z => {
      if (!z.access) T(`Зона «${z.label}»: доступ не указан`);
      else if ((z.access === 'LIMITED' || z.access === 'NO') && !z.reason.trim()) T(`Зона «${z.label}»: укажите причину ограничения`);
    });
  } else if (sec.kind === 'area') {
    const z = S.zones[sec.zone];
    if (!z.access) T(`Укажите доступ в зону «${z.label}»`);
    else if (z.access === 'NO' || z.access === 'UNSAFE') {
      if (z.access === 'NO' && !z.reason.trim()) T('Укажите причину, почему доступа нет');
    } else {
      const unset = sec.items.filter(i => !st.items[i.id]);
      if (unset.length) T(`Чек-лист: не отмечено пунктов — ${unset.length}`);
      if (!photosOf('section', id, 'area').length) T('Нужно хотя бы одно фото раздела');
      (sec.fields || []).forEach(f => { if (st.fields[f.id] == null || st.fields[f.id] === '') T(`Заполните: ${f.label}`); });
    }
    if (sec.objects_system) {
      activeObjects(o => o.section === id).forEach(o =>
        objectBlockers(o).forEach(x => T(`${o.field_id}: ${x.text}`, { fid: o.field_id, tab: x.tab })));
    }
  } else if (sec.kind === 'system') {
    const objs = activeObjects(o => o.section === id);
    if (!objs.length) {
      if (!st.outcome) T('Объектов нет: добавьте объект или отметьте «нет доступа» / «отсутствует»');
      else if (!st.reason.trim()) T('Укажите причину');
    } else {
      objs.forEach(o => objectBlockers(o).forEach(x => T(`${o.field_id}: ${x.text}`, { fid: o.field_id, tab: x.tab })));
    }
  } else if (sec.kind === 'misc') {
    activeObjects(o => o.section === id).forEach(o =>
      objectBlockers(o).forEach(x => T(`${o.field_id}: ${x.text}`, { fid: o.field_id, tab: x.tab })));
  }
  return b;
}

export function closeSection(id) {
  if (!canEdit()) return { ok: false, blockers: [{ text: 'Обследование закрыто для правок' }] };
  const blockers = sectionBlockers(id);
  if (blockers.length) return { ok: false, blockers };
  const sec = sectionCfg(id), st = A.S.sections[id];
  let outcome = 'done';
  if (sec.kind === 'area') {
    const z = A.S.zones[sec.zone];
    if (z.access === 'NO' || z.access === 'UNSAFE') outcome = 'no_access';
  } else if (sec.kind === 'system') {
    if (!activeObjects(o => o.section === id).length) outcome = st.outcome;
  }
  st.state = 'closed'; st.outcome = outcome; st.closed_at = nowISO();
  addLog({ kind: 'section_close', section: id, outcome });
  touch(); scheduleSave(0);
  return { ok: true };
}
export function reopenSection(id) {
  if (!canEdit()) return;
  const st = A.S.sections[id];
  st.state = 'open';
  addLog({ kind: 'section_reopen', section: id });
  touch(); scheduleSave(0);
}

export function sectionStatus(id) {
  const sec = sectionCfg(id), st = A.S.sections[id];
  if (st.state === 'closed') {
    if (st.outcome === 'no_access') return { code: 'no_access', label: 'нет доступа' };
    if (st.outcome === 'absent') return { code: 'absent', label: 'отсутствует' };
    return { code: 'closed', label: 'закрыт' };
  }
  let started = Object.keys(st.items).length > 0 || st.observation || Object.keys(st.fields).length > 0 || st.outcome;
  if (activeObjects(o => o.section === id).length) started = true;
  if (sec.zone && A.S.zones[sec.zone].access) started = true;
  if (sec.kind === 'access' && (A.S.entrances_count != null || zoneList().some(z => z.access))) started = true;
  return started ? { code: 'in_progress', label: 'в работе' } : { code: 'not_started', label: 'не начат' };
}

export function sectionProgress(id) {
  const sec = sectionCfg(id), st = A.S.sections[id];
  if (sec.kind === 'system') {
    const objs = activeObjects(o => o.section === id);
    const ready = objs.filter(o => objectStatus(o) === 'ready').length;
    return { objects: objs.length, ready };
  }
  if (sec.kind === 'area' || sec.kind === 'access') {
    const total = sec.items.length;
    const done = sec.items.filter(i => st.items[i.id]).length;
    return { items: total, done, objects: sec.objects_system ? activeObjects(o => o.section === id).length : undefined };
  }
  return { objects: activeObjects(o => o.section === id).length };
}

// ---------- связь и питание (ЧЛ-10) ----------
function combine(list) {
  if (!list.length) return { value: null, conflict: false };
  const u = [...new Set(list)];
  return u.length === 1 ? { value: u[0], conflict: false } : { value: null, conflict: true };
}
export function commsDerived(zc) {
  const objs = activeObjects(o => zc.systems.includes(o.system));
  const powers = objs.map(o => o.power).filter(Boolean);
  const signals = objs.map(o => o.signal).filter(v => v && v !== 'NOT_CHECKED');
  if (zc.power_item) {
    const it = itemByKey(zc.power_item.section, zc.power_item.key);
    const v = A.S.sections[zc.power_item.section].items[it.id];
    if (v === 'checked') powers.push('YES');
    else if (v === 'absent') powers.push('NO');
    else if (v === 'tbd' || v === 'no_access') powers.push('UNKNOWN');
  }
  return { power: combine(powers), signal: combine(signals), objects: objs.length };
}
// Зона не требует значений, если объектов в ней нет по явной причине (раздел закрыт как «нет доступа» / «отсутствует» или лифтов 0).
function zoneNotApplicable(zc) {
  if (!zc.systems.length) return null;
  if (activeObjects(o => zc.systems.includes(o.system)).length) return null;
  const notes = [];
  for (const sys of zc.systems) {
    const secId = sysCfg(sys).section;
    const st = A.S.sections[secId];
    if (st.state !== 'closed') return null;
    if (sys === 'LIFT') {
      if (st.outcome === 'done' && Number(st.fields.lift_count) === 0) notes.push('лифтов нет');
      else if (st.outcome === 'no_access') notes.push('нет доступа');
      else return null;
    } else if (st.outcome === 'absent') notes.push('системы нет: ' + (st.reason || 'отсутствует'));
    else if (st.outcome === 'no_access') notes.push('нет доступа: ' + (st.reason || ''));
    else return null;
  }
  return notes.join('; ');
}
export function commsRow(zc) {
  const man = A.S.comms[zc.id];
  const d = commsDerived(zc);
  const pick = (manual, der) => manual
    ? { value: manual, source: 'manual', conflict: false }
    : der.value ? { value: der.value, source: 'cards', conflict: false }
      : { value: null, source: null, conflict: der.conflict };
  const az = zc.access_zone ? A.S.zones[zc.access_zone] : null;
  const noAccess = !!(az && (az.access === 'NO' || az.access === 'UNSAFE'));
  const shots = photosOf('zone', zc.id, 'screenshot').length;
  const power = pick(man.power, d.power);
  const signal = pick(man.signal, d.signal);
  const na = noAccess ? null : zoneNotApplicable(zc);
  const complete = noAccess || !!na || (!!power.value && !!signal.value && (shots > 0 || man.no_shot_reason.trim().length > 0));
  return { zc, power, signal, shots, noAccess, na, accessReason: az ? az.reason : '', complete };
}
export const commsRows = () => A.cfg.comms_zones.map(commsRow);

// ---------- цепочка PASS ----------
export function chainFor(o) {
  const cfg = A.cfg;
  const keys = cfg.pass.system_verified[o.system] || [];
  const verified = keys.some(k => objItem(o, k) === 'checked');
  const L = o.location;
  const locOK = L.entrance && L.level && L.room && L.landmark.trim();
  const locItem = objItem(o, 'location_confirmed') === 'checked';
  const reloc = slotState(o, 'relocation_context') === 'taken';
  const evidenceOK = o.observation.trim() && slotState(o, 'whole_object') === 'taken' && slotState(o, 'closeup') === 'taken';
  const monWhy = [];
  if (!['POSSIBLE', 'LIMITED'].includes(o.obs_location)) monWhy.push('место наблюдения не определено');
  if (!['YES', 'NO'].includes(o.power)) monWhy.push('питание неизвестно');
  if (!['GOOD', 'WEAK', 'NO'].includes(o.signal)) monWhy.push('сигнал не проверен');
  if (!['YES', 'NO'].includes(o.instrument)) monWhy.push('неизвестно, есть ли прибор');
  const why = (cond, text) => (cond ? '' : text);
  const links = [
    { id: 'system', ok: verified, why: why(verified, 'нет пункта «найден/подтверждён» со статусом «проверено»') },
    { id: 'component', ok: o.component.state === 'IDENTIFIED' && !!o.component.name.trim(), why: why(o.component.state === 'IDENTIFIED' && o.component.name.trim(), o.component.state === 'UNKNOWN' ? 'компонент UNKNOWN' : 'компонент не определён') },
    {
      id: 'location', ok: !!(locOK && locItem && reloc),
      why: [!locOK && 'локация или ориентир не заполнены', !locItem && 'нет отметки «местоположение подтверждено»', !reloc && 'нет фото-контекста для повторного поиска'].filter(Boolean).join('; '),
    },
    {
      id: 'evidence', ok: !!evidenceOK,
      why: [!o.observation.trim() && 'нет наблюдения', slotState(o, 'whole_object') !== 'taken' && 'нет кадра «объект целиком»', slotState(o, 'closeup') !== 'taken' && 'нет крупного плана'].filter(Boolean).join('; '),
    },
    { id: 'monitoring', ok: monWhy.length === 0, why: monWhy.join('; ') },
  ];
  return links;
}
export function passReport() {
  const out = [];
  A.cfg.pass.systems.forEach(sys => {
    const objs = activeObjects(o => o.system === sys);
    if (!objs.length) { out.push({ system: sys, field_id: null, links: null, reached: 0, pass: false }); return; }
    let best = null;
    objs.forEach(o => {
      const links = chainFor(o);
      let reached = 0;
      while (reached < links.length && links[reached].ok) reached++;
      if (!best || reached > best.reached) best = { system: sys, field_id: o.field_id, links, reached, pass: reached === links.length };
    });
    out.push(best);
  });
  return { scenarios: out, pass: out.some(s => s.pass) };
}

// ---------- контроль перед уходом (ЧЛ-13) ----------
const outcomeNote = id => {
  const st = A.S.sections[id];
  if (st.state === 'closed' && st.outcome === 'no_access') return 'раздел закрыт как «нет доступа»';
  if (st.state === 'closed' && st.outcome === 'absent') return 'раздел закрыт как «отсутствует»';
  return null;
};
const secClosedOK = (id, allowed) => {
  const st = A.S.sections[id];
  return st.state === 'closed' && allowed.includes(st.outcome);
};
const CHECKS = {
  heat_entry: () => entryCheck('HEAT', 'entry_found'),
  cws_entry: () => entryCheck('CWS', 'entry_found'),
  grsh_found: () => entryCheck('ELECTRICAL', 'grsh_found'),
  heat_photo() {
    const objs = activeObjects(o => o.system === 'HEAT');
    const ok = objs.some(o => slotState(o, 'whole_object') === 'taken' || slotState(o, 'closeup') === 'taken');
    return { ok, details: ok ? [] : [objs.length ? 'Нет фото узла отопления (объект целиком / крупный план)' : 'Объектов отопления нет'] };
  },
  hws_checked: () => sectionCheck('CL05', ['done', 'absent']),
  sewer_checked: () => sectionCheck('CL06', ['done', 'absent']),
  basement_checked: () => sectionCheck('CL02', ['done']),
  roof_checked() {
    const z = A.S.zones.roof;
    const ok = !!z.access && A.S.sections.CL09.state === 'closed';
    return { ok, details: ok ? [] : [!z.access ? 'Доступ на кровлю не указан' : 'Раздел «Кровля» не закрыт'] };
  },
  lifts_counted() {
    const st = A.S.sections.CL08;
    const it = st.items.i01;
    const cnt = st.fields.lift_count;
    const ok = st.state === 'closed' && st.outcome === 'done' && !!it && cnt != null && cnt !== '';
    const d = [];
    if (!ok) d.push(outcomeNote('CL08') || 'Количество лифтов не подтверждено');
    return { ok, details: d };
  },
  readings_taken() {
    const bad = activeObjects(o => o.instrument === 'YES' && !hasReading(o));
    return { ok: !bad.length, details: bad.map(o => `${o.field_id}: прибор есть, показание не внесено`) };
  },
  nameplates() {
    const bad = activeObjects(o => isP1(o) && slotState(o, 'nameplate') === 'missing');
    return { ok: !bad.length, details: bad.map(o => `${o.field_id}: нет кадра шильдика или причины`) };
  },
  general_closeup() {
    const bad = activeObjects(isP1).filter(o => !(slotState(o, 'whole_object') === 'taken' || slotState(o, 'general_room') === 'taken') || slotState(o, 'closeup') !== 'taken');
    return { ok: !bad.length, details: bad.map(o => `${o.field_id}: нет общего или крупного кадра`) };
  },
  power_checked() {
    const bad = commsRows().filter(r => !r.noAccess && !r.na && !r.power.value);
    return { ok: !bad.length, details: bad.map(r => `Связь и питание → ${r.zc.label}: ${r.power.conflict ? 'карточки расходятся, выберите значение' : '220 В не указано'}`) };
  },
  signal_checked() {
    const d = [];
    commsRows().forEach(r => {
      if (r.noAccess || r.na) return;
      if (!r.signal.value) d.push(`${r.zc.label}: ${r.signal.conflict ? 'карточки расходятся, выберите значение' : 'связь не указана'}`);
      else if (!r.shots && !A.S.comms[r.zc.id].no_shot_reason.trim()) d.push(`${r.zc.label}: нет скриншота (или причины его отсутствия)`);
    });
    return { ok: !d.length, details: d };
  },
  inaccessible_recorded() {
    const bad = zoneList().filter(z => (z.access === 'LIMITED' || z.access === 'NO') && !z.reason.trim());
    const unset = zoneList().filter(z => !z.access);
    const d = [...bad.map(z => `Зона «${z.label}»: нет причины ограничения`), ...unset.map(z => `Зона «${z.label}»: доступ не указан`)];
    return { ok: !d.length, details: d };
  },
  unknown_marked() {
    const bad = activeObjects(o => !o.component.state);
    return { ok: !bad.length, details: bad.map(o => `${o.field_id}: компонент не отмечен (IDENTIFIED / UNKNOWN)`) };
  },
  manual_no_tamper() {
    const c = A.S.closure;
    const d = [];
    if (c.no_tamper !== 'confirmed') d.push(c.no_tamper === 'cannot' ? 'Обследователь не подтвердил отсутствие вскрытия / переключений' : 'Нужно подтвердить вручную');
    activeObjects(o => o.system === 'ELECTRICAL').forEach(o => {
      if (objItem(o, 'not_opened') === 'cannot') d.push(`${o.field_id}: не подтверждено, что щит не вскрывался без допуска`);
    });
    return { ok: !d.length, details: d };
  },
};
function entryCheck(system, key) {
  const objs = activeObjects(o => o.system === system);
  const ok = objs.some(o => objItem(o, key) === 'checked');
  const note = outcomeNote(sysCfg(system).section);
  return { ok, details: ok ? [] : [objs.length ? 'Ни у одного объекта нет отметки «проверено»' : (note || 'Объектов нет')] };
}
function sectionCheck(id, allowed) {
  const ok = secClosedOK(id, allowed);
  return { ok, details: ok ? [] : [outcomeNote(id) || 'Раздел не закрыт'] };
}

export function runControl() {
  return A.cfg.control.map(c => {
    const r = CHECKS[c.check]();
    return { ...c, ok: r.ok, details: r.details };
  });
}

export function gaps() {
  const out = [];
  runControl().forEach(c => { if (!c.ok) out.push({ id: 'ctl:' + c.id, source: 'ЧЛ-13', text: c.text, details: c.details }); });
  A.cfg.sections.filter(s => s.kind !== 'misc').forEach(s => {
    if (A.S.sections[s.id].state !== 'closed') {
      out.push({ id: 'sec:' + s.id, source: s.num, text: `Раздел «${s.title}» не закрыт`, details: sectionBlockers(s.id).slice(0, 4).map(x => x.text) });
    }
  });
  return out;
}
export const gapReason = id => (A.S.closure.gap_reasons[id] || {}).text || '';

export function sealBlockers() {
  const b = [];
  gaps().forEach(g => { if (gapReason(g.id).trim().length < 3) b.push(`Пробел без причины: ${g.text}`); });
  if (!A.S.closure.candidate) b.push('Не выбрана отметка «кандидат L1 → L2/L3»');
  if (!A.S.inspector.name) b.push('Не указан обследователь');
  return b;
}

// ---------- итог ----------
export function summary() {
  const objs = activeObjects();
  const p1 = objs.filter(isP1);
  const p1full = p1.filter(evidenceFull);
  const inaccObjs = p1.filter(o => o.access === 'NO');
  const inaccSecs = A.cfg.sections.filter(s => (s.priority === 'P1') && A.S.sections[s.id].state === 'closed' && A.S.sections[s.id].outcome === 'no_access');
  return {
    objects_total: objs.length,
    p1_total: p1.length,
    p1_full: p1full.length,
    p1_inaccessible: { objects: inaccObjs.map(o => o.field_id), sections: inaccSecs.map(s => s.id), total: inaccObjs.length + inaccSecs.length },
    restricted_zones: zoneList().filter(zoneRestricted).map(z => ({ id: z.id, label: z.label, access: z.access, granted_by: z.granted_by, reason: z.reason })),
  };
}

// ---------- подписи и статусы ----------
export function seal() {
  if (!canEdit() || sealBlockers().length) return false;
  A.S.status = 'sealed';
  A.S.sealed_at = nowISO();
  addLog({ kind: 'seal' });
  touch(); scheduleSave(0);
  return true;
}
export function unseal() {
  if (A.S.status !== 'sealed') return;
  A.S.status = 'draft';
  A.S.signatures = {};
  addLog({ kind: 'unseal', note: 'подписи сброшены' });
  touch(); scheduleSave(0);
}
export async function sign(role, png, extra = {}) {
  const S = A.S;
  if (S.status !== 'sealed' || S.signatures[role]) return false;
  const name = role === 'inspector' ? S.inspector.name : S.representative.name;
  S.signatures[role] = { signed_at: nowISO(), name, png, ...extra };
  addLog({ kind: 'sign', role });
  if (S.signatures.inspector && S.signatures.representative) {
    S.status = 'signed';
    S.finished_at = nowISO();
    addLog({ kind: 'signed_final' });
    await db.revPut({ rev: S.revision, signed_at: S.finished_at, survey: clone(S) });
  }
  touch();
  await flush();
  return true;
}
export function setRepRemarks(text) {
  if (A.S.status !== 'sealed' || A.S.signatures.representative) return;
  A.S.closure.rep_remarks = text;
  scheduleSave();
}
export function newRevision(note) {
  const S = A.S;
  if (S.status !== 'signed' || !note.trim()) return false;
  S.revision += 1;
  S.revision_note = note.trim();
  S.status = 'draft';
  S.signatures = {};
  S.finished_at = null;
  addLog({ kind: 'new_revision', note });
  touch(); scheduleSave(0);
  return true;
}

// ---------- индикатор выгрузки ----------
export function exportState() {
  const m = A.S.meta;
  if (m.last_export_at && m.last_export_at >= m.last_change_at) return 'exported';
  return 'pending';
}
export function markExported(kind) {
  const t = nowISO();
  if (kind === 'final') A.S.meta.last_export_at = t; else A.S.meta.last_backup_at = t;
  scheduleSave(0);
}
