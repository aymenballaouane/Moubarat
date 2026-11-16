/* Chantier CRM — écran Journal (06/09/2026). Projection PURE de
   GET /venues/:venueId/audit-log vers ce que l'écran affiche — aucune règle
   métier ici, aucun réseau. `ROLE_LABELS` (core, ops.ts) reste la seule
   source pour le libellé de rôle — jamais réimplémenté. `formatAuditLine`
   (core, même fichier) existe aussi, mais renvoie UNE seule chaîne
   concaténée (acteur · rôle · heure — résumé) : la maquette (et le CSS
   `.cm-mvt`) sépare le préfixe (gras) du résumé (normal) en deux éléments
   distincts — reproduire ça depuis une chaîne unique aurait demandé de la
   reparser. Décision : réutiliser `ROLE_LABELS`, composer les deux
   fragments ici plutôt que `formatAuditLine`. */

import { ROLE_LABELS, type CenterRole } from '@moubarat/core';
import { algiersDateOf, dayLabel, shiftDate, todayAlgiers } from './bookingsDetail.js';
import type { TFn } from './i18n.js';

const identity: TFn = (k) => k;

function relativeDayLabel(dateIso: string, t: TFn): string {
  const today = todayAlgiers();
  if (dateIso === today) return t('Aujourd\'hui');
  if (dateIso === shiftDate(today, -1)) return t('Hier');
  return dayLabel(dateIso); // P1-15 (lot C) : rend l'arabe tout seul (getLang)
}

/** « Hier 23:41 » / « Aujourd'hui 14:32 » / « Mer. 30 sept. 09:15 ». P1-15 (lot C) : `t` traduit « Aujourd'hui » / « Hier ». */
export function auditTimeLabel(atIso: string, t: TFn = identity): string {
  const epochMs = Date.parse(atIso);
  const dateIso = algiersDateOf(epochMs);
  const algiers = new Date(epochMs + 3_600_000); // Alger = UTC+1 fixe, jamais d'heure d'été
  const hh = String(algiers.getUTCHours()).padStart(2, '0');
  const mm = String(algiers.getUTCMinutes()).padStart(2, '0');
  return `${relativeDayLabel(dateIso, t)} ${hh}:${mm}`;
}

/** Depuis le 22/09/2026, le SUPERADMIN apparaît dans ce journal : la modification de la fiche du
    centre (platform/venues/routes.ts, CENTER_UPDATED) est écrite AVEC `venueId`. Le serveur masque
    alors le nom du compte (« Équipe Moubarat », modules/audit/routes.ts) ; ici, le rôle s'affiche
    « Plateforme ». Les autres actions SUPERADMIN (validation, suspension du centre…) n'ont toujours
    pas de `venueId` et restent hors de ce journal. `actorRole` reste du texte libre en base :
    filet de sécurité, jamais un crash sur un rôle inconnu. P1-15 (lot C) : libellé traduit par `t` ;
    un rôle inconnu est renvoyé tel quel, jamais traduit. */
export function roleLabel(actorRole: string, t: TFn = identity): string {
  if (actorRole === 'SUPERADMIN') return t('Plateforme');
  // Audit final, MS-020 : un joueur qui annule sa propre réservation apparaît au Journal.
  if (actorRole === 'PLAYER') return t('Joueur');
  const label = ROLE_LABELS[actorRole as CenterRole] as string | undefined;
  return label !== undefined ? t(label) : actorRole;
}
