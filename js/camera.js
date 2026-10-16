// Съёмка внутри приложения. Фото не попадают в галерею телефона.
import { A, addPhoto } from './model.js';

export async function startStream(video) {
  const tries = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false },
    { video: true, audio: false },
  ];
  let last;
  for (const c of tries) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(c);
      video.srcObject = s;
      await video.play();
      return s;
    } catch (e) { last = e; }
  }
  throw last;
}
export const stopStream = s => { if (s) s.getTracks().forEach(t => t.stop()); };

async function thumbOf(src) {
  const k = Math.min(1, 360 / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.75));
}

export async function grabFrame(video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error('Камера ещё не готова');
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return { blob, thumb: await thumbOf(c), w, h };
}

export async function fromFile(file) {
  try {
    const bmp = await createImageBitmap(file);
    const out = { blob: file, thumb: await thumbOf(bmp), w: bmp.width, h: bmp.height };
    if (bmp.close) bmp.close();
    return out;
  } catch {
    return { blob: file, thumb: null, w: 0, h: 0 };
  }
}

export async function savePhoto(scope, ref, slot, payload, source) {
  return addPhoto({ scope, ref, slot, blob: payload.blob, thumb: payload.thumb, w: payload.w, h: payload.h, source });
}
