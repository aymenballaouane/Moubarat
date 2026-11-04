import { useState } from 'react';
import { Ltr } from './Ltr.js';
import { haptic } from '../lib/haptic.js';
import { useLang, useT } from '../lib/i18n.js';
import { hhmm } from '../lib/format.js';
import { fillTemplate } from '../lib/reserverCreneau.js';

/* « Oups, il vient d'être pris » (Lot 5, ErreurCreneauPris.dc.html) : feuille posée sur « Ta réservation »
   quand le serveur refuse le départ visé (SLOT_TAKEN). Propose les créneaux réellement libres les plus
   proches ; « Prendre … » les sélectionne dans R3 (ReserverCreneauRepli), « Voir tous les créneaux » referme. */

export interface SlotTakenSheetProps {
  /** « sam. 24 » / « ce soir » — déjà mis en forme par l'appelant (même logique que le récap de R3). */
  dayWord: string;
  takenStartMin: number;
  venueName: string;
  fieldName: string;
  durationMin: number;
  /** Départs de repli (réellement libres, départ pris exclu), ordre chronologique. */
  alternatives: readonly number[];
  onTake: (startMin: number) => void;
  onClose: () => void;
}

/** Isole chaque valeur insérée (nom de centre latin dans une phrase arabe, etc.) : sans cela, le sens RTL
    mélange parenthèses, virgule et noms (« Green Arena Sport،) … T1) »). U+2068/U+2069 = FSI/PDI. */
const isolate = (v: string) => `${String.fromCharCode(0x2068)}${v}${String.fromCharCode(0x2069)}`;

export function SlotTakenSheet(p: SlotTakenSheetProps) {
  const t = useT();
  const lang = useLang();
  const arrow = lang === 'ar' ? '←' : '→';
  const [picked, setPicked] = useState<number | null>(p.alternatives[0] ?? null);
  const chosen = picked !== null && p.alternatives.includes(picked) ? picked : p.alternatives[0] ?? null;
  const sentence = fillTemplate(t('Quelqu’un a réservé {jour} à {heure} ({centre}, {terrain}) juste avant toi.'), {
    jour: isolate(p.dayWord), heure: isolate(hhmm(p.takenStartMin)), centre: isolate(p.venueName), terrain: isolate(p.fieldName),
  });

  return (
    <div className="mb-sheet-bg" role="dialog" aria-modal="true" aria-label={t('Oups, il vient d’être pris')} onClick={p.onClose}>
      <div className="mb-sheet rsv-taken" onClick={(e) => e.stopPropagation()}>
        <span className="rsv-taken__grab" aria-hidden="true" />
        <h3 className="rsv-taken__title">{t('Oups, il vient d’être pris')}</h3>
        <p className="rsv-taken__body">
          {sentence}{p.alternatives.length > 0 ? ` ${t('Ces créneaux sont encore libres :')}` : ''}
        </p>
        {p.alternatives.length > 0 ? (
          <div className="rsv-taken__chips">
            {p.alternatives.map((s) => (
              <button key={s} type="button" className="rsv-taken__chip mb-tap" aria-pressed={chosen === s} onClick={() => setPicked(s)}>
                <Ltr>{hhmm(s)}</Ltr> {arrow} <Ltr>{hhmm(s + p.durationMin)}</Ltr>
              </button>
            ))}
          </div>
        ) : null}
        <div className="rsv-taken__actions">
          {chosen !== null ? (
            <button type="button" className="mb-btn mb-btn--block" onClick={() => { haptic('light'); p.onTake(chosen); }}>
              {fillTemplate(t('Prendre {heure}'), { heure: hhmm(chosen) })}
            </button>
          ) : null}
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={p.onClose}>
            {t('Voir tous les créneaux')}
          </button>
        </div>
      </div>
    </div>
  );
}
