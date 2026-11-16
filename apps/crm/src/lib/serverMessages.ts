/* CRM en arabe — lot D (P1-15, 16/11/2026). Le serveur répond en français (un seul texte, partagé avec la console et l'app
   joueur) ; le CRM traduit le message À LA RÉCEPTION (lib/api.ts), avec repli sur le français s'il ne le connaît pas.
   Fichier : src/i18n/fr-ar-serveur.json — mêmes blocs que fr-ar.json (« textes » relus / « textes_provisoires » à relire).
   - message exact : traduit tel quel ;
   - message à valeur (« Ce compte est déjà rattaché à {1} ({2}). ») : la clé garde des emplacements `{1}`, `{2}`… ; le message
     reçu est reconnu par un gabarit, chaque valeur est reprise dans la phrase arabe — traduite elle aussi si c'est un morceau
     connu (« fragments » : rôles, statuts, « il est déjà publié »…) ou une durée (« 5 minutes ») ;
   - « vouvoiement » : quelques messages du serveur partagés avec l'app joueur tutoient ; le CRM vouvoie (décision d'Aymen du
     15/11/2026, « vous partout ») — leur version au « vous », en français, et le point de départ de leur traduction.
   Relevé des messages et test de couverture : tests/server-messages-keys.ts, tests/server-messages.test.ts. */
import data from '../i18n/fr-ar-serveur.json';
import type { Lang } from './lang.js';

type Block = Record<string, string>;
const D = data as unknown as { textes: Block; textes_provisoires: Block; fragments: Block; vouvoiement: Block };

const DICT: Block = { ...D.textes_provisoires, ...D.textes };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Les gabarits (clés à emplacements), du plus précis (le plus de texte fixe) au moins précis. */
const TEMPLATES: { re: RegExp; key: string }[] = Object.keys(DICT)
  .filter((k) => /\{\d+\}/.test(k))
  .map((key) => ({ key, fixed: key.replace(/\{\d+\}/g, '').length, re: new RegExp(`^${key.split(/\{\d+\}/).map(escapeRe).join('([\\s\\S]*?)')}$`) }))
  .sort((a, b) => b.fixed - a.fixed)
  .map(({ re, key }) => ({ re, key }));

function fragment(s: string): string {
  const known = D.fragments[s];
  if (known !== undefined) return known;
  const sec = /^(\d+) secondes?$/.exec(s);
  if (sec) return arabicCount(Number(sec[1]), ['ثانية واحدة', 'ثانيتين', 'ثوانٍ', 'ثانية']);
  const min = /^(\d+) minutes?$/.exec(s);
  if (min) return arabicCount(Number(min[1]), ['دقيقة واحدة', 'دقيقتين', 'دقائق', 'دقيقة']);
  return s;
}

/** Une durée en arabe, accordée : 1 → « دقيقة واحدة », 2 → « دقيقتين », 3 à 10 → « 3 دقائق », 11 et plus → « 11 دقيقة ». */
function arabicCount(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const mod = n % 100;
  return `${n} ${mod >= 3 && mod <= 10 ? few : many}`;
}

/** Le message d'erreur du serveur dans la langue de l'écran (repli : le français, au « vous »). */
export function localizeServerMessage(message: string, lang: Lang): string {
  const fr = D.vouvoiement[message] ?? message;
  if (lang === 'fr') return fr;
  if (/[؀-ۿ]/.test(message)) return message;
  const exact = DICT[message] ?? DICT[fr];
  if (exact !== undefined) return exact;
  for (const { re, key } of TEMPLATES) {
    const m = re.exec(message);
    if (m) return DICT[key]!.replace(/\{(\d+)\}/g, (_, i: string) => fragment((m[Number(i)] ?? '').trim()));
  }
  return fr;
}
