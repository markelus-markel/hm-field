// Общие элементы интерфейса и обработчики. Экраны подключают сюда свои действия.
import { A, canEdit, photoURL, getAt } from './model.js';
import { esc, STATUS } from './util.js';

export const ui = {
  actions: {},
  render: () => {},
  go: h => { location.hash = h; },
  cleanup: null,
  state: { blockers: {}, naOpen: null, voidOpen: false, tab: 'card' },
};

export const dis = () => (canEdit() ? '' : ' disabled');

export function chips(path, options, value, o = {}) {
  const d = o.disabled || !canEdit() ? ' disabled' : '';
  return `<div class="chips${o.cls ? ' ' + o.cls : ''}" role="group">${options.map(([v, l, c]) =>
    `<button type="button" class="chip ${c || ''}${value === v ? ' on' : ''}" data-act="set" data-path="${esc(path)}" data-val="${esc(v)}" aria-pressed="${value === v}"${d}>${esc(l)}</button>`).join('')}</div>`;
}

export function tinput(path, value, o = {}) {
  const d = o.disabled || !canEdit() ? ' disabled' : '';
  if (o.area) return `<textarea class="in" rows="${o.rows || 3}" data-path="${esc(path)}" placeholder="${esc(o.ph || '')}"${d}>${esc(value || '')}</textarea>`;
  const num = o.type === 'number';
  return `<input class="in" type="${num ? 'number' : 'text'}"${num ? ' inputmode="numeric" min="0"' : ''} data-path="${esc(path)}" data-type="${num ? 'int' : 'text'}" value="${esc(value ?? '')}" placeholder="${esc(o.ph || '')}" autocomplete="off"${d}>`;
}

export function sel(path, opts, value, o = {}) {
  const d = o.disabled || !canEdit() ? ' disabled' : '';
  return `<select class="in" data-path="${esc(path)}" data-sel="1"${d}><option value="">${esc(o.ph || '— выберите —')}</option>${opts.map(x => `<option${x === value ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
}

export function field(label, inner, o = {}) {
  return `<div class="fld${o.bad ? ' bad' : ''}"><div class="lbl">${label}${o.req ? ' <span class="req" title="обязательно">*</span>' : ''}</div>${inner}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
}

export const safetyBanner = () =>
  '<div class="safety" role="note"><b>Не вскрывать</b> · <b>не переключать</b> · <b>не вмешиваться</b> · <b>без опасных измерений</b></div>';

const STATUS_CHIPS = [['checked', STATUS.checked, 's-ok'], ['no_access', STATUS.no_access, 's-warn'], ['absent', STATUS.absent, 's-mute'], ['tbd', STATUS.tbd, 's-tbd']];
export function checklist(items, basePath, state) {
  return `<ol class="cl">${items.map((it, i) => {
    const v = state[it.id];
    const opts = it.attest ? [['confirmed', 'Подтверждаю', 's-ok'], ['cannot', 'Не могу подтвердить', 's-warn']] : STATUS_CHIPS;
    return `<li class="${v ? 'set' : 'unset'}"><div class="cl-t"><span class="cl-n">${i + 1}</span>${esc(it.text)}</div>${it.hint ? `<div class="hint">${esc(it.hint)}</div>` : ''}${chips(`${basePath}.${it.id}`, opts, v, { cls: 'sm' })}</li>`;
  }).join('')}</ol>`;
}

export function thumbs(ids, o = {}) {
  if (!ids.length) return o.empty ? `<div class="hint">${o.empty}</div>` : '';
  return `<div class="th">${ids.map(id => {
    const m = A.PH.get(id);
    return `<button type="button" class="th-i" data-act="photo-view" data-id="${esc(id)}" aria-label="Фото ${esc(id)}"><img data-thumb="${esc(id)}" alt=""><span>${esc(id.split('-P-')[1] ? 'P-' + id.split('-P-')[1] : id)}${m && m.flags && m.flags.people ? ' ⚠' : ''}</span></button>`;
  }).join('')}</div>`;
}

export function hydrate(root) {
  root.querySelectorAll('img[data-thumb]').forEach(async img => {
    const u = await photoURL(img.dataset.thumb);
    if (u) img.src = u;
  });
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'err' ? 5000 : 2200);
}

export function modal(html, cls = '') {
  const m = document.getElementById('modal');
  m.className = 'open ' + cls;
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  hydrate(m);
}
export function closeModal() {
  const m = document.getElementById('modal');
  m.className = '';
  m.innerHTML = '';
}

export function askText({ title, label, ok = 'Сохранить', ph = '' }) {
  return new Promise(res => {
    modal(`<h3>${esc(title)}</h3><p class="hint">${esc(label)}</p><textarea class="in" id="ask-in" rows="3" placeholder="${esc(ph)}"></textarea>
    <div class="row"><button class="btn ghost" id="ask-cancel">Отмена</button><button class="btn" id="ask-ok">${esc(ok)}</button></div>`);
    const inp = document.getElementById('ask-in');
    inp.focus();
    document.getElementById('ask-cancel').onclick = () => { closeModal(); res(null); };
    document.getElementById('ask-ok').onclick = () => {
      const v = inp.value.trim();
      if (!v) { inp.classList.add('err'); return; }
      closeModal(); res(v);
    };
  });
}

export function pickFile({ capture = false } = {}) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    if (capture) i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    document.body.appendChild(i);
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    i.oncancel = () => { res(null); i.remove(); };
    i.click();
  });
}

export function pill(code, label) { return `<span class="pill p-${code}">${esc(label)}</span>`; }

export function backBar(title, href, extra = '') {
  return `<div class="bar"><a class="back" href="${href}" aria-label="Назад">‹</a><h1>${title}</h1>${extra}</div>`;
}

export const valueAt = path => getAt(A.S, path.split('.'));
