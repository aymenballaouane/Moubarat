/* CRM en arabe — lot E (P1-15, 16/11/2026) : produit docs/traductions-crm-a-relire.md, la liste des traductions arabes du CRM
   à faire relire par un arabophone, rangées par écran, avec les choix de vocabulaire à trancher en premier.
   Relancer après tout ajout de texte : `pnpm --filter @moubarat/crm traductions:relire` (lit le code et les deux fichiers de
   traductions ; n'écrit que ce document). Une traduction déjà relue (bloc « textes ») n'apparaît plus dans la liste. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { literalKeys } from '../tests/i18n-keys.ts';
import { serverMessageKeys } from '../tests/server-messages-keys.ts';

const CRM = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(CRM, '..', '..', 'docs', 'traductions-crm-a-relire.md');

type Block = Record<string, string>;
const ecrans = JSON.parse(readFileSync(join(CRM, 'src/i18n/fr-ar.json'), 'utf8')) as { textes: Block; textes_provisoires: Block };
const serveur = JSON.parse(readFileSync(join(CRM, 'src/i18n/fr-ar-serveur.json'), 'utf8')) as { textes: Block; textes_provisoires: Block; fragments: Block };
const via = JSON.parse(readFileSync(join(CRM, 'tests/i18n-via-variable.json'), 'utf8')) as string[];

/** Nom lisible de l'écran d'après le fichier où le texte apparaît. */
const SCREEN: Record<string, string> = {
  'App.tsx': 'Cadre (en-tête, menu)', 'LoginScreen.tsx': 'Connexion', 'RequestScreen.tsx': 'Demande de référencement',
  'LegalGate.tsx': 'Conditions d’utilisation', 'HelpModal.tsx': 'Aide', 'AccountModal.tsx': 'Mon compte',
  'CredentialsBox.tsx': 'Identifiants générés', 'SubscriptionBanner.tsx': 'Bandeaux', 'ReadinessBanner.tsx': 'Bandeaux',
  'LangToggle.tsx': 'Cadre (en-tête, menu)', 'Toast.tsx': 'Cadre (en-tête, menu)', 'ConfirmModal.tsx': 'Cadre (en-tête, menu)',
  'Dashboard.tsx': 'Dashboard', 'dashboardDetail.ts': 'Dashboard', 'Planning.tsx': 'Planning',
  'Reservations.tsx': 'Réservations', 'StatusPill.tsx': 'Réservations', 'searchDetail.ts': 'Réservations',
  'Abonnements.tsx': 'Abonnements', 'Analytics.tsx': 'Analytics', 'MonthlyReport.tsx': 'Analytics — rapport du mois',
  'monthlyReport.ts': 'Analytics — rapport du mois', 'Clients.tsx': 'Clients', 'Personnel.tsx': 'Personnel', 'Caisse.tsx': 'Caisse',
  'Journal.tsx': 'Journal', 'auditDetail.ts': 'Journal', 'Centre.tsx': 'Centre', 'venueDetail.ts': 'Centre', 'Equipes.tsx': 'Équipes',
  'readinessView.ts': 'Bandeaux',
};
const ORDER = ['Connexion', 'Demande de référencement', 'Conditions d’utilisation', 'Cadre (en-tête, menu)', 'Bandeaux', 'Aide',
  'Mon compte', 'Identifiants générés', 'Dashboard', 'Planning', 'Réservations', 'Abonnements', 'Analytics',
  'Analytics — rapport du mois', 'Clients', 'Personnel', 'Caisse', 'Journal', 'Centre', 'Équipes'];

/* Les choix de vocabulaire faits sans arabophone, à trancher d'abord : chacun revient dans des dizaines de textes. */
const DOUTES: [string, string, string][] = [
  ['Réservé · Honoré · Payé · No-show · Annulé (statuts)', 'محجوز · حاضر · مدفوع · غائب · ملغى', 'Les cinq statuts d’une réservation, partout dans le CRM.'],
  ['séance (d’un abonnement)', 'حصة', 'Abonnements, Réservations, Dashboard.'],
  ['comptoir (réservation prise sur place)', 'الشباك', 'Source d’une réservation ; étiquette courte « شباك » dans le Planning.'],
  ['App Moubarat / Moubarat (source)', 'تطبيق مبارات / مبارات', 'Les deux formes coexistent selon l’écran — en garder une ?'],
  ['Engagé (montant attendu)', 'مُلتزَم به', 'Réservations et Dashboard.'],
  ['Perdu no-show / Perdu annulations', 'ضائع (غيابات) / ضائع (إلغاءات)', 'Réservations.'],
  ['Réessayer (bouton)', 'أعيدوا المحاولة', 'Forme verbale au pluriel plutôt que le nom « إعادة المحاولة ».'],
  ['Moubarat (nom de marque)', 'مبارات', 'Translittération retenue partout.'],
  ['gérant', 'مسيّر', '« Un compte gérant actif » ; le rôle « Manager » est « المدير ».'],
  ['bandes tarifaires (heures pleines…)', 'فترات سعرية', 'Écran Centre, tarifs.'],
  ['Env. (intérieur / extérieur)', 'داخلي/خارجي', 'En-tête de colonne, écran Centre.'],
  ['motif (le créneau qui revient chaque semaine)', 'التوقيت الأسبوعي', 'Messages d’erreur des abonnements.'],
  ['centre publié (ACTIVE)', 'منشور', 'Messages d’erreur et bandeaux.'],
  ['« … {1} jours à l’avance »', 'يومًا', 'Juste de 11 à 99 jours (la limite actuelle est 60).'],
  ['« Réessayez dans {1} min »', 'بعد {1} د', 'Abréviation pour éviter l’accord de « دقيقة ».'],
  ['Vous / impératifs', 'أنتم — اختاروا، أدخلوا، أعيدوا المحاولة', 'Le CRM vouvoie ; l’arabe s’adresse au pluriel. Garder ?'],
];

