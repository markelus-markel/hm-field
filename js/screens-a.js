// Экраны: старт, доступ (ЧЛ-01), карта обхода, раздел, карточка объекта, камера.
import {
  A, canEdit, nowISO, createSurvey, flush, sectionCfg, sysCfg, isP1, zoneList, activeObjects, allObjects,
  sectionStatus, sectionProgress, sectionBlockers, closeSection, reopenSection, addObject, voidObject, restoreObject,
  objectBlockers, objectStatus, slotState, slotPhotos, photosOf, readingDefs, entranceOptions, markObjectNoAccess,
  addZone, setAt, voidPhoto, togglePeople, photoURL, photoRecord, commsRows, gaps, locString, hasReading,
  elementTypes, elementTypeOf, linkRels, addLink, removeLink, linkEdges, model3dState, deriveObject,
} from './model.js';
import {
  ui, dis, chips, tinput, sel, field, safetyBanner, checklist, thumbs, hydrate, toast, modal, closeModal, askText,
  pickFile, pill, valueAt,
} from './ui.js';
import { startStream, stopStream, grabFrame, fromFile, savePhoto } from './camera.js';
import { esc, LBL, STATUS, fmtDT, fmtTime, fmtBytes } from './util.js';
import { nextStep, why } from './nav.js';
import { attrOf } from './registry.js';
import { startGeoEditor, resetStartGeo, startGeo, geocodeAddress, applyAddressPoint, noteAddressPoint, lastReverse, refreshLabel } from './geo.js';

const $ = (s, r = document) => r.querySelector(s);
export const camURL = (scope, ref, slot, back) =>
  `#/cam?scope=${scope}&ref=${encodeURIComponent(ref)}&slot=${slot}&back=${encodeURIComponent(back)}`;

export async function storageReport() {
  const out = { quota: null, usage: null, persisted: null };
  try {
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.quota = e.quota; out.usage = e.usage; }
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* необязательно */ }
  return out;
}

// ---------- старт ----------
let findTimer = null, findSeq = 0, addrAuto = true;
function scheduleFind() { clearTimeout(findTimer); findTimer = setTimeout(() => findOnMap(false), 1500); }
async function findOnMap(force) {
  const el = $('#addr-find'); if (!el) return;
  const raw = $('#f-addr').value.trim();
  const dv = deriveObject(raw);
  if (!dv.ok) { if (force) el.textContent = dv.error; return; }
  const q = dv.object_code.startsWith('OBJ-') ? raw + ', Семей' : raw;
  const my = ++findSeq;
  el.textContent = 'Ищу адрес на карте…';
  try {
    const r = await geocodeAddress(q);
    if (my !== findSeq || !$('#f-addr')) return;
    if (!r) { el.innerHTML = '<span class="bad-t">Адрес не найден. Поставьте метку на карте вручную или проверьте написание.</span>'; return; }
    noteAddressPoint(r);
    const placed = applyAddressPoint(r, force);
    el.innerHTML = placed ? `Найдено: ${esc(r.name)}.<br>Проверьте метку и при необходимости перетащите её точно на здание.`
      : 'Точка уже задана вами вручную, метка не сдвигалась. Нажмите «Найти на карте по адресу», чтобы перенести её.';
  } catch {
    if (my === findSeq && $('#addr-find')) el.innerHTML = '<span class="bad-t">Поиск адреса недоступен без интернета. Поставьте метку по GPS, на карте или введите координаты.</span>';
  }
}

function syncStart() {
  const addr = $('#f-addr'); if (!addr) return;
  refreshLabel();
  const dv = deriveObject(addr.value);
  $('#code-prev').innerHTML = addr.value.trim()
    ? (dv.ok ? `Код объекта: <b>${esc(dv.object_code)}</b> · префикс номеров: <b>${esc(dv.id_prefix)}</b> (пример: ${esc(dv.id_prefix)}-HV-001)` : `<span class="bad-t">${esc(dv.error)}</span>`)
    : 'Коды появятся после ввода адреса.';
  const g = startGeo();
  const ok = dv.ok && !!g;
  $('#btn-start').disabled = !ok;
  $('#start-need').textContent = ok ? '' : 'Для начала нужны: ' + [dv.ok ? null : 'адрес с номером дома', g ? null : 'точка на карте'].filter(Boolean).join(' и ') + '.';
}
export function screenStart() {
  const cfg = A.cfg;
  resetStartGeo();
  addrAuto = true;
  const ge = startGeoEditor(() => syncStart(), r => {
    // адрес по метке подставляется сам, пока человек не начал печатать адрес вручную
    const f = $('#f-addr');
    if (!f || !(addrAuto || !f.value.trim())) return;
    f.value = r.field; addrAuto = true; noteAddressPoint(null); syncStart();
    $('#addr-find').innerHTML = r.hasHouse ? 'Адрес подставлен по метке. Проверьте его.' : '<span class="bad-t">Адрес подставлен по метке, но без номера дома. Допишите номер дома.</span>';
  });
  return {
    title: 'Новое обследование', sub: 'HouseMaster Field', back: '#/', nav: false,
    html: `
    <section class="card why-card"><h2>${esc(cfg.intro.title)}</h2><p>${esc(cfg.intro.lead)}</p><p>${esc(cfg.intro.why)}</p>
      <a class="btn ghost" href="#/about">Подробнее: что делать и что получится</a></section>
    <section class="card">
      <h2>${esc(cfg.protocol.code)}</h2>
      <dl class="kv2">
        <dt>Этап</dt><dd>${esc(cfg.protocol.stage)}</dd>
        <dt>Цель</dt><dd>${esc(cfg.protocol.goal)}</dd>
        <dt>Дата и время</dt><dd>${esc(fmtDT(nowISO()))}<br><small>время начала фиксируется автоматически</small></dd>
      </dl>
    </section>
    <section class="card">
      <h2>Здание</h2>
      ${field('Адрес здания', `<input class="in" id="f-addr" placeholder="введите адрес или определите место по GPS" autocomplete="off">`, { req: true, hint: 'Город, улица и номер дома. Адрес вводится вручную и работает без интернета.' })}
      <div id="code-prev" class="hint">Коды появятся после ввода адреса.</div>
      <div id="addr-find" class="hint"></div>
      <button class="btn ghost" data-act="addr-find">🔎 Найти на карте по адресу</button>
    </section>
    ${ge.html}
    <section class="card">
      <h2>Участники</h2>
      ${field('Обследователь', `<div class="static"><b>${esc(A.profile.name)}</b>${[A.profile.position, A.profile.org].filter(Boolean).length ? '<br><small>' + esc([A.profile.position, A.profile.org].filter(Boolean).join(' · ')) + '</small>' : ''}</div>`, { hint: 'Данные из профиля. <a href="#/profile">Изменить</a>' })}
      ${field('Представитель МКД / ПТ / ОСИ (ФИО)', `<input class="in" id="f-rep" placeholder="Фамилия Имя">`, { req: true })}
      ${field('Должность или организация представителя', `<input class="in" id="f-org" placeholder="необязательно">`)}
    </section>
    <section class="card" id="storage-card"><h2>Память телефона</h2><div id="storage-info" class="hint">проверяю…</div></section>
    ${safetyBanner()}
    <p id="start-need" class="hint bad-t">Для начала нужны: адрес и точка на карте.</p>
    <button class="btn big" id="btn-start" data-act="start" disabled>Начать обследование</button>
    <p class="hint center">Все данные сохраняются на этом телефоне после каждого действия. Интернет нужен только для первой загрузки и для отправки пакета.</p>
    <button class="btn ghost" data-act="restore-pick">Восстановить из резервной копии…</button>`,
    mount: async () => {
      $('#f-addr').addEventListener('input', () => { addrAuto = false; syncStart(); scheduleFind(); });
      ge.mount();
      syncStart();
      const s = await storageReport();
      const need = A.cfg.limits.expected_photo_mb * 1e6;
      const free = s.quota != null ? s.quota - s.usage : null;
      const warn = free != null && free < need;
      $('#storage-info').innerHTML = free == null
        ? 'Браузер не сообщает объём свободной памяти. Перед выходом на объект убедитесь, что на телефоне есть хотя бы 1 ГБ.'
        : `Свободно примерно <b>${fmtBytes(free)}</b>. ${warn ? `<span class="bad-t">Для ~${A.cfg.limits.expected_photo_mb} МБ фотографий может не хватить — освободите память.</span>` : 'Для ожидаемого объёма фотографий достаточно.'}`;
    },
  };
}

