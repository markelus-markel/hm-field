// Экраны: связь и питание (ЧЛ-10), контроль (ЧЛ-13), итог, подписи, служебный.
import {
  A, APP_VERSION, canEdit, commsRows, runControl, gaps, gapReason, summary, passReport, seal, unseal, sign, newRevision,
  sealBlockers, setRepRemarks, photosOf, photoURL, markExported, exportState, wipeDevice, setAt, flush, logTextChange,
} from './model.js';
import {
  ui, dis, chips, tinput, field, thumbs, hydrate, toast, modal, closeModal, askText, pickFile, pill, safetyBanner,
} from './ui.js';
import { fromFile, savePhoto } from './camera.js';
import { buildPackage, restoreFromZip, reportHTML } from './export.js';
import { esc, LBL, fmtDT, fmtBytes, download } from './util.js';
import { storageReport } from './screens-a.js';

const $ = (s, r = document) => r.querySelector(s);

// ---------- ЧЛ-10 ----------
export function screenComms() {
  const rows = commsRows();
  const card = r => {
    const id = r.zc.id;
    if (r.noAccess || r.na) {
      return `<section class="card"><h2>${esc(r.zc.label)}</h2><div class="blk">${r.noAccess ? `Нет доступа в зону${r.accessReason ? ': ' + esc(r.accessReason) : ''}` : esc(r.na)}. Строка считается заполненной.</div></section>`;
    }
    const src = s => (s.source === 'cards' ? '<span class="tag">из карточек объектов</span>' : s.source === 'manual' ? '<span class="tag m">вручную</span>' : '');
    return `<section class="card"><div class="split"><h2>${esc(r.zc.label)}</h2>${pill(r.complete ? 'closed' : 'in_progress', r.complete ? 'заполнено' : 'не полностью')}</div>
    ${field('220 В ' + src(r.power), chips(`comms.${id}.power`, [['YES', 'Да'], ['NO', 'Нет'], ['UNKNOWN', '?', 's-tbd']], r.power.value),
      { hint: r.power.conflict ? '<span class="bad-t">Карточки объектов расходятся — выберите значение вручную.</span>' : 'Отмечайте по видимым признакам. Напряжение не измеряем.' })}
    ${field('Мобильная связь ' + src(r.signal), chips(`comms.${id}.signal`, [['GOOD', 'Good'], ['WEAK', 'Weak'], ['NO', 'No', 's-warn']], r.signal.value),
      { hint: r.signal.conflict ? '<span class="bad-t">Карточки объектов расходятся — выберите значение вручную.</span>' : '' })}
    <div class="lbl">Скриншот уровня сети</div>
    ${thumbs(photosOf('zone', id, 'screenshot').map(p => p.photo_id), { empty: 'Скриншота нет. Сделайте системный скриншот индикатора сети и прикрепите.' })}
    <div class="row"><button class="btn" data-act="comms-shot" data-zone="${id}"${dis()}>📎 Прикрепить скриншот</button></div>
    ${!r.shots ? field('Если скриншота не будет — причина', tinput(`comms.${id}.no_shot_reason`, A.S.comms[id].no_shot_reason, { ph: 'Почему нет скриншота' })) : ''}</section>`;
  };
  return {
    title: 'ЧЛ-10 · Связь и питание', back: '#/map', nav: true, safety: true,
    html: `<p class="hint">Значения из карточек объектов подставляются сами, повторно вводить не нужно. Если нужно — исправьте вручную.</p>${rows.map(card).join('')}`,
  };
}

