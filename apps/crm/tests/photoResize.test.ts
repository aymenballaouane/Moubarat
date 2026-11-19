import { describe, expect, it } from 'vitest';
import { coverCrop, outputSize, PHOTO_SIZES } from '../src/lib/photoResize.js';

/* Phase photos (option A d'Aymen, 17/11/2026) — le rognage 2:1 fait dans le navigateur du gérant avant l'envoi. */

describe('photo du centre — rognage et taille', () => {
  it('une photo plus large que 2:1 est rognée sur les côtés, centrée', () => {
    expect(coverCrop(3000, 1000)).toEqual({ sx: 500, sy: 0, sw: 2000, sh: 1000 });
  });
  it('une photo de téléphone (4:3 ou portrait) est rognée en haut et en bas, centrée', () => {
    expect(coverCrop(4000, 3000)).toEqual({ sx: 0, sy: 500, sw: 4000, sh: 2000 });
    expect(coverCrop(1080, 1920)).toEqual({ sx: 0, sy: 690, sw: 1080, sh: 540 });
  });
  it('réduite à 1600×800 et 640×320 au plus, jamais agrandie', () => {
    const big = coverCrop(4000, 3000);
    expect(outputSize(big, PHOTO_SIZES.large)).toEqual({ w: 1600, h: 800 });
    expect(outputSize(big, PHOTO_SIZES.card)).toEqual({ w: 640, h: 320 });
    expect(outputSize(coverCrop(500, 250), PHOTO_SIZES.large)).toEqual({ w: 500, h: 250 });
  });
});