// ---------- зачем обследование ----------
export function screenAbout() {
  const i = A.cfg.intro, p = A.cfg.protocol;
  return {
    title: 'Цель обследования', back: A.S ? '#/map' : '#/', nav: !!A.S,
    html: `
    <section class="card"><p class="lead">${esc(i.lead)}</p><p>${esc(i.why)}</p></section>
    <section class="card"><h2>Партнёры проекта и их роли</h2><dl class="kv2">${i.partners.map(x => `<dt>${esc(x.name)}</dt><dd>${esc(x.role)}</dd>`).join('')}</dl></section>
    <section class="card"><h2>Что получится в конце</h2><p>${esc(i.output)}</p></section>
    <section class="card"><h2>Как работать</h2><ol class="steps">${i.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>
    <section class="card"><h2>Чего не делать</h2><p>${esc(i.dont)}</p></section>
    <section class="card"><h2>Правило записи</h2><p>${esc(p.rule)}</p>
      <p class="hint">Цепочка работ: ${esc(p.goal)}.</p></section>
    <a class="btn big" href="${A.S ? '#/map' : '#/'}">Понятно</a>`,
  };
}

// ---------- блок закрытия раздела ----------
function blockersHtml(list) {
  return `<div class="blk"><b>Раздел пока нельзя закрыть:</b><ul>${list.map(x => {
    const text = esc(x.text);
    return x.fid ? `<li><a href="#/obj/${esc(x.fid)}?t=${x.tab || 'card'}">${text}</a></li>` : `<li>${text}</li>`;
  }).join('')}</ul></div>`;
}
function closeBlock(id) {
  const st = A.S.sections[id];
  if (st.state === 'closed') {
    const o = st.outcome === 'no_access' ? 'нет доступа' : st.outcome === 'absent' ? 'отсутствует' : 'выполнено';
    return `<div class="done"><b>✓ Раздел закрыт</b> · ${o} · ${esc(fmtTime(st.closed_at))}</div>
    <button class="btn ghost" data-act="sec-reopen" data-id="${id}"${dis()}>Открыть снова</button>`;
  }
  const shown = ui.state.blockers[id] ? sectionBlockers(id) : null;
  const n = sectionBlockers(id).length;
  return `${shown && shown.length ? blockersHtml(shown) : ''}
  <div class="closebar"><span class="hint">${n ? `Не хватает: ${n}` : 'Всё заполнено'}</span>
  <button class="btn big" data-act="sec-close" data-id="${id}"${dis()}>Закрыть раздел</button></div>`;
}

function photoBlock(scope, ref, slot, back, caption) {
  const ids = photosOf(scope, ref, slot).map(p => p.photo_id);
  return `<div class="pb"><div class="lbl">${esc(caption)}</div>${thumbs(ids, { empty: 'Фото пока нет' })}
  <div class="row"><button class="btn" data-act="snap" data-scope="${scope}" data-ref="${esc(ref)}" data-slot="${slot}" data-back="${esc(back)}"${dis()}>📷 Снять</button>
  <button class="btn ghost" data-act="snap-file" data-scope="${scope}" data-ref="${esc(ref)}" data-slot="${slot}"${dis()}>Из файла</button></div></div>`;
}

function zoneCard(z) {
  const opts = z.values.map(v => [v, LBL.access[v], v === 'NO' ? 's-warn' : v === 'UNSAFE' ? 's-warn' : '']);
  const needReason = z.access === 'LIMITED' || z.access === 'NO';
  return `<div class="zone"><div class="lbl">${esc(z.label)}</div>${chips(`zones.${z.id}.access`, opts, z.access)}
  ${z.access === 'YES' || z.access === 'LIMITED' ? field('Кем предоставлен доступ', tinput(`zones.${z.id}.granted_by`, z.granted_by, { ph: 'ФИО, должность' })) : ''}
  ${z.access && z.access !== 'YES' ? field(z.access === 'UNSAFE' ? 'Комментарий (необязательно)' : 'Причина ограничения', tinput(`zones.${z.id}.reason`, z.reason, { area: true, rows: 2, ph: 'Кто отказал и почему' }), { req: needReason, bad: needReason && !z.reason.trim() }) : ''}</div>`;
}

// ---------- ЧЛ-01 ----------
export function screenAccess() {
  const sec = sectionCfg('CL01'), st = A.S.sections.CL01;
  return {
    title: 'ЧЛ-01 · Объект и доступ', back: '#/map', nav: true,
    html: `${why(sec)}
    <section class="card"><dl class="kv2"><dt>Объект</dt><dd>${esc(A.S.object_code)} · ${esc(A.S.address)}</dd>
    <dt>Начало</dt><dd>${esc(fmtDT(A.S.started_at))}</dd>
    <dt>Участники</dt><dd>${esc(A.S.inspector.name)} · ${esc(A.S.representative.name)}</dd></dl></section>
    <section class="card"><h2>Подъезды</h2>
      ${field('Фактическое количество подъездов', tinput('entrances_count', A.S.entrances_count, { type: 'number', ph: 'число' }), { req: true, hint: 'Список подъездов далее используется в локации объектов' })}
    </section>
    <section class="card"><h2>Зоны доступа</h2>
      <p class="hint">Для каждой зоны: есть ли доступ, кем предоставлен, а при ограничении — причина. Недоступные зоны попадут в итог.</p>
      ${zoneList().map(zoneCard).join('')}
      <div class="addzone">${tinput('__newzone', '', { ph: 'Другая зона (например, чердак)' })}<button class="btn ghost" data-act="zone-add"${dis()}>+ Добавить зону</button></div>
    </section>
    <section class="card"><h2>Чек-лист</h2><p class="hint">${esc(A.cfg.status_legend)}</p>${checklist(sec.items, 'sections.CL01.items', st.items)}</section>
    <section class="card"><h2>Фото общего вида дома</h2>${photoBlock('section', 'CL01', 'house_general', '#/access', 'Дом целиком, вид с улицы')}</section>
    ${closeBlock('CL01')}`,
  };
}

