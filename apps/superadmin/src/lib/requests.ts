/* Demandes d'inscription d'un centre (20/09/2026, demande d'Aymen) — types et projections pures
   (testées dans tests/requests.test.ts), partagés par l'onglet « Demandes » et le formulaire de
   création de centre. */

import { SPORT_LABELS as CORE_SPORT_LABELS } from '@moubarat/core';

export type RequestStatus = 'NEW' | 'CONVERTED' | 'REJECTED';

export interface VenueRequest {
  id: string; createdAt: string; status: RequestStatus;
  name: string; wilaya: string; address: string;
  contactName: string; contactPhone: string; contactEmail: string;
  sports: string[]; fieldsCount: number | null; message: string | null;
  venueId: string | null; venueName: string | null; decidedAt: string | null;
}

export interface RequestCounts { new: number; converted: number; rejected: number }

/* Était une troisième table SPORT_LABELS locale indépendante (CRM et app joueur en
   avaient chacun une aussi, mêmes valeurs) — chantier arabe RTL (18/10/2026, lot 1) :
   unifiée dans le core. `sports` reste un `string[]` non typé (formulaire public, pas
   encore validé contre l'union Sport), d'où le repli `?? s` sur une valeur inconnue. */
export function sportsLabel(sports: readonly string[]): string {
  return sports.map((s) => CORE_SPORT_LABELS[s as keyof typeof CORE_SPORT_LABELS] ?? s).join(' · ');
}

/** Ce que « Créer le centre » reporte dans le formulaire de création : le centre lui-même, le
    téléphone du contact comme téléphone du centre, et le contact comme futur gérant. Latitude et
    longitude restent à saisir (une demande publique n'en porte pas), l'activation reste un choix. */
export interface CreatePrefill {
  requestId: string; contactName: string;
  name: string; wilaya: string; address: string; phone: string; gerantEmail: string; gerantName: string;
}

export function prefillFromRequest(r: VenueRequest): CreatePrefill {
  return {
    requestId: r.id, contactName: r.contactName,
    name: r.name, wilaya: r.wilaya, address: r.address, phone: r.contactPhone,
    gerantEmail: r.contactEmail, gerantName: r.contactName,
  };
}