// ---------- ЧЛ-13 ----------
export function screenControl() {
  const ctl = runControl(), gp = gaps();
  const bad = ctl.filter(c => !c.ok).length;
  const c17 = A.S.closure;
  const list = ctl.map(c => `<li class="ctl ${c.ok ? 'ok' : 'gap'}"><span class="ic">${c.ok ? '✓' : '✗'}</span><div><b>${esc(c.text)}</b>
    ${c.ok ? '' : c.details.map(d => `<div class="hint">${esc(d)}</div>`).join('')}
    ${c.manual ? `<div class="manual">${chips('closure.no_tamper', [['confirmed', 'Подтверждаю', 's-ok'], ['cannot', 'Не могу подтвердить', 's-warn']], c17.no_tamper, { cls: 'sm' })}
      ${c17.no_tamper === 'cannot' ? field('Что произошло', tinput('closure.no_tamper_note', c17.no_tamper_note, { area: true, rows: 2 }), { req: true }) : ''}
      <div class="hint">Подтверждаю лично: ничего не вскрывалось, не переключалось и не включалось без допуска.</div></div>` : ''}</div></li>`).join('');
  const gapHtml = gp.length ? gp.map(g => {
    const r = gapReason(g.id);
    return `<div class="gap"><div class="split"><b>${esc(g.text)}</b><small>${esc(g.source)}</small></div>
    ${g.details.slice(0, 5).map(d => `<div class="hint">${esc(d)}</div>`).join('')}
    ${field('Причина, почему так оставляем', tinput(`closure.gap_reasons.${g.id}.text`, r, { area: true, rows: 2, ph: 'Обязательно' }), { req: true, bad: r.trim().length < 3 })}</div>`;
  }).join('') : '<div class="done"><b>✓ Пробелов нет</b></div>';
  return {
    title: 'ЧЛ-13 · Контроль перед уходом', back: '#/map', nav: true,
    html: `<section class="card"><div class="split"><div><b>Проверка по собранным данным</b><div class="hint">Пересчитывается автоматически</div></div>${pill(bad ? 'in_progress' : 'closed', bad ? `не выполнено: ${bad}` : 'всё выполнено')}</div>
    <ul class="ctls">${list}</ul></section>
    <section class="card"><h2>Пробелы и причины</h2><p class="hint">Закрыть обследование с пробелами можно, только если по каждому указана причина. Причины попадут в отчёт.</p>${gapHtml}</section>
    <a class="btn big" href="#/summary">К итогу →</a>`,
  };
}

// ---------- ИТОГ ----------
const RULES = [
  ['SYSTEM VERIFIED', 'у объекта есть пункт «ввод/узел найден» (для канализации — участок или коллектор, для электрики — ввод или ГРЩ) со статусом «проверено»'],
  ['COMPONENT IDENTIFIED', 'компонент IDENTIFIED и описан словами'],
  ['LOCATION CONFIRMED', 'заполнены подъезд, уровень, помещение и ориентир; отмечено «местоположение подтверждено»; есть кадр «контекст для повторного поиска»'],
  ['OBSERVATION EVIDENCE', 'есть наблюдение и кадры «объект целиком» и «крупный план»'],
  ['MONITORING NEED CAN BE DEFINED', 'известны: возможное место наблюдения, питание, уровень сигнала и наличие прибора (не UNKNOWN / NOT CHECKED)'],
];
export function screenSummary() {
  const S = A.S, cfg = A.cfg;
  const sm = summary(), pr = passReport(), blockers = sealBlockers();
  const inacc = sm.p1_inaccessible;
  const scn = pr.scenarios.map(s => {
    const lab = cfg.systems[s.system].label;
    if (!s.links) return `<div class="scn"><b>${esc(lab)}</b><div class="hint">объектов нет</div></div>`;
    const broken = s.links[s.reached];
    return `<div class="scn"><div class="split"><b>${esc(lab)}</b><small>${esc(s.field_id)}</small></div>
    <div class="chain">${s.links.map((l, i) => `<span class="lk ${l.ok ? 'ok' : i === s.reached ? 'bad' : 'off'}" title="${esc(cfg.pass.links[i].label)}">${l.ok ? '✓' : i === s.reached ? '✗' : '·'}</span>`).join('<i></i>')}</div>
    <div class="hint">${s.pass ? 'Цепочка замкнута полностью' : `Обрывается на звене ${s.reached + 1}: ${esc(cfg.pass.links[s.reached].label)} — ${esc(broken.why)}`}</div></div>`;
  }).join('');
  const mats = cfg.materials.map(m => `<button type="button" class="chip${S.closure.materials[m.id] ? ' on' : ''}" data-act="toggle" data-path="closure.materials.${m.id}"${dis()}>${esc(m.label)}</button>`).join('');
  return {
    title: 'Итог и PASS', back: '#/map', nav: true,
    html: `<section class="card"><h2>Счётчики</h2><div class="stats">
      <div><b>${sm.objects_total}</b><span>Field Objects</span></div>
      <div><b>${sm.p1_full}<small>/${sm.p1_total}</small></b><span>P1 с полным evidence</span></div>
      <div><b>${inacc.total}</b><span>недоступных P1</span></div></div>
      ${inacc.total ? `<div class="hint">Недоступные P1: ${[...inacc.objects, ...inacc.sections.map(id => cfg.sections.find(s => s.id === id).title)].map(esc).join(', ')}</div>` : ''}
      <details><summary>Что значит «полный evidence»</summary><p class="hint">P1-объект с полностью заполненной карточкой и чек-листом, наблюдением, всеми кадрами фотопротокола (снят или «не применим» с причиной), доступом не «NO», и снятыми кадрами «объект целиком» и «крупный план».</p></details></section>
    <section class="card"><h2>Недоступные и ограниченные зоны</h2>${sm.restricted_zones.length ? sm.restricted_zones.map(z => `<div class="rz"><b>${esc(z.label)}</b> · ${esc(LBL.access[z.access])}<div class="hint">${esc(z.reason) || '—'}${z.granted_by ? ' · доступ дал: ' + esc(z.granted_by) : ''}</div></div>`).join('') : '<div class="hint">Нет</div>'}</section>
    <section class="card"><h2>Критерий PASS</h2>
      <div class="${pr.pass ? 'done' : 'blk'}"><b>${pr.pass ? '✓ PASS: цепочка замкнута хотя бы для одного сценария' : 'PASS пока не достигнут'}</b></div>
      ${scn}
      <details><summary>Как считается каждое звено</summary><ol class="rules">${RULES.map(r => `<li><b>${r[0]}</b> — ${esc(r[1])}</li>`).join('')}</ol></details></section>
    <section class="card"><h2>Есть минимум один кандидат L1 → L2/L3</h2>
      ${chips('closure.candidate', [['YES', 'YES'], ['NO', 'NO'], ['NEEDS_ANALYSIS', 'ТРЕБУЕТ АНАЛИЗА', 's-tbd']], S.closure.candidate, { cls: 'wide' })}
      <p class="hint">Решение принимает обследователь. Приложение его не вычисляет.</p></section>
    <section class="card"><h2>Материалы переданы HouseMaster</h2><div class="chips">${mats}</div>
      ${field('Примечание к итогу', tinput('closure.summary_note', S.closure.summary_note, { area: true, rows: 2, ph: 'Необязательно' }))}</section>
    ${S.status === 'draft' ? `<section class="card"><h2>Закрыть обследование</h2>
      ${blockers.length ? `<div class="blk"><b>Пока нельзя:</b><ul>${blockers.map(b => `<li>${esc(b)}</li>`).join('')}</ul><a href="#/control">Открыть контроль перед уходом</a></div>` : '<p class="hint">После закрытия данные станут недоступны для правок и перейдут к подписям.</p>'}
      <button class="btn big" data-act="seal"${blockers.length ? ' disabled' : ''}>Закрыть и перейти к подписям</button></section>`
      : `<a class="btn big" href="#/sign">К подписям →</a>`}`,
  };
}