// ---------- карта обхода ----------
export function screenMap() {
  const S = A.S;
  const secs = A.cfg.sections;
  const closed = secs.filter(s => s.kind !== 'misc' && S.sections[s.id].state === 'closed').length;
  const total = secs.filter(s => s.kind !== 'misc').length;
  const card = s => {
    const stt = sectionStatus(s.id), pr = sectionProgress(s.id);
    const href = s.id === 'CL01' ? '#/access' : `#/sec/${s.id}`;
    const sub = s.kind === 'system'
      ? `объектов: ${pr.objects}${pr.objects ? ` · готово: ${pr.ready}` : ''}`
      : s.kind === 'misc' ? `объектов: ${pr.objects}`
        : `пунктов: ${pr.done}/${pr.items}${pr.objects != null ? ` · объектов: ${pr.objects}` : ''}`;
    return `<a class="map-i ${s.priority === 'P1' ? 'p1' : 'p2'}" href="${href}">
      <span class="pr">${s.priority || '—'}</span>
      <span class="mt"><b>${esc(s.num)} · ${esc(s.title)}</b><small>${sub}</small></span>${pill(stt.code, stt.label)}</a>`;
  };
  const rows = commsRows();
  const commsDone = rows.filter(r => r.complete).length;
  const gp = gaps().length;
  const banner = S.status === 'signed' ? `<div class="done"><b>✓ Обследование подписано</b> · ревизия ${S.revision}. Данные закрыты для правок.</div>`
    : S.status === 'sealed' ? '<div class="blk"><b>Данные закрыты для подписания.</b> Правки возможны после возврата к правкам на экране «Подписи».</div>' : '';
  return {
    title: 'Карта обхода', nav: true,
    html: `${banner}
    <section class="card"><div class="split"><div><b>${esc(S.object_code)}</b><div class="hint">${esc(S.address)}</div></div>
    <div class="right"><b>${closed} из ${total}</b><div class="hint">разделов закрыто</div></div></div>
    <div class="prog"><i style="width:${Math.round(closed / total * 100)}%"></i></div></section>
    ${(() => { const n = nextStep(); return n ? `<a class="next-card" href="${n.href}"><small>Дальше</small><b>${esc(n.num ? n.num + ' · ' : '')}${esc(n.title)}</b><span>${esc(n.label || 'открыть')} ›</span></a>` : '<div class="done"><b>✓ Все шаги выполнены</b>. Осталось выгрузить пакет на экране «Подписи».</div>'; })()}
    <a class="next-card geo-card" href="#/geo"><small>Привязка к карте города</small><b>${A.S.geo ? '✓ ' + A.S.geo.lat.toFixed(5) + ', ' + A.S.geo.lng.toFixed(5) : 'Не задана'}</b><span>${A.S.geo ? (A.S.geo.accuracy_m != null ? '±' + A.S.geo.accuracy_m + ' м · ' : '') + 'изменить ›' : 'поставить на карту ›'}</span></a>
    <a class="next-card reg-card" href="#/registry"><small>Собирается автоматически</small><b>Реестр и схема</b><span>компоненты, фото, расположение ›</span></a>
    <p class="hint center"><a href="#/">Главная</a> · <a href="#/about">Зачем это обследование</a></p>
    <div class="map">${secs.filter(s => s.kind !== 'misc').map(card).join('')}</div>
    <div class="map">
      <a class="map-i" href="#/comms"><span class="pr">—</span><span class="mt"><b>ЧЛ-10 · Связь и питание</b><small>зон заполнено: ${commsDone}/${rows.length}</small></span>${pill(commsDone === rows.length ? 'closed' : commsDone ? 'in_progress' : 'not_started', commsDone === rows.length ? 'заполнено' : commsDone ? 'в работе' : 'не начато')}</a>
      ${card(secs.find(s => s.kind === 'misc'))}
      <a class="map-i" href="#/control"><span class="pr">—</span><span class="mt"><b>ЧЛ-13 · Контроль перед уходом</b><small>пробелов сейчас: ${gp}</small></span>${pill(gp ? 'in_progress' : 'closed', gp ? 'есть пробелы' : 'чисто')}</a>
      <a class="map-i" href="#/summary"><span class="pr">—</span><span class="mt"><b>Итог и PASS</b><small>счётчики, кандидат L1 → L2/L3</small></span></a>
      <a class="map-i" href="#/sign"><span class="pr">—</span><span class="mt"><b>Подписи и передача</b><small>${S.status === 'draft' ? 'после закрытия обследования' : S.status === 'sealed' ? 'ожидают подписей' : 'подписано'}</small></span></a>
    </div>`,
  };
}

// ---------- раздел ----------
function objectList(sectionId, systems) {
  const objs = allObjects().filter(o => o.section === sectionId);
  const list = objs.map(o => {
    const st = objectStatus(o);
    const lab = st === 'void' ? 'VOID' : st === 'ready' ? 'готов' : `не хватает: ${objectBlockers(o).length}`;
    return `<a class="obj-i ${st}" href="#/obj/${esc(o.field_id)}"><span class="fid">${esc(o.field_id)}</span>
      <span class="mt"><b>${esc(o.component.name || (o.component.state === 'UNKNOWN' ? 'UNKNOWN' : sysCfg(o.system).label))}</b><small>${esc(locString(o)) || 'локация не указана'}</small></span>${pill(st === 'ready' ? 'closed' : st === 'void' ? 'absent' : 'in_progress', lab)}</a>`;
  }).join('');
  const addBtns = systems.map(s => `<button class="btn" data-act="obj-add" data-system="${s}"${dis()}>+ ${esc(systems.length > 1 ? sysCfg(s).label : 'Добавить объект')}</button>`).join('');
  return `<div class="objs">${list || '<div class="hint">Объектов пока нет</div>'}</div><div class="row">${addBtns}</div>`;
}

