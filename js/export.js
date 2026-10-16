// Пакет для HouseMaster: survey.json + photos/ + report.html + manifest.json.
// Тот же формат служит резервной копией (с каталогом internal/ для восстановления).
import * as db from './db.js';
import { describe, buildZip, readZip, sha256Hex } from './zip.js';
import {
  A, APP_VERSION, nowISO, clone, activeObjects, allObjects, zoneList, sectionCfg, isP1, evidenceFull,
  slotState, slotPhotos, photosOf, readingDefs, chainFor, passReport, runControl, gaps, gapReason,
  summary, commsRows, sectionStatus, replaceFromBackup,
} from './model.js';
import { esc, LBL, STATUS, fmtDT } from './util.js';

const extOf = mime => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[mime] || 'jpg');
const dataURLtoBlob = u => {
  const [h, b] = u.split(',');
  const mime = /data:(.*?);/.exec(h)[1];
  const bin = atob(b);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
};
const itemsOut = (items, state) => items.map(i => ({
  id: i.id, text: i.text, status: state[i.id] || 'tbd', status_set: !!state[i.id],
}));

// ---------- survey.json ----------
export function surveyJSON(photoFiles = {}, sigFiles = {}) {
  const S = A.S, cfg = A.cfg;
  const ctl = runControl();
  const gp = gaps();
  const sm = summary();
  const pr = passReport();
  const photoIds = (scope, ref, slot) => photosOf(scope, ref, slot).map(p => p.photo_id);
  return {
    schema_version: cfg.schema_version,
    kind: 'hm-field-survey',
    protocol: { code: S.protocol_code, version: S.protocol_version, stage: cfg.protocol.stage },
    object: { code: S.object_code, address: S.address, id_prefix: S.id_prefix },
    revision: S.revision, revision_note: S.revision_note, status: S.status,
    started_at: S.started_at, finished_at: S.finished_at,
    inspector: S.inspector, representative: S.representative,
    entrances_count: S.entrances_count,
    access_zones: zoneList().map(z => ({ id: z.id, label: z.label, access: z.access, granted_by: z.granted_by, reason: z.reason })),
    sections: cfg.sections.map(s => {
      const st = S.sections[s.id];
      return {
        id: s.id, num: s.num, title: s.title, priority: s.priority, kind: s.kind,
        state: st.state, outcome: st.outcome, reason: st.reason, closed_at: st.closed_at,
        items: s.items ? itemsOut(s.items, st.items) : [], fields: st.fields,
        photo_ids: photoIds('section', s.id),
      };
    }),
    field_objects: allObjects().map(o => {
      const sec = sectionCfg(o.section);
      const p1 = isP1(o);
      return {
        field_id: o.field_id, key: `${S.object_code} / ${o.field_id}`,
        system: o.system, priority: cfg.systems[o.system].priority,
        status: o.status, void_reason: o.void_reason, created_at: o.created_at,
        location: o.location, access: o.access,
        component: o.component, observation: o.observation,
        existing_instrument: o.instrument,
        readings: readingDefs(o).map(d => ({ id: d.id, label: d.label, value: (o.readings[d.id] || {}).value || '', unit: (o.readings[d.id] || {}).unit || '' })),
        visible_anomaly: o.anomaly, power: o.power, mobile_signal: o.signal,
        potential_observation_location: o.obs_location,
        checklist: sec.items ? itemsOut(sec.items, o.items) : [],
        photo_slots: cfg.photo_slots.map(sl => ({
          slot: sl.id, label: sl.label, required: p1, state: slotState(o, sl.id),
          na_reason: (o.slots[sl.id] || {}).reason || '', photo_ids: photoIds('object', o.field_id, sl.id),
        })),
        photo_ids: photoIds('object', o.field_id),
        evidence_full: o.status === 'active' ? evidenceFull(o) : false,
        pass_chain: o.status === 'active' && p1 ? chainFor(o).map((l, i) => ({ id: cfg.pass.links[i].id, label: cfg.pass.links[i].label, ok: l.ok, why: l.why })) : null,
      };
    }),
    comms_power: commsRows().map(r => ({
      zone: r.zc.id, label: r.zc.label, no_access: r.noAccess, not_applicable: r.na || null,
      power_220v: r.power.value ? { value: r.power.value, source: r.power.source } : null,
      mobile_signal: r.signal.value ? { value: r.signal.value, source: r.signal.source } : null,
      screenshot_photo_ids: photoIds('zone', r.zc.id, 'screenshot'),
      no_screenshot_reason: S.comms[r.zc.id].no_shot_reason,
    })),
    closure: {
      control: ctl.map(c => ({ id: c.id, text: c.text, ok: c.ok, details: c.details })),
      no_tamper_confirmation: { value: S.closure.no_tamper, note: S.closure.no_tamper_note },
      gaps: gp.map(g => ({ id: g.id, source: g.source, text: g.text, details: g.details, reason: gapReason(g.id) })),
      counters: {
        field_objects: sm.objects_total, p1_objects_total: sm.p1_total,
        p1_objects_full_evidence: sm.p1_full, p1_inaccessible: sm.p1_inaccessible,
      },
      restricted_zones: sm.restricted_zones,
      candidate_l1_to_l2_l3: S.closure.candidate,
      materials_transferred: cfg.materials.filter(m => S.closure.materials[m.id]).map(m => m.id),
      summary_note: S.closure.summary_note || '',
      pass: {
        passed: pr.pass,
        scenarios: pr.scenarios.map(s => ({
          system: s.system, field_id: s.field_id, links_reached: s.reached, passed: s.pass,
          links: s.links ? s.links.map((l, i) => ({ id: cfg.pass.links[i].id, label: cfg.pass.links[i].label, ok: l.ok, why: l.why })) : null,
        })),
        rule_note: 'Условия звеньев цепочки — формализация критерия PASS протокола, см. документацию приложения',
      },
    },
    signatures: Object.fromEntries(Object.entries(S.signatures).map(([k, v]) => [k, {
      name: v.name, signed_at: v.signed_at, file: sigFiles[k] || null, remarks: k === 'representative' ? (S.closure.rep_remarks || '') : undefined,
    }])),
    photos: [...A.PH.values()].sort((a, b) => (a.photo_id < b.photo_id ? -1 : 1)).map(p => ({
      photo_id: p.photo_id, file: photoFiles[p.photo_id]?.path || null, sha256: photoFiles[p.photo_id]?.sha256 || null,
      scope: p.scope, ref: p.ref, slot: p.slot, captured_at: p.captured_at, width: p.w, height: p.h, size: p.size,
      source: p.source, void: p.void, void_reason: p.void_reason, people_or_personal_data_flag: !!(p.flags && p.flags.people),
    })),
  };
}

