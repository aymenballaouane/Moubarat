/* CRM en arabe — lot D (P1-15, 16/11/2026) : relevé des messages d'erreur que le serveur peut renvoyer AU CRM. Le serveur
   répond en français ; le CRM traduit à la réception (src/lib/serverMessages.ts, src/i18n/fr-ar-serveur.json). Ce relevé lit
   les sources de l'API et du core (les fichiers des routes que le CRM appelle) : un nouveau message côté serveur sans
   traduction fait échouer le test (tests/server-messages.test.ts) — sans test, il s'afficherait en français à un poste arabe.

   Clé d'un message à valeur (gabarit `` `… ${x} …` ``) : chaque `${…}` devient `{1}`, `{2}`… dans l'ordre (même règle que
   `templateKey` côté CRM). Les fichiers des seuls parcours joueur (inscription OTP, profil, équipes, défis, matchs côté
   joueur…) ne sont pas relevés : le CRM ne les appelle pas. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Les fichiers serveur dont les messages peuvent arriver au CRM (connexion du personnel, écrans du CRM, formulaire public). */
export const SERVER_FILES = [
  'apps/api/src/server.ts',
  'apps/api/src/auth/platform-guards.ts',
  'apps/api/src/lib/cursor.ts',
  'apps/api/src/lib/login-throttle.ts',
  'apps/api/src/lib/validate.ts',
  'apps/api/src/platform/auth/routes.ts',
  'apps/api/src/platform/staff/routes.ts',
  'apps/api/src/public/venue-requests.ts',
  'apps/api/src/modules/absences/routes.ts',
  'apps/api/src/modules/analytics/service.ts',
  'apps/api/src/modules/availability/routes.ts',
  'apps/api/src/modules/bookings/reschedule.ts',
  'apps/api/src/modules/bookings/routes.ts',
  'apps/api/src/modules/bookings/service.ts',
  'apps/api/src/modules/cash/routes.ts',
  'apps/api/src/modules/cash/service.ts',
  'apps/api/src/modules/clients/routes.ts',
  'apps/api/src/modules/closures/routes.ts',
  'apps/api/src/modules/closures/service.ts',
  'apps/api/src/modules/legal/routes.ts',
  'apps/api/src/modules/promos/routes.ts',
  'apps/api/src/modules/promos/service.ts',
  'apps/api/src/modules/recurring-bookings/routes.ts',
  'apps/api/src/modules/recurring-bookings/service.ts',
  'apps/api/src/modules/recurring-bookings/sessions.ts',
  'apps/api/src/modules/staff/routes.ts',
  'apps/api/src/modules/staff/service.ts',
  'apps/api/src/modules/venues/routes.ts',
  'packages/core/src/permissions.ts',
  'packages/core/src/rules/absence.ts',
  'packages/core/src/rules/availability.ts',
  'packages/core/src/rules/booking-flow.ts',
  'packages/core/src/rules/booking.ts',
  'packages/core/src/rules/claim.ts',
  'packages/core/src/rules/crm.ts',
  'packages/core/src/rules/ops.ts',
  'packages/core/src/rules/platform-auth.ts',
  'packages/core/src/rules/platform.ts',
];

const LIT = String.raw`('(?:[^'\\]|\\.)*'|\`(?:[^\`\\]|\\.)*\`|"(?:[^"\\]|\\.)*")`;
const PATTERNS = [
  new RegExp(String.raw`new ApiError\(\s*[^,]+,\s*[^,]+,\s*` + LIT, 'g'),
  new RegExp(String.raw`\b(?:notFound|badRequest|unauthorized|forbidden|conflict|tooMany)\(\s*` + LIT, 'g'),
  new RegExp(String.raw`message:\s*` + LIT, 'g'),
  new RegExp(String.raw`\bfail\(\s*[^,]+,\s*` + LIT, 'g'),
  new RegExp(String.raw`\bdeny\(\s*[^,]+,\s*` + LIT, 'g'),
];

/** `${a} et ${b ? 'x' : 'y'}` → `{1} et {2}` (accolades imbriquées comprises). */
export function templateKeyOf(body: string): string {
  let out = '';
  let n = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
        j++;
      }
      out += `{${++n}}`;
      i = j - 1;
    } else out += body[i];
  }
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\(['"`\\])/g, '$1');
}

/** Toutes les clés (message exact, ou gabarit `{1}`…) des fichiers serveur relevés, avec le fichier d'origine. */
export function serverMessageKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of SERVER_FILES) {
    const src = readFileSync(join(REPO, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const lit = m[1]!;
        const body = unescape(lit.slice(1, -1));
        if (!/[a-zéèàù]{3}/i.test(body)) continue;
        const key = lit[0] === '`' ? templateKeyOf(body) : body;
        if (!out.has(key)) out.set(key, rel);
      }
    }
  }
  return out;
}
