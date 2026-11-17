/* Photo principale du centre (lot « Match libre », phase photos — option A d'Aymen du 17/11/2026 : dans la base, aucune dépendance).
   La photo est réduite ICI, dans le navigateur du gérant, avec ce que tout navigateur sait faire (createImageBitmap + canvas) : rognée
   au format 2:1 des maquettes (bande de la fiche, cartes), en deux tailles JPEG. Le serveur ne reçoit jamais l'original. */

export const PHOTO_SIZES = { large: { w: 1600, h: 800 }, card: { w: 640, h: 320 } } as const;
/** Plafonds du serveur (migration 0049), avec une marge. */
const MAX_BYTES = { large: 850_000, card: 230_000 } as const;
const QUALITIES = [0.82, 0.72, 0.62, 0.52] as const;

export interface PhotoCrop { sx: number; sy: number; sw: number; sh: number }

/** Le rectangle source qui remplit un cadre `ratio`:1 sans déformer (rognage centré, comme `object-fit: cover`). */
export function coverCrop(srcW: number, srcH: number, ratio = 2): PhotoCrop {
  if (srcW <= 0 || srcH <= 0) throw new Error('image vide');
  if (srcW / srcH > ratio) {
    const sw = Math.round(srcH * ratio);
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  const sh = Math.round(srcW / ratio);
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

/** Taille de sortie : jamais plus grande que la source (on ne gonfle pas une petite image). */
export function outputSize(crop: PhotoCrop, target: { w: number; h: number }): { w: number; h: number } {
  const scale = Math.min(1, target.w / crop.sw);
  return { w: Math.max(1, Math.round(crop.sw * scale)), h: Math.max(1, Math.round(crop.sh * scale)) };
}

export class PhotoError extends Error {
  constructor(public readonly kind: 'unreadable' | 'too-small' | 'too-heavy') { super(kind); }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('unreadable'))), 'image/jpeg', quality));
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new PhotoError('unreadable'));
    r.readAsDataURL(blob);
  });
}

async function render(bitmap: ImageBitmap, crop: PhotoCrop, size: keyof typeof PHOTO_SIZES): Promise<{ base64: string; blob: Blob }> {
  const out = outputSize(crop, PHOTO_SIZES[size]);
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('unreadable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, out.w, out.h);
  for (const q of QUALITIES) {
    const blob = await toBlob(canvas, q);
    if (blob.size <= MAX_BYTES[size]) return { base64: await base64Of(blob), blob };
  }
  throw new PhotoError('too-heavy');
}

/** Lit l'image choisie, la rogne en 2:1 et produit les deux tailles à envoyer (`PUT /venues/:id/photo`). */
export async function preparePhoto(file: File): Promise<{ mime: 'image/jpeg'; large: string; card: string; previewUrl: string }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new PhotoError('unreadable'); }
  try {
    if (bitmap.width < 320 || bitmap.height < 160) throw new PhotoError('too-small');
    const crop = coverCrop(bitmap.width, bitmap.height);
    const large = await render(bitmap, crop, 'large');
    const card = await render(bitmap, crop, 'card');
    return { mime: 'image/jpeg', large: large.base64, card: card.base64, previewUrl: URL.createObjectURL(card.blob) };
  } finally {
    bitmap.close();
  }
}
