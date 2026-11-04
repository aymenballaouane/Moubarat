/* Lot 3C — abstraction minimale d'envoi SMS. Objectif unique : que le code
   OTP en clair ne quitte JAMAIS la couche serveur vers le client HTTP,
   quel que soit l'environnement — remplace l'ancien `devDode` renvoyé dans
   la réponse de `POST /auth/otp/request` (faille réelle : n'importe qui
   pouvait s'authentifier comme n'importe quel numéro sans jamais recevoir
   de SMS). Avant ce correctif, en dehors du mode dev, le code était même
   calculé puis silencieusement jeté après hachage — jamais remis à un
   mécanisme de livraison, donc aucun utilisateur réel n'aurait jamais pu
   se connecter du tout.

   `SmsProvider` est l'unique point d'extension. `phone` porte les DEUX
   formats déjà calculés une seule fois par `normalizeAlgerianMobile` (core,
   gelé) à la demande d'OTP (auth/routes.ts) — jamais redérivés ici : un
   fournisseur qui a besoin du format local (smssak) le lit directement,
   aucune conversion dupliquée. */

export interface SmsProvider {
  send(phone: { e164: string; national: string }, code: string): Promise<void>;
}

/** Dev local uniquement : le code part dans les LOGS SERVEUR (jamais dans
    une réponse HTTP) — un développeur le lit dans le terminal `pnpm
    dev:api`, jamais dans les DevTools du navigateur ni dans la réponse
    réseau. Sélectionnée uniquement quand `env.otpDevMode` est explicitement
    `true` (fail-closed par défaut, voir env.ts) — prioritaire sur tout
    fournisseur réel configuré, pour ne jamais brûler un vrai SMS pendant
    le développement local. */
export class ConsoleSmsProvider implements SmsProvider {
  constructor(private readonly log: { info: (obj: unknown, msg: string) => void }) {}
  async send(phone: { e164: string; national: string }, code: string): Promise<void> {
    this.log.info({ phone: phone.e164, code }, '[OTP DEV — jamais en pilote/prod] code envoyé (console uniquement)');
  }
}

/** Aucun fournisseur SMS configuré, ou repli si `SMS_PROVIDER=smssak` est
    demandé mais mal configuré (clé/projet/template manquants — ex. le
    template smssak attend encore une validation, voir docs/DECISIONS.md) :
    le code n'est PAS délivré, mais ceci reste invisible pour l'appelant
    HTTP (le contrat `{ok:true}` ne change jamais selon qu'un numéro existe
    ou non — ne jamais transformer une absence de SMS en oracle
    d'énumération de comptes). Un avertissement explicite part dans les
    logs serveur pour que l'équipe voie immédiatement qu'un vrai
    utilisateur n'a rien reçu — jamais un échec silencieux invisible de
    tous côtés. */
export class NullSmsProvider implements SmsProvider {
  constructor(private readonly log: { warn: (obj: unknown, msg: string) => void }) {}
  async send(phone: { e164: string; national: string }, _code: string): Promise<void> {
    this.log.warn({ phone: phone.e164 }, 'Aucun fournisseur SMS configuré — code OTP non délivré à cet utilisateur');
  }
}

/** smssak (https://smssak.com), fournisseur réel choisi pour le pilote —
    Lot 3C, décision d'Aymen le 31/08/2026. UNIQUEMENT leur API "Phone
    Notifications" (envoi par template, endpoint ci-dessous) — JAMAIS leur
    "Phone Authentication" (sendOtp/verifyOtp), qui dupliquerait la logique
    OTP déjà construite et testée dans packages/core (expiration 5 min,
    5 essais max, cooldown 60 s, quota 3/15 min, non-réutilisation). smssak
    ne sert QUE de canal de livraison du SMS — notre code reste seul
    responsable de générer/vérifier le code, exactement comme les autres
    SmsProvider ci-dessus.

    Un appel qui échoue (réseau ou réponse non-ok) JETTE toujours — jamais
    un succès silencieux (`POST /auth/otp/request` doit alors répondre une
    vraie erreur au client, voir auth/routes.ts). La clé API ne doit JAMAIS
    apparaître dans un log : seules l'adresse e164 (déjà loggée ailleurs
    dans l'app) et la réponse du fournisseur (jamais le corps de la
    requête sortante, qui contient la clé dans ses en-têtes) sont tracées. */
export const SMSSAK_ENDPOINT = 'https://sendmessagewithtemplate-47lvvvrp4a-uc.a.run.app';

export interface SmssakConfig {
  apiKey: string;
  projectId: string;
  templateId: string;
}

export class SmssakSmsProvider implements SmsProvider {
  constructor(
    private readonly config: SmssakConfig,
    private readonly log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void },
    /** Injectable pour les tests (jamais un vrai appel réseau dans la suite
        automatisée) — `fetch` global de Node par défaut. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phone: { e164: string; national: string }, code: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(SMSSAK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', key: this.config.apiKey },
        body: JSON.stringify({
          projectId: this.config.projectId,
          templateId: this.config.templateId,
          country: 'DZ',
          phone: phone.national,
          fields: { code },
        }),
      });
    } catch (e) {
      this.log.error(
        { phone: phone.e164, err: e instanceof Error ? e.message : String(e) },
        'smssak : envoi SMS impossible (réseau)',
      );
      throw new Error('Envoi du SMS impossible pour le moment. Réessayez.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error({ phone: phone.e164, status: res.status, body }, 'smssak : envoi SMS refusé par le fournisseur');
      throw new Error('Envoi du SMS impossible pour le moment. Réessayez.');
    }
    this.log.info({ phone: phone.e164 }, 'smssak : SMS envoyé');
  }
}
