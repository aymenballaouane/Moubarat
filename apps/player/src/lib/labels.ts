import { sportLabel, SPORT_LABELS, type Match, type SkillLevel } from '@moubarat/core';

/* Libelles francais partages pour les valeurs canoniques du core — UNE seule
   table par taxonomie (spec Premium §7 : « share one formatting helper so a
   future §24-A resolution updates both automatically »). Jamais de libelle
   de niveau retape ecran par ecran, jamais « Débutant »/« Avancé » (valeurs
   inexistantes dans SkillLevel, piege documente du benchmark). */

export const LEVEL_LABELS: Record<SkillLevel, string> = {
  LOISIR: 'Loisir',
  INTERMEDIAIRE: 'Intermédiaire',
  COMPETITION: 'Compétition',
};

export function levelLabel(level: SkillLevel): string {
  return LEVEL_LABELS[level];
}

/* SPORT_LABELS et sportLabel viennent désormais de @moubarat/core (chantier arabe RTL,
   18/10/2026, lot 1) — c'était une table locale, identique à celle du CRM mais définie
   indépendamment. Ré-exportés ici tels quels pour ne casser aucun des appelants existants. */
export { sportLabel, SPORT_LABELS };

/** Villes de la règle 34 (code stocké en base, ex. `ALGER`) → libellé français — AuthFlow.tsx
    avait sa propre copie locale (onboarding) ; le lot 4b (pastille ville du Header) en a
    besoin aussi, d'où le partage ici plutôt qu'une troisième copie. */
export const CITY_LABELS: Record<string, string> = {
  ALGER: 'Alger', ORAN: 'Oran', CONSTANTINE: 'Constantine', ANNABA: 'Annaba', BLIDA: 'Blida', SETIF: 'Sétif', AUTRE: 'Autre',
};

export function cityLabel(city: string): string {
  return CITY_LABELS[city] ?? city;
}

/** « Football · 5v5 · Loisir » — la ligne d'identite d'un match, partout. */
export function matchTagLine(m: Pick<Match, 'sport' | 'format' | 'level'>): string {
  return `${sportLabel(m.sport)} · ${m.format} · ${levelLabel(m.level)}`;
}

/** « Karim, Riad et Sami » — noms reels (dynamiques, jamais dans le dictionnaire) joints
    a la francaise ; "Tes amis jouent bientot" (regle 11, Main.dc.html). `t` sert seulement
    a traduire le mot « et » (seule partie fixe). L'arabe de la maquette colle le « و » devant
    CHAQUE nom sans virgule ("كريم ورياض ووليد وسامي") — impossible a reproduire exactement
    depuis une liste de noms arbitraires avec un dictionnaire mot-a-mot (pas de gabarit dans
    t()) ; on garde donc la meme structure virgules + « et »/« و » final dans les deux langues,
    lisible mais pas grammaticalement parfaite en arabe — compromis accepte pour ce lot. */
export function joinNames(names: string[], t: (key: string) => string): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  const last = names[names.length - 1]!;
  const rest = names.slice(0, -1);
  return `${rest.join(', ')} ${t('et')} ${last}`;
}
