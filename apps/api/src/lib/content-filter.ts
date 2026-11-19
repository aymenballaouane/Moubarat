import { ApiError } from './http.js';

/* Lot B (18/11/2026, GO d'Aymen : « ajoute-le au lot, côté serveur ; montre-moi la liste avant de l'activer ») — le filtre des insultes
   et contenus choquants sur ce que les joueurs écrivent et que d'autres lisent : pseudo, prénom et nom, nom et mot d'un match, nom d'un
   lieu, nom d'une équipe. Exigence de l'App Store (règle 1.2) et de Google Play (contenu créé par les utilisateurs), avec le
   signalement et le blocage déjà en place.
   DÉSACTIVÉ PAR DÉFAUT : il ne s'applique que si CONTENT_FILTER_ENABLED=true (décision d'Aymen après relecture de la liste,
   docs/FILTRE-INSULTES.md). La liste est volontairement courte et sans mots ambigus : un faux refus (« Concorde », « Hammam ») gêne plus
   qu'un mot rare qui passe — le signalement et le blocage restent là pour le reste.
   Comparaison : minuscules, sans accents, chiffres « déguisés » ramenés aux lettres pour le français (p0ute → poute), lettres répétées
   resserrées (puuuute → pute) ; arabe sans voyelles ni tatouil, alif/ta marbuta unifiés. Un mot de la liste doit correspondre à un MOT
   ENTIER du texte (ou à une suite de mots pour les expressions) — jamais à un morceau de mot. */

/** Français et darija écrite en lettres latines (avec ses chiffres : 3 = ع, 7 = ح, 9 = ق). */
export const BLOCKED_LATIN: readonly string[] = [
  // Français — insultes et obscénités sans ambiguïté
  'connard', 'connasse', 'salope', 'salopard', 'pute', 'putain', 'pétasse', 'encule', 'enculé', 'enculer', 'enculee',
  'batard', 'bâtard', 'fdp', 'ntm', 'nique', 'niquer', 'nike ta mere', 'nique ta mere', 'fils de pute', 'ta mere la pute',
  'pd', 'pédé', 'pede', 'tapette', 'tarlouze', 'gouine', 'bougnoule', 'youpin', 'bicot', 'negre', 'nègre', 'negro',
  'trou du cul', 'branleur', 'branleuse', 'couillon', 'grosse merde', 'sale merde', 'va te faire foutre', 'ta gueule',
  // Darija (lettres latines)
  'zebi', 'zeb', 'zabi', 'qahba', 'kahba', 'kahbouch', '9a7ba', '97ba', 'q7ba', 'nikmok', 'nik mok', 'nikomok', 'nik yemak', 'nik yemmak',
  'zamel', 'zemel', 'zamal', 'zmel', '3atay', 'miboun', 'mibon', 'mibone', 'khra', 'khara', 'weld l97ba', 'wald l97ba',
  'weld el kahba', 'wled l97ab',
];

/** Arabe (écrit tel qu'il sera comparé, après normalisation : ة → ه, أ/إ/آ → ا, ى → ي). */
export const BLOCKED_ARABIC: readonly string[] = [
  'زبي', 'زب', 'قحبه', 'قحاب', 'نيك', 'نيكمك', 'نيك يماك', 'زامل', 'زوامل', 'شرموطه', 'شرموط', 'عاهره', 'منيوك', 'منيوكه',
  'خرا', 'عطاي', 'ميبون', 'كس', 'كسمك', 'كس امك', 'طيز', 'ولد القحبه', 'يا قحبه', 'لعن دينك', 'لعن ربك',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '€': 'e' };

function latinBase(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/(\p{L})\1{2,}/gu, '$1');
}
function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
function arabicBase(text: string): string {
  return text.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}
function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

const LATIN_PHRASES = BLOCKED_LATIN.map((w) => words(latinBase(w)));
const ARABIC_PHRASES = BLOCKED_ARABIC.map((w) => words(arabicBase(w)));

/** Le mot interdit trouvé dans `text`, ou `null`. */
export function blockedWordIn(text: string): string | null {
  if (!text || !text.trim()) return null;
  const base = latinBase(text);
  const plain = words(base);
  // Variante « chiffres déguisés » : seulement pour des mots qui mêlent lettres et chiffres (p0ute), jamais pour un nombre seul.
  const unleet = plain.map((w) => (/\p{L}/u.test(w) && /[0-9@$€]/.test(w) ? w.replace(/[0-9@$€]/g, (c) => LEET[c] ?? c) : w));
  // Lettres espacées (« p u t e ») : les suites de lettres isolées sont recollées.
  const glued: string[] = [];
  for (const w of plain) {
    if (w.length === 1 && glued.length > 0 && glued[glued.length - 1]!.startsWith('\u0000')) glued[glued.length - 1] += w;
    else glued.push(w.length === 1 ? '\u0000' + w : w);
  }
  const gluedWords = glued.map((w) => w.replace(/^\u0000/, ''));
  for (let i = 0; i < LATIN_PHRASES.length; i++) {
    const p = LATIN_PHRASES[i]!;
    if (containsPhrase(plain, p) || containsPhrase(unleet, p) || containsPhrase(gluedWords, p)) return BLOCKED_LATIN[i]!;
  }
  const ar = words(arabicBase(text));
  for (let i = 0; i < ARABIC_PHRASES.length; i++) if (containsPhrase(ar, ARABIC_PHRASES[i]!)) return BLOCKED_ARABIC[i]!;
  return null;
}

export const CONTENT_REFUSED = 'CONTENT_REFUSED';

/** Refuse (400 CONTENT_REFUSED) un texte qui contient un mot interdit — seulement si le filtre est activé. Les valeurs vides passent. */
export function assertCleanText(enabled: boolean, ...texts: readonly (string | null | undefined)[]): void {
  if (!enabled) return;
  for (const t of texts) {
    if (t && blockedWordIn(t)) {
      throw new ApiError(400, CONTENT_REFUSED, 'Ce texte contient un mot qui n’est pas accepté sur Moubarat. Reformule, s’il te plaît.');
    }
  }
}