export function screenSection(id) {
  const sec = sectionCfg(id);
  if (!sec || id === 'CL01') return { title: 'Раздел не найден', back: '#/map', nav: true, html: '<p>Нет такого раздела.</p>' };
  const st = A.S.sections[id];
  let body = '';
  if (sec.kind === 'area') {
    const z = A.S.zones[sec.zone];
    const accessOK = z.access && z.access !== 'NO' && z.access !== 'UNSAFE';
    const opts = z.values.map(v => [v, LBL.access[v], v === 'NO' || v === 'UNSAFE' ? 's-warn' : '']);
    body += `<section class="card"><h2>Доступ</h2>${chips(`zones.${z.id}.access`, opts, z.access)}
      ${z.access === 'YES' || z.access === 'LIMITED' ? field('Кем предоставлен доступ', tinput(`zones.${z.id}.granted_by`, z.granted_by, { ph: 'ФИО, должность' })) : ''}
      ${z.access && z.access !== 'YES' ? field(z.access === 'UNSAFE' ? 'Комментарий (необязательно)' : 'Причина', tinput(`zones.${z.id}.reason`, z.reason, { area: true, rows: 2 }), { req: z.access !== 'UNSAFE', bad: z.access !== 'UNSAFE' && !z.reason.trim() }) : ''}
      ${z.access === 'UNSAFE' ? '<p class="hint">Исход «НЕБЕЗОПАСНО»: раздел закрывается без фото и без чек-листа.</p>' : ''}
      ${z.access === 'NO' ? '<p class="hint">Доступа нет: раздел закрывается с исходом «нет доступа».</p>' : ''}</section>`;
    if (accessOK) {
      body += `<section class="card"><h2>${sec.items_caption ? esc(sec.items_caption) : 'Чек-лист'}</h2><p class="hint">${esc(A.cfg.status_legend)}</p>${checklist(sec.items, `sections.${id}.items`, st.items)}</section>`;
      (sec.fields || []).forEach(f => {
        body += `<section class="card">${field(esc(f.label), tinput(`sections.${id}.fields.${f.id}`, st.fields[f.id], { type: 'number', ph: 'число' }), { req: true })}</section>`;
      });
      body += `<section class="card"><h2>Observation</h2>${tinput(`sections.${id}.observation`, st.observation, { area: true, rows: 3, ph: 'Только то, что видно. Без выводов.' })}
        ${photoBlock('section', id, 'area', `#/sec/${id}`, 'Фото раздела')}</section>`;
    }
    if (sec.objects_system) body += `<section class="card"><h2>Объекты (Field Objects)</h2>${objectList(id, [sec.objects_system])}</section>`;
  } else if (sec.kind === 'system') {
    const objs = activeObjects(o => o.section === id);
    body += `<section class="card"><h2>Объекты (Field Objects)</h2>
      <p class="hint">Каждый найденный узел — отдельный объект со своим Field ID, чек-листом и фотопротоколом.</p>${objectList(id, [sec.system])}</section>`;
    if (!objs.length) {
      body += `<section class="card"><h2>Если объекта нет</h2><p class="hint">Не нашли или не пустили — отметьте это явно и укажите причину.</p>
      ${chips(`sections.${id}.outcome`, [['no_access', 'Нет доступа', 's-warn'], ['absent', 'Отсутствует', 's-mute']], st.outcome)}
      ${st.outcome ? field('Причина', tinput(`sections.${id}.reason`, st.reason, { area: true, rows: 2 }), { req: true, bad: !st.reason.trim() }) : ''}</section>`;
    }
  } else {
    body += `<section class="card"><h2>Объекты (Field Objects)</h2><p class="hint">Прочие наблюдения, не вошедшие в системы протокола.</p>${objectList(id, ['ENV', 'OTHER'])}</section>`;
  }
  const stt = sectionStatus(id);
  return {
    title: `${sec.num} · ${sec.title}`, back: '#/map', nav: true, safety: true,
    sub: `${sec.priority || ''} · ${stt.label}`,
    html: why(sec) + body + (sec.kind === 'misc' ? '' : closeBlock(id)),
  };
}