// ---------- печатный протокол ----------
const mark = on => (on ? '☒' : '☐');
export function reportHTML(imgSrc) {
  const S = A.S, cfg = A.cfg;
  const img = id => (imgSrc(id) ? `<a href="${esc(imgSrc(id, true) || imgSrc(id))}"><img src="${esc(imgSrc(id))}" alt="${esc(id)}"></a><span>${esc(id)}</span>` : `<span>${esc(id)}</span>`);
  const gallery = ids => (ids.length ? `<div class="g">${ids.map(i => `<figure>${img(i)}</figure>`).join('')}</div>` : '<p class="m">фото нет</p>');
  const itemsTbl = (items, st) => `<table class="t">${items.map(i => {
    const v = st[i.id];
    const lab = i.attest ? (v ? LBL.attest[v] : '— не отмечено —') : (v ? STATUS[v] : '— не отмечено —');
    return `<tr><td class="b">${mark(v === 'checked' || v === 'confirmed')}</td><td>${esc(i.text)}</td><td class="s">${esc(lab)}</td></tr>`;
  }).join('')}</table>`;
  const pr = passReport();
  const sm = summary();
  const parts = [];

  parts.push(`<header><h1>ПРОТОКОЛ ПОЛЕВОГО ОБСЛЕДОВАНИЯ</h1><p>${esc(cfg.protocol.org)}</p>
  <table class="kv">
  <tr><th>Код</th><td>${esc(S.protocol_code)} ${esc(S.protocol_version)}</td><th>Статус протокола</th><td>${esc(cfg.protocol.status)}</td></tr>
  <tr><th>Объект</th><td>${esc(S.object_code)}</td><th>Адрес</th><td>${esc(S.address)}</td></tr>
  <tr><th>Этап</th><td colspan="3">${esc(cfg.protocol.stage)}</td></tr>
  <tr><th>Цель</th><td colspan="3">${esc(cfg.protocol.goal)}</td></tr>
  <tr><th>Начало</th><td>${esc(fmtDT(S.started_at))}</td><th>Окончание</th><td>${esc(fmtDT(S.finished_at))}</td></tr>
  <tr><th>Обследователь</th><td>${esc(S.inspector.name)}</td><th>Представитель МКД/ПТ/ОСИ</th><td>${esc(S.representative.name)} ${esc(S.representative.org)}</td></tr>
  <tr><th>Ревизия</th><td>${S.revision}${S.revision_note ? ' — ' + esc(S.revision_note) : ''}</td><th>Состояние</th><td>${esc(S.status)}</td></tr>
  </table>
  <p class="m">Статусы: ${Object.values(STATUS).map(esc).join(' · ')}</p></header>`);

  cfg.sections.forEach(sec => {
    const st = S.sections[sec.id];
    const stat = sectionStatus(sec.id);
    let h = `<section><h2>${esc(sec.num)}. ${esc(sec.title.toUpperCase())}${sec.priority ? ' — ' + sec.priority : ''} <small>[${esc(stat.label)}]</small></h2>`;
    if (sec.kind === 'access') {
      h += itemsTbl(sec.items, st.items);
      h += `<p>Фактическое количество подъездов: <b>${S.entrances_count ?? '—'}</b></p>`;
      h += `<table class="t"><tr><th>Зона</th><th>Доступ</th><th>Кем предоставлен</th><th>Причина ограничения</th></tr>${zoneList().map(z => `<tr><td>${esc(z.label)}</td><td>${esc(LBL.access[z.access] || '—')}</td><td>${esc(z.granted_by)}</td><td>${esc(z.reason)}</td></tr>`).join('')}</table>`;
      h += '<p>Фото общего вида дома:</p>' + gallery(photosOf('section', 'CL01', 'house_general').map(p => p.photo_id));
    } else if (sec.kind === 'area') {
      const z = S.zones[sec.zone];
      h += `<p>Доступ: <b>${esc(LBL.access[z.access] || '—')}</b>${z.reason ? ' — ' + esc(z.reason) : ''}</p>`;
      if (z.access !== 'NO' && z.access !== 'UNSAFE') {
        if (sec.items_caption) h += `<p class="m">${esc(sec.items_caption)}:</p>`;
        h += itemsTbl(sec.items, st.items);
        (sec.fields || []).forEach(f => { h += `<p>${esc(f.label)}: <b>${esc(st.fields[f.id] ?? '—')}</b></p>`; });
        h += `<p>Observation: ${esc(st.observation) || '—'}</p>`;
        h += gallery(photosOf('section', sec.id, 'area').map(p => p.photo_id));
      }
    } else if (sec.kind === 'system' && !activeObjects(o => o.section === sec.id).length) {
      h += `<p>Объектов нет. Итог по разделу: <b>${esc(st.outcome ? STATUS[st.outcome === 'absent' ? 'absent' : 'no_access'] : '—')}</b>${st.reason ? ' — ' + esc(st.reason) : ''}</p>`;
    }
    if (sec.kind !== 'access') {
      allObjects().filter(o => o.section === sec.id).forEach(o => {
        const p1 = isP1(o);
        h += `<article class="obj${o.status === 'void' ? ' void' : ''}"><h3>FIELD ID: ${esc(o.field_id)} ${o.status === 'void' ? '— VOID: ' + esc(o.void_reason) : ''}</h3>
        <table class="kv">
        <tr><th>SYSTEM</th><td>${esc(o.system)}</td><th>ACCESS</th><td>${esc(o.access || '—')}</td></tr>
        <tr><th>LOCATION</th><td colspan="3">${esc([o.location.entrance, o.location.level, o.location.room].filter(Boolean).join(' · '))} — ${esc(o.location.landmark)}</td></tr>
        <tr><th>COMPONENT</th><td colspan="3">${esc(o.component.state ? LBL.comp[o.component.state] : '—')} ${esc(o.component.name)}</td></tr>
        <tr><th>OBSERVATION</th><td colspan="3">${esc(o.observation) || '—'}</td></tr>
        <tr><th>EXISTING INSTRUMENT</th><td>${esc(o.instrument || '—')}</td><th>VISIBLE ANOMALY</th><td>${esc(o.anomaly.state || '—')} ${esc(o.anomaly.text)}</td></tr>
        <tr><th>POWER</th><td>${esc(o.power || '—')}</td><th>MOBILE SIGNAL</th><td>${esc(o.signal ? LBL.signal[o.signal] : '—')}</td></tr>
        <tr><th>POTENTIAL OBSERVATION LOCATION</th><td colspan="3">${esc(o.obs_location || '—')}</td></tr>
        ${readingDefs(o).map(d => `<tr><th>${esc(d.label)}</th><td colspan="3">${esc((o.readings[d.id] || {}).value || '—')} ${esc((o.readings[d.id] || {}).unit || '')}</td></tr>`).join('')}
        </table>`;
        if (sec.items && sec.items.length) h += itemsTbl(sec.items, o.items);
        h += `<table class="t"><tr><th colspan="3">Фотопротокол (ЧЛ-11)${p1 ? '' : ' — не обязателен'}</th></tr>${cfg.photo_slots.map(sl => {
          const ids = photosOf('object', o.field_id, sl.id).map(p => p.photo_id);
          const sst = slotState(o, sl.id);
          return `<tr><td class="b">${mark(sst === 'taken')}</td><td>${esc(sl.label)}</td><td>${sst === 'na' ? 'не применимо: ' + esc(o.slots[sl.id].reason) : sst === 'missing' ? '—' : gallery(ids)}</td></tr>`;
        }).join('')}</table>`;
        const extra = photosOf('object', o.field_id, 'extra').map(p => p.photo_id);
        if (extra.length) h += '<p>Дополнительные фото:</p>' + gallery(extra);
        h += '</article>';
      });
    }
    h += '</section>';
    parts.push(h);
  });

  parts.push(`<section><h2>ЧЛ-10. СВЯЗЬ И ПИТАНИЕ</h2><table class="t"><tr><th>Зона</th><th>220 В</th><th>Связь</th><th>Скрин</th></tr>${commsRows().map(r =>
    r.noAccess || r.na ? `<tr><td>${esc(r.zc.label)}</td><td colspan="3">${r.noAccess ? 'нет доступа — ' + esc(r.accessReason) : esc(r.na)}</td></tr>`
      : `<tr><td>${esc(r.zc.label)}</td><td>${esc(r.power.value ? LBL.cPower[r.power.value] : '—')}</td><td>${esc(r.signal.value ? LBL.cSignal[r.signal.value] : '—')}</td><td>${r.shots ? gallery(photosOf('zone', r.zc.id, 'screenshot').map(p => p.photo_id)) : esc(S.comms[r.zc.id].no_shot_reason || '—')}</td></tr>`).join('')}</table></section>`);

  parts.push(`<section><h2>ЧЛ-13. КОНТРОЛЬ ПЕРЕД УХОДОМ С ОБЪЕКТА</h2><table class="t">${runControl().map(c => `<tr><td class="b">${mark(c.ok)}</td><td>${esc(c.text)}</td><td class="s">${c.ok ? '' : esc(c.details.join('; '))}</td></tr>`).join('')}</table>
  <h3>Пробелы и причины</h3>${gaps().length ? `<table class="t">${gaps().map(g => `<tr><td>${esc(g.source)}</td><td>${esc(g.text)}</td><td>${esc(gapReason(g.id))}</td></tr>`).join('')}</table>` : '<p>Пробелов нет.</p>'}</section>`);

  parts.push(`<section><h2>ИТОГ</h2>
  <table class="kv">
  <tr><th>Количество Field Objects</th><td>${sm.objects_total}</td></tr>
  <tr><th>P1 объектов с полным evidence</th><td>${sm.p1_full} из ${sm.p1_total}</td></tr>
  <tr><th>Недоступных P1 объектов</th><td>${sm.p1_inaccessible.total}</td></tr>
  <tr><th>Есть минимум один кандидат L1 → L2/L3</th><td>${esc(S.closure.candidate ? LBL.candidate[S.closure.candidate] : '—')}</td></tr>
  <tr><th>Материалы переданы HouseMaster</th><td>${cfg.materials.map(m => `${mark(S.closure.materials[m.id])} ${esc(m.label)}`).join(' &nbsp; ')}</td></tr>
  <tr><th>Критерий PASS</th><td><b>${pr.pass ? 'ВЫПОЛНЕН' : 'НЕ ВЫПОЛНЕН'}</b><br>${pr.scenarios.map(s => `${esc(s.system)}: ${s.links ? s.reached + ' из 5' : 'нет объектов'}${s.field_id ? ' (' + esc(s.field_id) + ')' : ''}`).join('; ')}</td></tr>
  </table>
  ${S.closure.summary_note ? `<p>Примечание: ${esc(S.closure.summary_note)}</p>` : ''}
  <p class="m">Правило обследования: ${esc(cfg.protocol.rule)}</p><p class="m">${esc(cfg.protocol.forbidden)}</p></section>`);

  const sg = S.signatures;
  parts.push(`<section class="sig"><h2>ПОДПИСИ</h2><div class="sigs">
  <div><p><b>Подпись обследователя</b> (удостоверяет собранные данные)</p>${sg.inspector ? `<img class="sg" src="${esc(imgSrc('sig:inspector'))}"><p>${esc(sg.inspector.name)}<br>${esc(fmtDT(sg.inspector.signed_at))}</p>` : '<p>не подписано</p>'}</div>
  <div><p><b>Подпись представителя</b> (удостоверяет присутствие и факт предоставленного доступа, но не техническую правильность)</p>${sg.representative ? `<img class="sg" src="${esc(imgSrc('sig:representative'))}"><p>${esc(sg.representative.name)}<br>${esc(fmtDT(sg.representative.signed_at))}</p><p>Замечания представителя: ${esc(S.closure.rep_remarks) || 'нет'}</p>` : '<p>не подписано</p>'}</div>
  </div></section>`);

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(S.protocol_code)} — ${esc(S.object_code)} — ревизия ${S.revision}</title>
<style>
body{font:13px/1.45 system-ui,Arial,sans-serif;color:#111;margin:0 auto;max-width:900px;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;border-bottom:2px solid #111;padding-bottom:3px;margin:22px 0 8px}h3{font-size:13px;margin:12px 0 4px}
h2 small{font-weight:400;color:#555}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #bbb;padding:3px 6px;vertical-align:top;text-align:left}
th{background:#f1f1f1;font-weight:600;width:22%}.t th{width:auto}.t td.b{width:22px;text-align:center}.t td.s{width:28%;color:#444}
.m{color:#555}.void{opacity:.55}.obj{border:1px solid #888;padding:6px 10px;margin:10px 0;border-radius:4px;break-inside:avoid-page}
.g{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;font-size:10px;color:#444;max-width:130px}figure img{width:130px;height:98px;object-fit:cover;border:1px solid #999;display:block}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:20px}.sg{max-width:100%;height:90px;border-bottom:1px solid #111}
@media print{body{padding:0;max-width:none}section{break-inside:auto}h2{break-after:avoid}.obj{break-inside:avoid}}
</style></head><body>${parts.join('\n')}</body></html>`;
}

// ---------- сборка пакета ----------
export async function buildPackage(kind, onProgress = () => {}) {
  const S = A.S;
  const entries = [];
  const photoFiles = {};
  const recs = await db.photoAll();
  recs.sort((a, b) => (a.photo_id < b.photo_id ? -1 : 1));
  let i = 0;
  for (const r of recs) {
    const path = `photos/${r.photo_id}.${extOf(r.mime)}`;
    const d = await describe(r.blob);
    entries.push({ path, ...d });
    photoFiles[r.photo_id] = { path, sha256: d.sha256 };
    onProgress(`Фото ${++i} из ${recs.length}`);
  }
  const sigFiles = {};
  for (const [role, v] of Object.entries(S.signatures)) {
    const blob = dataURLtoBlob(v.png);
    entries.push({ path: `signatures/${role}.png`, ...(await describe(blob)) });
    sigFiles[role] = `signatures/${role}.png`;
  }
  const add = async (path, text) => entries.push({ path, ...(await describe(text)) });
  onProgress('survey.json');
  const survey = surveyJSON(photoFiles, sigFiles);
  await add('survey.json', JSON.stringify(survey, null, 2));
  await add('changelog.json', JSON.stringify(A.log, null, 2));
  onProgress('Печатный протокол');
  const rel = id => {
    if (id.startsWith('sig:')) return sigFiles[id.slice(4)];
    return photoFiles[id] ? photoFiles[id].path : null;
  };
  await add('report.html', reportHTML(rel));

  if (kind === 'backup') {
    onProgress('Данные для восстановления');
    const state = { survey: clone(S), log: A.log, revisions: await db.revAll(), photos: recs.map(({ blob, thumb, ...m }) => m) };
    await add('internal/state.json', JSON.stringify(state));
    for (const r of recs) {
      if (r.thumb) entries.push({ path: `internal/thumbs/${r.photo_id}.jpg`, ...(await describe(r.thumb)) });
    }
  }

  const manifest = {
    schema_version: A.cfg.schema_version,
    kind: kind === 'backup' ? 'hm-field-backup' : 'hm-field-package',
    app: { name: 'HouseMaster Field', version: APP_VERSION },
    created_at: nowISO(),
    protocol: { code: S.protocol_code, version: S.protocol_version },
    object_code: S.object_code,
    revision: S.revision,
    status: S.status,
    inspector: S.inspector.name,
    representative: S.representative.name,
    started_at: S.started_at,
    finished_at: S.finished_at,
    files: entries.map(e => ({ path: e.path, size: e.size, sha256: e.sha256 })),
  };
  await add('manifest.json', JSON.stringify(manifest, null, 2));
  onProgress('Упаковка');
  const blob = buildZip(entries);
  const name = `${S.object_code}_${S.protocol_code}_rev${S.revision}_${kind === 'backup' ? 'BACKUP' : 'PACKAGE'}_${nowISO().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
  return { blob, name, count: entries.length, files: manifest.files.length };
}

// ---------- восстановление из резервной копии ----------
export async function restoreFromZip(file, onProgress = () => {}) {
  const entries = await readZip(file);
  const byPath = new Map(entries.map(e => [e.path, e]));
  const mf = byPath.get('manifest.json');
  if (!mf) throw new Error('В архиве нет manifest.json');
  const manifest = JSON.parse(await mf.blob.text());
  if (manifest.kind !== 'hm-field-backup') throw new Error('Это не резервная копия (нужен файл BACKUP). Итоговый пакет для HouseMaster восстановить нельзя.');
  // проверка контрольных сумм
  let n = 0;
  for (const f of manifest.files) {
    const e = byPath.get(f.path);
    if (!e) throw new Error(`В архиве нет файла ${f.path}`);
    const h = await sha256Hex(await e.blob.arrayBuffer());
    if (h !== f.sha256) throw new Error(`Контрольная сумма не совпала: ${f.path}`);
    onProgress(`Проверка ${++n} из ${manifest.files.length}`);
  }
  const state = JSON.parse(await byPath.get('internal/state.json').blob.text());
  const photos = [];
  for (const m of state.photos) {
    const ext = [...byPath.keys()].find(p => p.startsWith(`photos/${m.photo_id}.`));
    const rec = { ...m, blob: new Blob([byPath.get(ext).blob], { type: m.mime }) };
    const t = byPath.get(`internal/thumbs/${m.photo_id}.jpg`);
    if (t) rec.thumb = new Blob([t.blob], { type: 'image/jpeg' });
    photos.push(rec);
  }
  await replaceFromBackup({ survey: state.survey, photos, log: state.log, revisions: state.revisions });
  return { photos: photos.length, object: state.survey.object_code, revision: state.survey.revision };
}