// ---------- подписи ----------
function padHtml(role) {
  return `<div class="pad-w"><canvas class="pad" data-role="${role}" aria-label="Поле для подписи"></canvas><span class="pad-ph">распишитесь пальцем</span></div>
  <div class="row"><button class="btn ghost" data-act="pad-clear" data-role="${role}">Очистить</button><button class="btn" data-act="sign" data-role="${role}">Подписать</button></div>`;
}
export function screenSign() {
  const S = A.S, sg = S.signatures;
  if (S.status === 'draft') {
    return { title: 'Подписи', back: '#/summary', nav: true, html: `<div class="blk"><b>Обследование ещё открыто для правок.</b><br>Сначала закройте его на экране «Итог».</div><a class="btn big" href="#/summary">К итогу</a>` };
  }
  const sigImg = r => `<img class="sig-img" src="${sg[r].png}" alt="Подпись"><div class="hint">${esc(sg[r].name)} · ${esc(fmtDT(sg[r].signed_at))}</div>`;
  const insp = `<section class="card"><h2>Подпись обследователя</h2>
    <p class="meaning"><b>Удостоверяет:</b> что собранные данные внесены обследователем и отражают то, что он видел на объекте.</p>
    <p class="hint">${esc(S.inspector.name)}</p>${sg.inspector ? sigImg('inspector') : padHtml('inspector')}</section>`;
  const rep = `<section class="card"><h2>Подпись представителя МКД / ПТ / ОСИ</h2>
    <p class="meaning"><b>Удостоверяет:</b> присутствие при обследовании и факт предоставленного доступа. <b>Не удостоверяет</b> техническую правильность данных.</p>
    <p class="hint">${esc(S.representative.name)} ${esc(S.representative.org)}</p>
    ${field('Замечания представителя (если не согласен или хочет уточнить)', sg.representative ? `<div class="ro">${esc(S.closure.rep_remarks) || 'нет'}</div>` : `<textarea class="in" id="rep-remarks" rows="3" placeholder="Необязательно. Подписать можно и с замечаниями.">${esc(S.closure.rep_remarks || '')}</textarea>`)}
    ${sg.representative ? sigImg('representative') : padHtml('representative')}</section>`;
  let tail = '';
  if (S.status === 'sealed') {
    tail = `<button class="btn ghost" data-act="unseal">‹ Вернуться к правкам (подписи сбросятся)</button>`;
  } else {
    tail = `<div class="done"><b>✓ Обследование подписано</b> · ревизия ${S.revision} · ${esc(fmtDT(S.finished_at))}</div>
    <section class="card"><h2>Передача в HouseMaster</h2>
      <p class="hint">Пакет: survey.json, фотографии, подписи, печатный протокол, журнал изменений и manifest.json с контрольными суммами.</p>
      <button class="btn big" data-act="pkg-build">Сформировать пакет (ZIP)</button>
      ${ui.state.lastPkg && navigator.canShare ? '<button class="btn" data-act="pkg-share">Отправить…</button>' : ''}
      <button class="btn ghost" data-act="report-open">Печатный протокол / PDF</button>
      <p class="hint center">${exportState() === 'exported' ? '✓ Пакет сформирован после последних изменений' : 'Пакет ещё не сформирован'}</p></section>
    <section class="card"><h2>Нужна правка?</h2><p class="hint">Подписанную ревизию изменить нельзя. Можно создать новую ревизию: прежняя сохранится, подписи нужно будет собрать заново.</p>
      <div class="fld"><textarea class="in" id="rev-note" rows="2" placeholder="Что и зачем исправляем"></textarea></div>
      <button class="btn ghost" data-act="rev-new">Создать ревизию ${S.revision + 1}</button></section>`;
  }
  return {
    title: 'Подписи', back: '#/summary', nav: true,
    html: `${S.status === 'sealed' ? '<div class="blk"><b>Данные закрыты.</b> Соберите обе подписи. После второй подписи обследование станет итоговым.</div>' : ''}${insp}${rep}${tail}`,
    mount: mountPads,
  };
}

