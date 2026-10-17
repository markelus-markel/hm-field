// Регистрация пользователя (профиль на телефоне), главная страница и экран профиля.
// Профиль хранится только на этом телефоне. В обследование попадают ФИО, должность и организация, телефон остаётся на устройстве.
import { A, saveProfile, clearProfile, flush, sectionStatus, sectionProgress, commsRows } from './model.js';
import { ui, field, toast, modal, closeModal, pill } from './ui.js';
import { esc, fmtDT } from './util.js';
import { nextStep } from './nav.js';

const $ = id => document.getElementById(id);
const firstName = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[1] : p[0] || ''; };

const profileForm = (p = {}, pre = 'r') => `
  ${field('ФИО', `<input class="in" id="${pre}-name" autocomplete="name" placeholder="Фамилия Имя" value="${esc(p.name || '')}">`, { req: true })}
  ${field('Должность', `<input class="in" id="${pre}-pos" placeholder="необязательно" value="${esc(p.position || '')}">`)}
  ${field('Организация', `<input class="in" id="${pre}-org" placeholder="например: HouseMaster" value="${esc(p.org || '')}">`)}
  ${field('Телефон', `<input class="in" id="${pre}-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="необязательно" value="${esc(p.phone || '')}">`, { hint: 'Хранится только на этом телефоне и не попадает в пакет.' })}`;

const readForm = pre => ({ name: $(`${pre}-name`).value, position: $(`${pre}-pos`).value, org: $(`${pre}-org`).value, phone: $(`${pre}-phone`).value });

// ---------- регистрация ----------
export function screenWelcome() {
  return {
    title: 'Регистрация', sub: 'HouseMaster Field', nav: false,
    html: `
    <section class="card why-card"><h2>Добро пожаловать</h2>
      <p>${esc(A.cfg.intro.lead)}</p>
      <p>Чтобы начать, зарегистрируйтесь. Так в каждом протоколе и в паспорте каждого фото будет указано, кто обследовал здание.</p></section>
    <section class="card"><h2>Ваш профиль</h2>${profileForm({}, 'r')}
      <p class="hint">Профиль хранится только на этом телефоне. В пакет для HouseMaster попадают ФИО, должность и организация обследователя.</p>
      <button class="btn big" data-act="reg-submit">Зарегистрироваться</button></section>
    <button class="btn ghost" data-act="restore-pick">Восстановить из резервной копии…</button>
    <p class="hint center"><a href="#/about">Зачем это обследование</a> · <a href="#/service">Служебное</a></p>`,
  };
}

// ---------- главная ----------
export function screenHome() {
  const P = A.profile, S = A.S, cfg = A.cfg;
  const meta = [P.position, P.org].filter(Boolean).join(' · ');
  let main;
  if (S) {
    const secs = cfg.sections.filter(s => s.kind !== 'misc');
    const closed = secs.filter(s => S.sections[s.id].state === 'closed').length;
    const nx = nextStep();
    const status = S.status === 'signed' ? 'подписано' : S.status === 'sealed' ? 'закрыто, ждёт подписей' : 'черновик';
    main = `<section class="card"><div class="split"><div><b>${esc(S.object_code)}</b><div class="hint">${esc(S.address)}</div></div>
      <div class="right"><b>${closed} из ${secs.length}</b><div class="hint">разделов закрыто</div></div></div>
      <div class="prog"><i style="width:${Math.round(closed / secs.length * 100)}%"></i></div>
      <p class="hint">Статус: ${esc(status)} · ревизия ${S.revision} · начато ${esc(fmtDT(S.started_at))}<br>Обследователь: ${esc(S.inspector.name)}<br>
      Карта: ${S.geo ? '✓ ' + S.geo.lat.toFixed(5) + ', ' + S.geo.lng.toFixed(5) : 'привязка не задана'}</p>
      <a class="btn big" href="#/map">Продолжить обследование</a>
      ${nx ? `<a class="btn ghost" href="${nx.href}">Дальше: ${esc(nx.num ? nx.num + ' · ' : '')}${esc(nx.title)}</a>` : ''}</section>`;
  } else {
    main = `<section class="card"><h2>Новое обследование</h2>
      <p class="hint">Адрес вводится вручную, здание обязательно привязывается к карте.</p><dl class="kv2"><dt>Протокол</dt><dd>${esc(cfg.protocol.code)}</dd></dl>
      <a class="btn big" href="#/new">Начать обследование</a>
      <button class="btn ghost" data-act="restore-pick">Восстановить из резервной копии…</button></section>`;
  }
  const q = (href, t, sub) => `<a class="quick-i" href="${href}"><b>${t}</b><small>${sub}</small></a>`;
  return {
    title: 'Главная', sub: 'HouseMaster Field', nav: false,
    html: `<section class="card hello"><small>HouseMaster Field</small><h2>Здравствуйте, ${esc(firstName(P.name))}</h2>${meta ? `<p class="hint">${esc(meta)}</p>` : ''}</section>
    ${main}
    <section class="card"><h2>Быстрый доступ</h2><div class="quick">
      ${S ? q('#/geo', 'Привязка к карте', S.geo ? 'задана' : 'не задана') + q('#/registry', 'Реестр и схема', 'компоненты и фото') : ''}
      ${q('#/about', 'Цель обследования', 'что делать и что получится')}
      ${q('#/profile', 'Профиль', esc(P.name))}
      ${q('#/service', 'Служебное', 'копия, офлайн, версия')}</div></section>`,
  };
}

// ---------- профиль ----------
export function screenProfile() {
  const P = A.profile, S = A.S;
  return {
    title: 'Профиль', back: '#/', nav: false,
    html: `<section class="card"><h2>Ваши данные</h2>${profileForm(P, 'p')}
      <button class="btn big" data-act="profile-save">Сохранить</button>
      ${S ? `<p class="hint">Текущее обследование оформлено на ${esc(S.inspector.name)}. Изменение профиля не меняет уже начатое обследование.</p>` : ''}</section>
    <section class="card"><h2>Об учётной записи</h2>
      <dl class="kv2"><dt>ID</dt><dd><code class="uid">${esc(P.id)}</code></dd><dt>Создан</dt><dd>${esc(fmtDT(P.created_at))}</dd></dl>
      ${S ? '<p class="hint">Выйти можно, когда на телефоне нет обследования: подпишите его, сохраните копию и очистите телефон на экране «Служебное».</p>'
    : '<button class="btn ghost danger" data-act="profile-del">Выйти и удалить профиль</button><p class="hint">Профиль удаляется только с этого телефона.</p>'}</section>`,
  };
}

export function registerHomeActions() {
  const a = ui.actions;
  a['reg-submit'] = async () => {
    const r = saveProfile(readForm('r'));
    if (!r.ok) { toast(r.error, 'err'); return; }
    await flush();
    toast('Регистрация выполнена', 'ok');
    ui.go('#/');
  };
  a['profile-save'] = async () => {
    const r = saveProfile(readForm('p'));
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast('Профиль сохранён', 'ok');
    ui.go('#/');
  };
  a['profile-del'] = () => modal(`<h3>Удалить профиль?</h3><p class="hint">Профиль будет удалён с этого телефона, придётся зарегистрироваться заново.</p>
    <div class="row"><button class="btn ghost" data-act="modal-close">Отмена</button><button class="btn danger" data-act="profile-del-yes">Удалить</button></div>`);
  a['profile-del-yes'] = async () => { await clearProfile(); closeModal(); toast('Профиль удалён'); ui.go('#/'); ui.render(); };
}