// ---------- карточка объекта ----------
export function screenObject(fid, tab) {
  const o = A.S.objects[fid];
  if (!o) return { title: 'Объект не найден', back: '#/map', nav: true, html: '<p>Такого объекта нет.</p>' };
  const sys = sysCfg(o.system), sec = sectionCfg(o.section), p1 = isP1(o);
  const b = objectBlockers(o);
  const unsetItems = sec.items ? sec.items.filter(i => !o.items[i.id]).length : 0;
  const miss = p1 ? A.cfg.photo_slots.filter(s => slotState(o, s.id) === 'missing').length : 0;
  const base = `objects.${fid}`;
  const tabs = [['card', 'Карточка', b.filter(x => x.tab === 'card').length], ['list', 'Чек-лист', unsetItems], ['photo', 'Фото', miss], ['model', 'Для 3D', 0]]
    .filter(t => t[0] !== 'list' || (sec.items && sec.items.length));
  const tabsHtml = `<div class="tabs" role="tablist">${tabs.map(([k, l, n]) =>
    `<a role="tab" class="${tab === k ? 'on' : ''}" href="#/obj/${esc(fid)}?t=${k}" aria-selected="${tab === k}">${l}${n ? `<i class="badge">${n}</i>` : ''}</a>`).join('')}</div>`;

  let body = '';
  if (o.status === 'void') {
    body += `<div class="blk"><b>Объект помечен VOID</b><br>${esc(o.void_reason)}<br><small>Номер ${esc(o.field_id)} не будет использован повторно. Запись остаётся в пакете.</small></div>
    <button class="btn ghost" data-act="obj-restore" data-id="${esc(fid)}"${dis()}>Вернуть объект</button>`;
  }

  if (tab === 'card') {
    const L = o.location;
    const hasShot = slotPhotos(o, 'readings').length > 0;
    body += `<section class="card"><h2>Компонент</h2>
      ${chips(`${base}.component.state`, [['IDENTIFIED', 'IDENTIFIED'], ['UNKNOWN', 'UNKNOWN — требует идентификации', 's-warn']], o.component.state, { cls: 'wide' })}
      ${o.component.state === 'IDENTIFIED' ? field('Что это', tinput(`${base}.component.name`, o.component.name, { ph: 'Например: ввод отопления, узел учёта' }), { req: true, bad: !o.component.name.trim() }) : ''}
      ${o.component.state === 'UNKNOWN' ? '<p class="hint">UNKNOWN — нормальный ответ. Обязательно опишите наблюдение и снимите общий кадр.</p>' : ''}</section>
    <section class="card"><h2>Локация</h2>
      ${field('Подъезд', sel(`${base}.location.entrance`, entranceOptions(), L.entrance), { req: true })}
      ${field('Уровень', sel(`${base}.location.level`, A.cfg.location.levels, L.level), { req: true })}
      ${field('Помещение', sel(`${base}.location.room`, A.cfg.location.rooms, L.room), { req: true })}
      ${field('Ориентир — как найти повторно', tinput(`${base}.location.landmark`, L.landmark, { area: true, rows: 2, ph: 'Например: справа от входа, за вторым вентилем' }), { req: p1, bad: p1 && !L.landmark.trim() })}</section>
    <section class="card"><h2>Карточка (ЧЛ-12)</h2>
      ${field('ACCESS', chips(`${base}.access`, [['YES', 'YES'], ['LIMITED', 'LIMITED', 's-warn'], ['NO', 'NO', 's-warn']], o.access), { req: true })}
      ${field('EXISTING INSTRUMENT', chips(`${base}.instrument`, [['YES', 'YES'], ['NO', 'NO'], ['UNKNOWN', 'UNKNOWN', 's-tbd']], o.instrument), { req: true })}
      ${o.instrument === 'YES' || hasReading(o) ? readingDefs(o).map(d => {
    const r = o.readings[d.id] || {};
    return field(esc(d.label), `<div class="rd">${tinput(`${base}.readings.${d.id}.value`, r.value, { disabled: !hasShot, ph: 'как на приборе' })}${sel(`${base}.readings.${d.id}.unit`, d.units, r.unit, { ph: 'ед.', disabled: !hasShot })}</div>`,
      { hint: hasShot ? 'Пишите ровно то, что показывает прибор. Без пересчёта и округления.' : 'Сначала сфотографируйте показание (вкладка «Фото», кадр «Показания»).' });
  }).join('') : ''}
      ${field('VISIBLE ANOMALY', chips(`${base}.anomaly.state`, [['NO', 'NO'], ['YES', 'YES', 's-warn']], o.anomaly.state), { req: true })}
      ${o.anomaly.state === 'YES' ? field('Что видно', tinput(`${base}.anomaly.text`, o.anomaly.text, { ph: 'Течь, коррозия, следы…' }), { req: true, bad: !o.anomaly.text.trim() }) : ''}
      ${field('POWER (есть ли 220 В рядом)', chips(`${base}.power`, [['YES', 'YES'], ['NO', 'NO'], ['UNKNOWN', 'UNKNOWN', 's-tbd']], o.power), { req: true, hint: 'Отмечайте по видимым признакам. Напряжение не измеряем.' })}
      ${field('MOBILE SIGNAL', chips(`${base}.signal`, [['GOOD', 'GOOD'], ['WEAK', 'WEAK'], ['NO', 'NO', 's-warn'], ['NOT_CHECKED', 'NOT CHECKED', 's-tbd']], o.signal), { req: true })}
      ${field('POTENTIAL OBSERVATION LOCATION', chips(`${base}.obs_location`, [['POSSIBLE', 'POSSIBLE'], ['LIMITED', 'LIMITED', 's-warn'], ['UNKNOWN', 'UNKNOWN', 's-tbd']], o.obs_location), { req: true })}</section>
    <section class="card"><h2>Observation</h2>
      ${tinput(`${base}.observation`, o.observation, { area: true, rows: 4, ph: 'Только то, что видно. Без выводов и предположений.' })}
      <p class="hint">${o.component.state === 'UNKNOWN' || o.anomaly.state === 'YES' ? 'Для этого объекта наблюдение обязательно.' : 'Правило: увидел → описал → не додумывал.'}</p></section>
    <section class="card">
      ${b.length ? `<b>Что ещё не заполнено (${b.length}):</b><ul class="miss">${b.map(x => `<li><a href="#/obj/${esc(fid)}?t=${x.tab}">${esc(x.text)}</a></li>`).join('')}</ul>` : '<div class="done"><b>✓ Объект заполнен полностью</b></div>'}
      ${o.access === 'NO' ? `<button class="btn ghost" data-act="obj-noaccess" data-id="${esc(fid)}"${dis()}>Нет доступа: отметить так всё нерешённое</button><p class="hint">Пункты чек-листа станут «нет доступа», а кадры — «не применимо: нет доступа». Это явное действие, его можно отменить вручную.</p>` : ''}
      ${o.status === 'active' ? `<button class="btn danger ghost" data-act="obj-void" data-id="${esc(fid)}"${dis()}>Создан по ошибке (VOID)</button>` : ''}</section>`;
  } else if (tab === 'model') {
    body += modelTab(o);
  } else if (tab === 'list') {
    body += `<section class="card"><p class="hint">${esc(A.cfg.status_legend)}</p>${checklist(sec.items, `${base}.items`, o.items)}</section>`;
  } else {
    body += photoTab(o, p1);
  }
  return {
    title: o.field_id, sub: `${sys.label} · ${p1 ? 'P1' : 'P2'}`, back: `#/sec/${o.section}`, nav: true, safety: true,
    html: tabsHtml + body,
  };
}

const REL_LBL = id => (linkRels().find(r => r.id === id) || {}).label || id;

