// Минимальный ZIP (без сжатия) + SHA-256 + CRC32. Без внешних библиотек, работает офлайн.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();

// Читает Blob/строку один раз и возвращает всё нужное для пакета.
export async function describe(data) {
  let blob;
  if (typeof data === 'string') blob = new Blob([enc.encode(data)]);
  else if (data instanceof Uint8Array) blob = new Blob([data]);
  else blob = data;
  const u8 = new Uint8Array(await blob.arrayBuffer());
  return { blob, size: u8.length, crc: crc32(u8), sha256: await sha256Hex(u8) };
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ path, blob, size, crc }]
export function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();
  for (const e of entries) {
    const name = enc.encode(e.path);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // имена в UTF-8
    lh.setUint16(8, 0, true); // без сжатия
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, e.crc, true);
    lh.setUint32(18, e.size, true);
    lh.setUint32(22, e.size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, e.blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, e.crc, true);
    ch.setUint32(20, e.size, true);
    ch.setUint32(24, e.size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + e.size;
  }
  let cdSize = 0;
  for (const p of central) cdSize += p.byteLength;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Чтение ZIP, созданного этим же приложением (метод 0, без zip64).
export async function readZip(file) {
  const tailLen = Math.min(file.size, 66000);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не ZIP-архив или он повреждён');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Повреждён каталог архива');
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const path = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    if (method !== 0) throw new Error('Архив создан другой программой (есть сжатие). Нужна копия из этого приложения.');
    out.push({ path, size, crc, lho });
    p += 46 + nameLen + extraLen + commentLen;
  }
  for (const e of out) {
    const lh = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
    const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    e.blob = file.slice(start, start + e.size);
  }
  return out;
}