function mountPads() {
  document.querySelectorAll('canvas.pad').forEach(cv => {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    let down = false, lx = 0, ly = 0;
    const pos = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    cv.addEventListener('pointerdown', e => { down = true; [lx, ly] = pos(e); cv.setPointerCapture(e.pointerId); cv.dataset.dirty = '1'; cv.parentElement.classList.add('inked'); e.preventDefault(); });
    cv.addEventListener('pointermove', e => {
      if (!down) return;
      const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
      lx = x; ly = y; e.preventDefault();
    });
    const up = () => { down = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  });
}

// ---------- служебный ----------
async function offlineReport() {
  const out = { sw: false, controller: false, cached: 0, crit: [] };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    out.sw = !!reg && !!(reg.active);
    out.controller = !!navigator.serviceWorker?.controller;
    const keys = await caches.keys();
    const key = keys.find(k => k.startsWith('hm-field-'));
    if (key) {
      const c = await caches.open(key);
      out.cached = (await c.keys()).length;
      for (const p of ['index.html', 'css/app.css', 'js/app.js', 'js/model.js', 'data/protocol.json']) {
        out.crit.push([p, !!(await c.match(p))]);
      }
    }
  } catch { /* нет поддержки */ }
  return out;
}

export function screenService() {
  const S = A.S;
  return {
    title: 'Служебное', back: '#/map', nav: true,
    html: `
    <section class="card"><h2>Готовность к офлайну</h2><div id="off-info" class="hint">проверяю…</div>
      <button class="btn ghost" data-act="svc-refresh">Проверить снова</button></section>
    <section class="card"><h2>Память телефона</h2><div id="mem-info" class="hint">проверяю…</div>
      <button class="btn ghost" data-act="persist-ask">Запросить постоянное хранилище</button></section>
    ${S ? `<section class="card"><h2>Резервная копия</h2>
      <p class="hint">Файл со всеми данными и фото. Его можно восстановить на другом телефоне. Делайте копию до выхода из подвала и перед сдачей.</p>
      <button class="btn big" data-act="backup-build">Сохранить резервную копию в файл</button>
      <p class="hint">${S.meta.last_backup_at ? 'Последняя копия: ' + esc(fmtDT(S.meta.last_backup_at)) : 'Копий ещё не было'}</p></section>
    <section class="card"><h2>Протокол и журнал</h2>
      <button class="btn" data-act="report-open">Печатный протокол / PDF</button>
      <button class="btn ghost" data-act="log-download">Скачать журнал изменений (${A.log.length})</button></section>` : ''}
    <section class="card"><h2>Восстановление</h2><p class="hint">Заменяет все данные на этом телефоне данными из резервной копии.</p>
      <button class="btn ghost" data-act="restore-pick">Восстановить из резервной копии…</button></section>
    <section class="card"><h2>О приложении</h2><dl class="kv2"><dt>Версия</dt><dd>${APP_VERSION}</dd><dt>Протокол</dt><dd>${esc(A.cfg.protocol.code)} ${esc(A.cfg.protocol.version)}</dd><dt>Схема данных</dt><dd>${esc(A.cfg.schema_version)}</dd></dl></section>
    ${S ? `<section class="card"><h2>Очистить телефон</h2>
      <p class="hint">${exportState() === 'exported' ? 'Пакет сформирован после последних изменений.' : '<b class="bad-t">Пакет ещё не сформирован. После очистки данные пропадут навсегда.</b>'}
      Удаляет обследование и все фото с этого телефона. Это не отменить.</p>
      <input class="in" id="wipe-in" placeholder="Напишите УДАЛИТЬ" autocomplete="off">
      <button class="btn danger" data-act="wipe">Очистить телефон</button></section>` : ''}`,
    mount: async () => {
      const o = await offlineReport();
      const ok = o.sw && o.cached > 0 && o.crit.every(c => c[1]);
      $('#off-info').innerHTML = `<div class="${ok ? 'done' : 'blk'}"><b>${ok ? '✓ Приложение готово работать без интернета' : 'Офлайн пока не готов'}</b></div>
        Служба офлайна: ${o.sw ? 'активна' : 'не активна'}${o.sw && !o.controller ? ' (заработает после перезапуска приложения)' : ''}<br>Файлов в кэше: ${o.cached}<br>
        ${o.crit.map(c => `${c[1] ? '✓' : '✗'} ${esc(c[0])}`).join(' · ')}${ok ? '' : '<br>Откройте приложение один раз при интернете и подождите 10–20 секунд.'}`;
      const s = await storageReport();
      $('#mem-info').innerHTML = s.quota == null ? 'Браузер не сообщает объём памяти.'
        : `Занято: ${fmtBytes(s.usage)} · свободно: <b>${fmtBytes(s.quota - s.usage)}</b><br>Постоянное хранилище: ${s.persisted ? '<b>включено</b>' : '<span class="bad-t">не включено</span> — браузер может очистить данные при нехватке места. Установите приложение на главный экран.'}`;
    },
  };
}