const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const row = (fr: string, ar: string): string => `| ${esc(fr)} | ${esc(ar)} | |`;
const HEAD = '| Français | Arabe (provisoire) | Correction |\n|---|---|---|';

const lit = literalKeys();
const byScreen = new Map<string, string[]>();
const seen = new Set<string>();
for (const [key, file] of lit) {
  const ar = ecrans.textes_provisoires[key];
  if (ar === undefined || key in ecrans.textes) continue;
  const name = SCREEN[file.split(/[\\/]/).pop()!] ?? 'Autres';
  if (!byScreen.has(name)) byScreen.set(name, []);
  byScreen.get(name)!.push(row(key, ar));
  seen.add(key);
}
const shared = via.filter((k) => !seen.has(k) && ecrans.textes_provisoires[k] !== undefined && !(k in ecrans.textes))
  .map((k) => row(k, ecrans.textes_provisoires[k]!));
const server = [...serverMessageKeys().keys()].filter((k) => serveur.textes_provisoires[k] !== undefined && !(k in serveur.textes))
  .map((k) => row(k, serveur.textes_provisoires[k]!));
const fragments = Object.entries(serveur.fragments).map(([k, v]) => row(k, v));

const total = [...byScreen.values()].reduce((n, l) => n + l.length, 0) + shared.length + server.length + fragments.length;
const sections = [...byScreen.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

const md = `# CRM Moubarat en arabe — traductions à faire relire

*Document produit par \`pnpm --filter @moubarat/crm traductions:relire\` (ne pas modifier à la main : il est régénéré). ${total} textes.*

Toutes les traductions arabes du CRM ont été rédigées par Claude (choix d’Aymen du 15/11/2026) : **aucune n’a été relue par un
arabophone**. Elles sont affichées telles quelles aux postes réglés en arabe. Merci de les relire en pensant à un gérant ou un
réceptionniste algérien devant son écran : arabe standard simple, compris de tous, sans tournure littéraire.

**Comment corriger.** Écrire la bonne traduction dans la colonne « Correction » (laisser vide si c’est juste), puis renvoyer le
document. Les valeurs entre accolades (\`{n}\`, \`{date}\`, \`{1}\`…) sont remplacées à l’affichage par un nombre, une date, un
nom : elles doivent rester dans la traduction, telles quelles, placées où la phrase arabe le veut. Les chiffres restent 0-9.
Une traduction corrigée passe du bloc « textes_provisoires » au bloc « textes » de \`apps/crm/src/i18n/fr-ar.json\` (ou
\`fr-ar-serveur.json\` pour les messages du serveur) et disparaît de cette liste.

## 1. Choix de vocabulaire à trancher d’abord

Chacun revient dans de nombreux textes : une correction ici sera reportée partout.

| Français | Choix provisoire | Où | Correction |
|---|---|---|---|
${DOUTES.map(([fr, ar, ou]) => `| ${esc(fr)} | ${esc(ar)} | ${esc(ou)} | |`).join('\n')}

## 2. Textes des écrans

${sections.map((s) => `### ${s}\n\n${HEAD}\n${byScreen.get(s)!.join('\n')}\n`).join('\n')}
### Libellés partagés (menu, statuts, jours, sports, rôles…)

${HEAD}
${shared.join('\n')}

## 3. Messages d’erreur du serveur

Le serveur répond en français ; le CRM traduit à la réception. \`{1}\`, \`{2}\`… : valeur insérée (un nom de centre, un rôle,
un nombre). Les messages purement techniques gardent le nom du paramètre (\`fieldId\`, \`limit\`…) : un réceptionniste ne les
voit qu’en cas de bug.

${HEAD}
${server.join('\n')}

### Morceaux insérés dans ces messages (rôles, statuts…)

${HEAD}
${fragments.join('\n')}
`;

writeFileSync(OUT, md);
console.log(`${OUT} — ${total} textes`);