// Вкладка «Для 3D»: данные, из которых строится модель инженерных систем. Всё необязательно.
function modelTab(o) {
  const fid = o.field_id, base = `objects.${fid}`, d = dis();
  const st = model3dState(o);
  const types = elementTypes(o.system), cur = elementTypeOf(o);
  const typeSel = `<select class="in" data-path="${esc(base)}.element.type" data-sel="1"${d}><option value="">— выберите —</option>${types.map(t =>
    `<option value="${esc(t.id)}"${t.id === o.element.type ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`;
  const mark = ok => (ok ? '✓' : '—');
  const out = o.links.map((l, i) => {
    const t = A.S.objects[l.ref];
    return `<div class="rel-row"><span><b>${esc(REL_LBL(l.rel))}</b> ${esc(l.ref)}${t && t.component.name ? ' · ' + esc(t.component.name) : ''}${t && t.status === 'void' ? ' (VOID)' : ''}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</span>
      <button class="btn ghost sm" data-act="link-del" data-id="${esc(fid)}" data-i="${i}"${d}>Убрать</button></div>`;
  }).join('');
  const inc = linkEdges().filter(e => (e.dst === fid || (e.type === 'connected' && e.src === fid)) && !o.links.some(l => l.ref === (e.src === fid ? e.dst : e.src)));
  const incHtml = inc.length ? `<p class="hint">Указано в других объектах: ${inc.map(e => esc(e.src === fid ? e.dst : e.src) + (e.type === 'feeds' ? ' → питает этот' : ' · соединён')).join('; ')}</p>` : '';
  return `<section class="card"><h2>Идентификатор</h2>
    <dl class="kv2"><dt>Field ID</dt><dd>${esc(fid)}</dd><dt>Постоянный ID</dt><dd><code class="uid">${esc(o.uid)}</code></dd></dl>
    <p class="hint">Постоянный ID не меняется. Он связывает этот элемент, его фото и запись в 3D-модели.</p></section>
  <section class="card"><h2>Тип элемента</h2>
    ${field('Что это за элемент', typeSel, { hint: cur ? `Класс в BIM (IFC): ${cur.ifc}` : 'Выбирается из справочника. Если не нашли, выберите «Другое» и опишите.' })}
    ${o.element.type === 'other' ? field('Опишите тип', tinput(`${base}.element.type_other`, o.element.type_other, { ph: 'Например: компенсатор' })) : ''}</section>
  <section class="card"><h2>Шильдик</h2>
    ${field('Производитель', tinput(`${base}.plate.manufacturer`, o.plate.manufacturer, { ph: 'как на табличке' }))}
    ${field('Модель / тип', tinput(`${base}.plate.model`, o.plate.model, { ph: 'как на табличке' }))}
    ${field('Серийный номер', tinput(`${base}.plate.serial`, o.plate.serial, { ph: 'как на табличке' }))}
    ${field('Параметры (мощность, напор, Ду, Ру…)', tinput(`${base}.plate.rating`, o.plate.rating, { ph: 'как на табличке' }))}
    <p class="hint">Пишите ровно то, что на табличке. Сам шильдик снимите на вкладке «Фото», кадр «Шильдик».</p></section>
  <section class="card"><h2>Размеры и положение</h2>
    ${field('Диаметр Ду, мм', tinput(`${base}.dims.dn_mm`, o.dims.dn_mm, { ph: 'например: 50' }))}
    ${field('Длина участка, м', tinput(`${base}.dims.length_m`, o.dims.length_m, { ph: 'например: 3.5' }))}
    ${field('Габариты Д×Ш×В, мм', tinput(`${base}.dims.size`, o.dims.size, { ph: 'например: 600×400×800' }))}
    ${field('Положение в помещении', tinput(`${base}.dims.position_note`, o.dims.position_note, { area: true, rows: 2, ph: 'От двери 2 м, высота от пола 1,5 м' }))}
    ${field('В кадре есть эталон масштаба (рулетка, линейка)', chips(`${base}.dims.scale_ref`, [['YES', 'YES'], ['NO', 'NO']], o.dims.scale_ref))}
    <p class="hint">Размеры нужны для 3D. Лучше измеренные, но допустима оценка. Тогда напишите «~».</p></section>
  <section class="card"><h2>Связи с другими элементами</h2>
    ${out || '<p class="hint">Связей пока нет. Укажите, откуда элемент получает ресурс и куда его передаёт.</p>'}
    ${incHtml}
    <button class="btn" data-act="link-add" data-id="${esc(fid)}"${d}>+ Добавить связь</button></section>
  <section class="card"><h2>Что собрано для 3D</h2>
    <div class="mon"><span>${mark(st.type)} тип</span><span>${mark(st.links)} связи</span><span>${mark(st.dims)} размеры</span><span>${mark(st.plate)} шильдик</span></div>
    <p class="hint">Эти поля не мешают закрыть раздел. Чем полнее, тем точнее модель.</p></section>`;
}

function photoTab(o, p1) {
  const fid = o.field_id;
  const back = `#/obj/${fid}?t=photo`;
  const slots = A.cfg.photo_slots;
  const firstMissing = slots.find(s => slotState(o, s.id) === 'missing');
  const rows = slots.map(sl => {
    const st = slotState(o, sl.id);
    const ids = slotPhotos(o, sl.id).map(p => p.photo_id);
    const s = o.slots[sl.id] || {};
    const open = ui.state.naOpen === sl.id;
    const badge = st === 'taken' ? pill('closed', `снято: ${ids.length}`) : st === 'na' ? pill('absent', 'не применимо') : pill(p1 ? 'in_progress' : 'not_started', p1 ? 'нет кадра' : 'по желанию');
    return `<div class="slot ${st}"><div class="split"><div><b>${esc(sl.label)}</b><div class="hint">${esc(sl.hint)}</div></div>${badge}</div>
    ${thumbs(ids)}
    ${st === 'na' ? `<div class="hint">Причина: ${esc(s.reason)}</div>` : ''}
    <div class="row">
      <button class="btn" data-act="snap" data-scope="object" data-ref="${esc(fid)}" data-slot="${sl.id}" data-back="${esc(back)}"${dis()}>📷 Снять</button>
      <button class="btn ghost" data-act="snap-file" data-scope="object" data-ref="${esc(fid)}" data-slot="${sl.id}"${dis()}>Из файла</button>
      ${st !== 'taken' ? `<button class="btn ghost" data-act="na-open" data-slot="${sl.id}"${dis()}>${s.na ? 'Изменить причину' : 'Не применимо…'}</button>` : ''}
      ${s.na && st !== 'taken' ? `<button class="btn ghost" data-act="na-clear" data-id="${esc(fid)}" data-slot="${sl.id}"${dis()}>Снять отметку</button>` : ''}
    </div>
    ${open ? `<div class="na-box">${field('Почему кадр не применим', tinput(`objects.${fid}.slots.${sl.id}.reason`, s.reason, { area: true, rows: 2, ph: 'Своими словами' }), { req: true })}
      <div class="chips sm">${A.cfg.na_reasons.map(r => `<button class="chip" data-act="na-quick" data-id="${esc(fid)}" data-slot="${sl.id}" data-reason="${esc(r)}"${dis()}>${esc(r)}</button>`).join('')}</div>
      <button class="btn" data-act="na-done">Готово</button></div>` : ''}</div>`;
  }).join('');
  const extra = slotPhotos(o, 'extra').map(p => p.photo_id);
  return `<section class="card"><div class="split"><div><b>Фотопротокол (ЧЛ-11)</b><div class="hint">${p1 ? 'Для P1 каждый кадр: снят или «не применим» с причиной.' : 'Для этого объекта кадры не обязательны.'}</div></div></div>
    ${firstMissing ? `<a class="btn big" href="${camURL('object', fid, firstMissing.id, back)}">📷 Камера с гидом</a>` : '<div class="done"><b>✓ Все кадры решены</b></div>'}</section>
  ${rows}
  <section class="card"><b>Дополнительные фото</b>${thumbs(extra)}
  <div class="row"><button class="btn" data-act="snap" data-scope="object" data-ref="${esc(fid)}" data-slot="extra" data-back="${esc(back)}"${dis()}>📷 Снять</button></div></section>`;
}

// ---------- камера ----------
const SLOT_LABEL = { house_general: 'Общий вид дома', area: 'Фото раздела', screenshot: 'Скриншот уровня сети', extra: 'Дополнительное фото' };
function camSlotInfo(scope, ref, slot) {
  const s = A.cfg.photo_slots.find(x => x.id === slot);
  if (s) return s;
  if (scope === 'section' && slot === 'area') return { label: `Фото раздела: ${sectionCfg(ref)?.title || ''}`, hint: 'Общий вид того, что осматриваете' };
  return { label: SLOT_LABEL[slot] || slot, hint: '' };
}

export function screenCam(q) {
  const scope = q.get('scope'), ref = q.get('ref'), slot = q.get('slot') || 'area';
  const back = q.get('back') || '#/map';
  A.cam = { scope, ref, slot, back, stream: null, busy: false };
  const obj = scope === 'object' ? A.S.objects[ref] : null;
  return {
    full: true,
    html: `<div class="cam">
      <video id="cam-v" playsinline muted autoplay></video>
      <div class="cam-top"><a class="cam-x" href="${esc(back)}" aria-label="Закрыть">✕</a>
        <div class="cam-t"><b id="cam-slot"></b><span id="cam-hint"></span></div><div id="cam-cnt" class="cam-cnt"></div></div>
      ${obj ? '<div class="cam-slots" id="cam-slots"></div>' : ''}
      <div class="cam-msg" id="cam-msg" hidden></div>
      <div class="cam-na" id="cam-na" hidden></div>
      <div class="cam-flash" id="cam-flash"></div>
      <div class="cam-safe">Не вскрывать · не переключать · не вмешиваться</div>
      <div class="cam-bar">
        <button class="cb" data-act="cam-file" aria-label="Снять системной камерой или выбрать файл">Файл</button>
        <button class="shutter" data-act="cam-shot" aria-label="Сделать снимок"></button>
        ${obj ? '<button class="cb" data-act="cam-next">Далее ›</button>' : '<button class="cb" data-act="cam-done">Готово</button>'}
      </div></div>`,
    mount: async () => {
      updateCamUI();
      const cam = A.cam;
      ui.cleanup = () => { cam.dead = true; stopStream(cam.stream); cam.stream = null; };
      try {
        const s = await startStream($('#cam-v'));
        if (cam.dead) { stopStream(s); return; }
        cam.stream = s;
      } catch (e) {
        const m = $('#cam-msg');
        if (m && !cam.dead) {
          m.hidden = false;
          m.innerHTML = 'Камера недоступна в приложении. Разрешите доступ к камере в настройках браузера или нажмите «Файл» — откроется системная камера.';
        }
      }
    },
  };
}

export function updateCamUI() {
  const c = A.cam;
  if (!c || !$('#cam-slot')) return;
  const info = camSlotInfo(c.scope, c.ref, c.slot);
  $('#cam-slot').textContent = info.label;
  $('#cam-hint').textContent = info.hint || '';
  const n = photosOf(c.scope, c.ref, c.slot).length;
  $('#cam-cnt').textContent = n ? `в кадре слота: ${n}` : '';
  const row = $('#cam-slots');
  if (row) {
    const o = A.S.objects[c.ref];
    row.innerHTML = A.cfg.photo_slots.map(s => {
      const st = slotState(o, s.id);
      return `<button class="cs ${st}${s.id === c.slot ? ' cur' : ''}" data-act="cam-slot" data-slot="${s.id}">${esc(s.label)}</button>`;
    }).join('');
    const cur = row.querySelector('.cur');
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

function camAfterSave(id) {
  const f = $('#cam-flash');
  if (f) { f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120); }
  if (navigator.vibrate) navigator.vibrate(25);
  toast(`${id} сохранено`, 'ok');
  updateCamUI();
}

export function registerScreenActions() {
  const a = ui.actions;
  a['addr-use'] = () => {
    const r = lastReverse(); if (!r?.field) return;
    const f = $('#f-addr'); f.value = r.field; addrAuto = true; syncStart();
    toast(r.hasHouse ? 'Адрес подставлен' : 'Адрес подставлен. Допишите номер дома', 'ok');
  };
  a['addr-find'] = () => { clearTimeout(findTimer); findOnMap(true); };
  a.start = async () => {
    const rep = $('#f-rep').value, org = $('#f-org').value;
    const dv = deriveObject($('#f-addr').value);
    if (!dv.ok) { toast(dv.error, 'err'); return; }
    const geo = startGeo();
    if (!geo) { toast('Сначала привяжите здание к карте', 'err'); return; }
    if (!rep.trim()) { toast('Укажите представителя', 'err'); return; }
    const P = A.profile;
    try { await navigator.storage?.persist?.(); } catch { /* необязательно */ }
    createSurvey({ inspector: { name: P.name, position: P.position, org: P.org, profile_id: P.id }, representative: rep, representative_org: org, address: dv.address, geo });
    await flush();
    ui.go('#/access');
  };
  a['sec-close'] = el => {
    const id = el.dataset.id;
    const r = closeSection(id);
    if (!r.ok) { ui.state.blockers[id] = true; toast('Есть незаполненное', 'err'); } else { delete ui.state.blockers[id]; toast('Раздел закрыт', 'ok'); setTimeout(() => ui.go('#/map'), 350); }
    ui.render(true);
  };
  a['sec-reopen'] = el => { reopenSection(el.dataset.id); ui.render(true); };
  a['obj-add'] = el => {
    const fid = addObject(el.dataset.system);
    if (fid) ui.go(`#/obj/${fid}?t=card`);
  };
  a['link-add'] = el => {
    const fid = el.dataset.id;
    const others = activeObjects(x => x.field_id !== fid);
    if (!others.length) { toast('Нет других объектов для связи'); return; }
    modal(`<h3>Добавить связь</h3>
      <p class="hint">Элемент ${esc(fid)}. Связь запишется в его карточку и появится на схеме.</p>
      <label class="fl">Как связан<select class="in" id="lk-rel">${linkRels().map(r => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}</select></label>
      <label class="fl">С каким элементом<select class="in" id="lk-ref">${others.map(x => `<option value="${esc(x.field_id)}">${esc(x.field_id)} · ${esc(x.component.name || sysCfg(x.system).label)}</option>`).join('')}</select></label>
      <label class="fl">Примечание<input class="in" id="lk-note" type="text" placeholder="например: через задвижку 2" autocomplete="off"></label>
      <div class="row"><button class="btn ghost" data-act="modal-close">Отмена</button><button class="btn" data-act="link-save" data-id="${esc(fid)}">Добавить</button></div>`);
  };
  a['link-save'] = el => {
    const ok = addLink(el.dataset.id, document.getElementById('lk-rel').value, document.getElementById('lk-ref').value, document.getElementById('lk-note').value);
    closeModal();
    toast(ok ? 'Связь добавлена' : 'Такая связь уже есть');
    ui.render(true);
  };
  a['link-del'] = el => { removeLink(el.dataset.id, +el.dataset.i); ui.render(true); };
  a['obj-void'] = async el => {
    const r = await askText({ title: 'Объект создан по ошибке', label: 'Объект получит статус VOID. Номер не будет использован повторно, запись останется в журнале. Что произошло?', ok: 'Пометить VOID' });
    if (r && voidObject(el.dataset.id, r)) { toast('Объект помечен VOID'); ui.render(true); }
  };
  a['obj-restore'] = el => { restoreObject(el.dataset.id); ui.render(true); };
  a['obj-noaccess'] = el => { markObjectNoAccess(el.dataset.id); toast('Отмечено: нет доступа'); ui.render(true); };
  a['zone-add'] = () => {
    const inp = $('[data-path="__newzone"]');
    if (!inp || !inp.value.trim()) return;
    addZone(inp.value);
    ui.render(true);
  };
  a['na-open'] = el => {
    const o = A.S.objects[ui.state.objId];
    const sl = el.dataset.slot;
    if (!(o.slots[sl] && o.slots[sl].na)) setAt(`objects.${o.field_id}.slots.${sl}`, { na: true, reason: (o.slots[sl] || {}).reason || '' });
    ui.state.naOpen = sl;
    ui.render(true);
  };
  a['na-quick'] = el => {
    setAt(`objects.${el.dataset.id}.slots.${el.dataset.slot}`, { na: true, reason: el.dataset.reason });
    ui.render(true);
  };
  a['na-done'] = () => { ui.state.naOpen = null; ui.render(true); };
  a['na-clear'] = el => {
    setAt(`objects.${el.dataset.id}.slots.${el.dataset.slot}`, { na: false, reason: '' });
    ui.state.naOpen = null;
    ui.render(true);
  };
  a.snap = el => ui.go(camURL(el.dataset.scope, el.dataset.ref, el.dataset.slot, el.dataset.back));
  a['snap-file'] = async el => {
    const f = await pickFile({ capture: true });
    if (!f) return;
    try {
      const id = await savePhoto(el.dataset.scope, el.dataset.ref, el.dataset.slot, await fromFile(f), 'file');
      toast(`${id} сохранено`, 'ok');
      ui.render(true);
    } catch (e) { toast(e.message, 'err'); }
  };

  // камера
  a['cam-shot'] = async () => {
    const c = A.cam;
    if (c.busy) return;
    if (!c.stream) { toast('Камера не запущена. Нажмите «Файл».', 'err'); return; }
    c.busy = true;
    try {
      const id = await savePhoto(c.scope, c.ref, c.slot, await grabFrame($('#cam-v')), 'camera');
      camAfterSave(id);
    } catch (e) { toast(e.message, 'err'); }
    c.busy = false;
  };
  a['cam-file'] = async () => {
    const c = A.cam;
    const f = await pickFile({ capture: true });
    if (!f) return;
    try {
      const id = await savePhoto(c.scope, c.ref, c.slot, await fromFile(f), 'file');
      camAfterSave(id);
    } catch (e) { toast(e.message, 'err'); }
  };
  a['cam-slot'] = el => {
    A.cam.slot = el.dataset.slot;
    history.replaceState(null, '', camURL(A.cam.scope, A.cam.ref, A.cam.slot, A.cam.back));
    $('#cam-na').hidden = true;
    updateCamUI();
  };
  a['cam-next'] = () => {
    const c = A.cam, o = A.S.objects[c.ref];
    const slots = A.cfg.photo_slots;
    const i = slots.findIndex(s => s.id === c.slot);
    const order = [...slots.slice(i + 1), ...slots.slice(0, i)];
    const nxt = order.find(s => slotState(o, s.id) === 'missing');
    if (nxt) { a['cam-slot']({ dataset: { slot: nxt.id } }); return; }
    toast('Все кадры сняты или имеют причину', 'ok');
    ui.go(c.back);
  };
  a['cam-done'] = () => ui.go(A.cam.back);
  a['cam-na'] = () => {
    const c = A.cam, o = A.S.objects[c.ref], s = o.slots[c.slot] || {};
    const box = $('#cam-na');
    box.hidden = false;
    box.innerHTML = `<div class="lbl">Почему кадр «${esc(camSlotInfo(c.scope, c.ref, c.slot).label)}» не применим</div>
      <textarea class="in" id="cam-na-t" rows="2">${esc(s.reason || '')}</textarea>
      <div class="chips sm">${A.cfg.na_reasons.map(r => `<button class="chip" data-act="cam-na-q" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <div class="row"><button class="btn ghost" data-act="cam-na-cancel">Отмена</button><button class="btn" data-act="cam-na-save">Сохранить</button></div>`;
  };
  a['cam-na-q'] = el => { $('#cam-na-t').value = el.dataset.reason; };
  a['cam-na-cancel'] = () => { $('#cam-na').hidden = true; };
  a['cam-na-save'] = () => {
    const t = $('#cam-na-t').value.trim();
    if (!t) { $('#cam-na-t').classList.add('err'); return; }
    setAt(`objects.${A.cam.ref}.slots.${A.cam.slot}`, { na: true, reason: t });
    $('#cam-na').hidden = true;
    updateCamUI();
    a['cam-next']();
  };

  // просмотр фото
  a['photo-view'] = async el => {
    const id = el.dataset.id;
    const m = A.PH.get(id);
    if (!m) return;
    const url = await photoURL(id, true);
    const at = attrOf(m);
    const subj = at.subject === 'object' ? `${at.field_id} · ${at.component_name || at.system || ''}` : at.subject === 'zone' ? `Связь: ${at.zone_label}` : `${at.section_num} ${at.section_title}`;
    const info = `${subj}<br>${esc(at.slot_label || '')}${at.location_text ? '<br>Где: ' + esc(at.location_text) : ''}<br>Снял: ${esc(at.author || '—')}${at.snapshot === false ? ' (атрибуты восстановлены)' : ''}`;
    modal(`<h3>${esc(id)}</h3><img class="full" src="${url}" alt="">
    <div class="hint">${info}<br>${esc(fmtDT(m.captured_at))} · ${m.w}×${m.h} · ${fmtBytes(m.size)} · ${m.source === 'camera' ? 'камера приложения' : 'файл'}</div>
    <div class="row"><button class="btn ghost" data-act="photo-people" data-id="${esc(id)}"${dis()}>${m.flags && m.flags.people ? '⚠ Люди / данные жильцов — снять отметку' : '⚠ На снимке люди или данные жильцов'}</button></div>
    <div class="row"><button class="btn ghost danger" data-act="photo-void" data-id="${esc(id)}"${dis()}>Убрать из набора (VOID)</button><button class="btn" data-act="modal-close">Закрыть</button></div>`, 'photo');
  };
  a['modal-close'] = () => closeModal();
  a['photo-people'] = async el => { await togglePeople(el.dataset.id); closeModal(); ui.render(true); toast('Отметка изменена'); };
  a['photo-void'] = async el => {
    closeModal();
    const r = await askText({ title: 'Убрать фото из набора', label: 'Файл останется в журнале и в пакете со статусом VOID. Почему убираете?', ok: 'Убрать' });
    if (r) { await voidPhoto(el.dataset.id, r); ui.render(true); toast('Фото помечено VOID'); }
  };
}
