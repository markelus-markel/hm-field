export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const LBL = {
  access: { YES: 'YES', LIMITED: 'LIMITED', NO: 'NO', UNSAFE: 'НЕБЕЗОПАСНО' },
  tri: { YES: 'YES', NO: 'NO', UNKNOWN: 'UNKNOWN' },
  signal: { GOOD: 'GOOD', WEAK: 'WEAK', NO: 'NO', NOT_CHECKED: 'NOT CHECKED' },
  obsloc: { POSSIBLE: 'POSSIBLE', LIMITED: 'LIMITED', UNKNOWN: 'UNKNOWN' },
  comp: { IDENTIFIED: 'IDENTIFIED', UNKNOWN: 'UNKNOWN — REQUIRES IDENTIFICATION' },
  candidate: { YES: 'YES', NO: 'NO', NEEDS_ANALYSIS: 'ТРЕБУЕТ АНАЛИЗА' },
  cPower: { YES: 'Да', NO: 'Нет', UNKNOWN: '?' },
  cSignal: { GOOD: 'Good', WEAK: 'Weak', NO: 'No' },
  attest: { confirmed: 'Подтверждаю', cannot: 'Не могу подтвердить' },
};

export const STATUS = { checked: 'проверено', no_access: 'нет доступа', absent: 'отсутствует', tbd: 'TBD' };

export function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
export function fmtBytes(n) {
  if (n == null) return '—';
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' ГБ';
  if (n > 1e6) return Math.round(n / 1e6) + ' МБ';
  return Math.round(n / 1e3) + ' КБ';
}
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