// ---------- действия ----------
function progressModal(text) {
  modal(`<h3>Подождите</h3><p id="pg" class="hint">${esc(text)}</p><div class="spin"></div>`, 'busy');
  return t => { const e = document.getElementById('pg'); if (e) e.textContent = t; };
}

export async function openReport() {
  const S = A.S;
  const urls = {};
  for (const id of A.PH.keys()) { if (!A.PH.get(id).void) urls[id] = await photoURL(id); }
  const html = reportHTML(id => (id.startsWith('sig:') ? (S.signatures[id.slice(4)] || {}).png : urls[id]));
  let ov = document.getElementById('report');
  if (!ov) { ov = document.createElement('div'); ov.id = 'report'; document.body.appendChild(ov); }
  ov.className = 'open';
  ov.innerHTML = `<div class="rbar"><button class="btn" data-act="report-print">Печать / сохранить как PDF</button><button class="btn ghost" data-act="report-close">Закрыть</button></div><iframe id="rf" title="Протокол"></iframe>`;
  document.getElementById('rf').srcdoc = html;
}

export function registerScreenActionsB() {
  const a = ui.actions;
  a.toggle = el => {
    const parts = el.dataset.path.split('.');
    let cur = A.S; for (const k of parts) cur = cur ? cur[k] : undefined;
    setAt(el.dataset.path, !cur);
    ui.render(true);
  };
  a['comms-shot'] = async el => {
    const f = await pickFile();
    if (!f) return;
    try {
      const id = await savePhoto('zone', el.dataset.zone, 'screenshot', await fromFile(f), 'file');
      toast(`${id} сохранено`, 'ok');
      ui.render(true);
    } catch (e) { toast(e.message, 'err'); }
  };
  a.seal = () => {
    if (seal()) { toast('Обследование закрыто для правок', 'ok'); ui.go('#/sign'); } else { toast('Есть незаполненное', 'err'); ui.render(true); }
  };
  a.unseal = () => { unseal(); toast('Подписи сброшены, можно править'); ui.go('#/map'); };
  a['pad-clear'] = el => {
    const cv = document.querySelector(`canvas.pad[data-role="${el.dataset.role}"]`);
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    cv.dataset.dirty = '';
    cv.parentElement.classList.remove('inked');
  };
  a.sign = async el => {
    const role = el.dataset.role;
    const cv = document.querySelector(`canvas.pad[data-role="${role}"]`);
    if (!cv.dataset.dirty) { toast('Сначала распишитесь', 'err'); return; }
    // белый фон под подпись
    const t = document.createElement('canvas');
    t.width = cv.width; t.height = cv.height;
    const c = t.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, t.width, t.height); c.drawImage(cv, 0, 0);
    const ok = await sign(role, t.toDataURL('image/png'));
    if (ok) { toast('Подписано', 'ok'); ui.render(true); }
  };
  a['rev-new'] = () => {
    const note = document.getElementById('rev-note').value;
    if (!note.trim()) { toast('Напишите, что исправляем', 'err'); return; }
    if (newRevision(note)) { toast('Создана новая ревизия', 'ok'); ui.go('#/map'); }
  };
  a['pkg-build'] = async () => {
    const upd = progressModal('Собираю пакет…');
    try {
      const r = await buildPackage('final', upd);
      markExported('final');
      ui.state.lastPkg = r;
      closeModal();
      download(r.blob, r.name);
      toast(`Пакет готов: ${r.files} файлов`, 'ok');
      ui.render(true);
    } catch (e) { closeModal(); toast('Не удалось собрать пакет: ' + e.message, 'err'); }
  };
  a['pkg-share'] = async () => {
    const r = ui.state.lastPkg;
    try {
      const f = new File([r.blob], r.name, { type: 'application/zip' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: r.name });
      else toast('Отправка файлов не поддерживается, используйте «Сформировать пакет»', 'err');
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
  };
  a['backup-build'] = async () => {
    const upd = progressModal('Собираю резервную копию…');
    try {
      const r = await buildPackage('backup', upd);
      markExported('backup');
      closeModal();
      download(r.blob, r.name);
      toast('Резервная копия сохранена', 'ok');
      ui.render(true);
    } catch (e) { closeModal(); toast('Не удалось: ' + e.message, 'err'); }
  };
  a['restore-pick'] = async () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.zip,application/zip'; i.style.display = 'none';
    document.body.appendChild(i);
    i.onchange = async () => {
      const f = i.files[0]; i.remove();
      if (!f) return;
      if (A.S && !confirm('Данные на этом телефоне будут заменены данными из копии. Продолжить?')) return;
      const upd = progressModal('Проверяю контрольные суммы…');
      try {
        const r = await restoreFromZip(f, upd);
        closeModal();
        toast(`Восстановлено: ${r.object}, ревизия ${r.revision}, фото ${r.photos}`, 'ok');
        ui.go('#/map');
        ui.render();
      } catch (e) { closeModal(); toast(e.message, 'err'); }
    };
    i.click();
  };
  a['log-download'] = () => download(new Blob([JSON.stringify(A.log, null, 2)], { type: 'application/json' }), `${A.S.object_code}_changelog.json`);
  a['persist-ask'] = async () => {
    try { const r = await navigator.storage.persist(); toast(r ? 'Постоянное хранилище включено' : 'Браузер отказал. Установите приложение на главный экран.', r ? 'ok' : 'err'); } catch { toast('Не поддерживается', 'err'); }
    ui.render(true);
  };
  a['svc-refresh'] = () => ui.render(true);
  a.wipe = async () => {
    if (document.getElementById('wipe-in').value.trim().toUpperCase() !== 'УДАЛИТЬ') { toast('Напишите слово УДАЛИТЬ', 'err'); return; }
    await wipeDevice();
    toast('Телефон очищен');
    ui.go('#/');
    ui.render();
  };
  a['report-open'] = () => openReport();
  a['report-print'] = () => { const f = document.getElementById('rf'); f.contentWindow.focus(); f.contentWindow.print(); };
  a['report-close'] = () => { const o = document.getElementById('report'); o.className = ''; o.innerHTML = ''; };
}
