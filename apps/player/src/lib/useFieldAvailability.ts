import { useEffect, useRef, useState } from 'react';
import { pickerDateForWeekday } from './format.js';
import type { AppStore } from '../state/useAppStore.js';
import type { AvailabilityStart } from './mappers.js';
import { mergeFieldAvailabilities, type FormatRate } from './availabilityMerge.js';

/* Lot 3B, étape 4 : disponibilité réelle pour un jour/durée donnés — un seul
   hook, partagé par les écrans qui pilotent SlotPicker (Réservation, Créer un
   match ×2), pour ne jamais dupliquer l'effet de récupération réseau. `date`
   (résolue via pickerDateForWeekday, la MÊME règle que le chip « aujourd'hui »
   déjà affiché par SlotPicker) est renvoyée pour que l'appelant l'utilise TELLE
   QUELLE dans createBooking — jamais reconstruite depuis un epoch, seule
   garantie contre l'ambiguïté des créneaux après minuit (voir docs/DECISIONS.md,
   Lot 3B étape 4).
   `starts` reste `undefined` tant qu'aucune réponse n'est encore arrivée —
   jamais confondu avec « 0 départ réel », qui afficherait à tort « Aucun
   départ libre » avant même d'avoir demandé au serveur ; remis à `undefined` à
   chaque changement de jour/durée (jamais l'ancien jour affiché sous
   l'étiquette du nouveau, le temps que la vraie réponse arrive).

   A7 bis (23/09/2026) : le hook prend LES TERRAINS d'un sport (dans l'ordre de
   remplissage) et fusionne leurs disponibilités (availabilityMerge.ts) — chaque
   devis porte le `fieldId` du terrain à réserver, ce qui rend réservable un
   terrain qu'aucun autre du même sport ne remplace (T2 en 7v7 quand T1 est en
   5v5/6v6). */

interface FieldAvailabilityResult {
  starts: readonly AvailabilityStart[] | undefined;
  /** Formats RÉELS proposés (union des terrains) avec le tarif de base de chacun
      (DA/heure), pour le récap Pleines/Creuses de SlotPicker (prop
      `remoteFormats`) — jamais le `BASE_RATE` mock. `undefined` tant qu'aucune
      réponse n'est arrivée. */
  formats: readonly FormatRate[] | undefined;
  date: string;
  loading: boolean;
  /** Force un nouvel appel réseau sans attendre un changement de jour/durée
      — utilisé après un SLOT_TAKEN, pour que la grille reflète le vrai état
      serveur plutôt que de s'en remettre au seul filet visuel local
      (rejectedByDay, toujours en place en complément). Ne réinitialise PAS
      `starts` à `undefined` (contrairement au changement de jour/durée) :
      la grille déjà affichée reste visible pendant le rafraîchissement,
      jamais un flash "Chargement…" à chaque nouvelle tentative. */
  refresh: () => void;
}

/** `fieldIds` vide : terrain(s) pas encore résolus (fiche du centre pas chargée, cas limite puisque le
    bootstrap résout déjà store.venue avant que ces écrans ne montent). Aucun appel réseau — jamais un
    fieldId factice envoyé au serveur. */
export function useFieldAvailability(
  store: AppStore, fieldIds: readonly string[], weekday: number, durationMin: number,
  onError?: (message: string) => void,
): FieldAvailabilityResult {
  const date = pickerDateForWeekday(weekday);
  const idsKey = fieldIds.join(',');
  const [starts, setStarts] = useState<readonly AvailabilityStart[] | undefined>(undefined);
  const [formats, setFormats] = useState<readonly FormatRate[] | undefined>(undefined);
  const [loading, setLoading] = useState(fieldIds.length > 0);
  /* Deux garde-fous distincts contre les réponses périmées, nécessaires
     ensemble (revue adverse, Lot 3B étape 4) :
     - `requestSeq` : parmi TOUTES les requêtes émises (peu importe le
       closure qui les a déclenchées), seule la DERNIÈRE émise peut écrire
       l'état — protège contre un réseau qui répond dans le désordre.
     - `currentKey` (ref, donc partagée par tous les renders, jamais figée
       dans un closure) : la réponse doit encore décrire ce qui est
       RÉELLEMENT affiché au moment où elle arrive. Sans ce deuxième garde,
       un `refresh()` appelé depuis un closure périmé (ex. confirmSlot() qui
       reprend après un `await`, pendant que l'utilisateur a changé de jour
       entre-temps) rafraîchirait avec l'ANCIEN jour/durée capturés à
       l'ouverture de l'appel, et pourrait légitimement "gagner" la course
       de `requestSeq` tout en affichant les mauvais créneaux sous la bonne
       étiquette de jour — trouvé en revue, jamais observé en direct. */
  const requestSeq = useRef(0);
  const currentKey = useRef('');
  currentKey.current = `${idsKey}|${date}|${durationMin}`;

  function fetchFor(targetIds: readonly string[], targetDate: string, targetDurationMin: number) {
    const key = `${targetIds.join(',')}|${targetDate}|${targetDurationMin}`;
    const seq = ++requestSeq.current;
    setLoading(true);
    Promise.all(targetIds.map((fieldId) => store.fetchAvailability({ fieldId, date: targetDate, durationMin: targetDurationMin })))
      .then((results) => {
        if (seq !== requestSeq.current || key !== currentKey.current) return;
        const failed = results.find((r) => !r.ok);
        if (failed) {
          setStarts([]);
          onError?.(failed.message);
        } else {
          const merged = mergeFieldAvailabilities(results.map((r, i) => ({
            fieldId: targetIds[i]!, starts: r.starts ?? [], formats: r.formats ?? [],
          })));
          setStarts(merged.starts);
          setFormats(merged.formats);
        }
        setLoading(false);
      });
  }

  useEffect(() => {
    setStarts(undefined);
    if (fieldIds.length === 0) { setLoading(false); return; }
    fetchFor(fieldIds, date, durationMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, date, durationMin]);

  return { starts, formats, date, loading, refresh: () => { if (fieldIds.length > 0) fetchFor(fieldIds, date, durationMin); } };
}
