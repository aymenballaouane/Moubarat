import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestStack, loginAs, bearer, type TestStack } from './helpers.js';
import { hashPassword, newSessionToken, sha256 } from '../src/lib/crypto.js';

/* Refonte app joueur, lot "Inscription et connexion" (règles 28, 29, 30, 36 — corrigées de
   "inchangée" à "nouvelle" le 24/10/2026, jamais codées avant ce lot). */

let stack: TestStack;
beforeEach(async () => { stack = await setupTestStack(); });
afterEach(async () => { await stack.teardown(); });

/** Compte déjà "passé par la passerelle" (pseudo + mot de passe posés), seedé DIRECTEMENT en
    base plutôt que via /auth/otp/request — un vrai 2e envoi au même numéro, juste après celui
    de la création, se heurterait au cooldown réel de 60 s (core, jamais contourné en test :
    "jamais figer l'horloge", docs/DECISIONS.md). */
async function seedAccessedPlayer(stack: TestStack, phone: string, pseudo: string, password: string): Promise<void> {
  await stack.db.insertInto('users').values({ phone, name: pseudo, password_hash: await hashPassword(password) }).execute();
}

/** Compte SANS mot de passe (pas encore passé par la passerelle), avec une session déjà
    ouverte — seedée DIRECTEMENT (jamais via /auth/otp/request, même raison que ci-dessus :
    un seul envoi OTP par numéro et par test, pour ne jamais se heurter au cooldown réel). */
async function seedUnaccessedPlayerSession(stack: TestStack, phone: string, pseudo: string): Promise<string> {
  const user = await stack.db.insertInto('users').values({ phone, name: pseudo }).returningAll().executeTakeFirstOrThrow();
  const token = newSessionToken();
  await stack.db.insertInto('sessions').values({ user_id: user.id, token_hash: sha256(token) }).execute();
  return token;
}

const ACCESS = { ageConfirmed: true, phoneVisible: true };

describe('POST /me/access-setup', () => {
  it('pose pseudo + mot de passe + accords, efface needsAccessSetup', async () => {
    const token = await loginAs(stack, '+213555000001', 'Walid');
    const me = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json();
    expect(me.needsAccessSetup).toBe(true);

    const res = await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(token),
      payload: { pseudo: 'walid_92', password: 'Moubarat1', firstName: 'Walid', lastName: 'B.', ...ACCESS, promoOptIn: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('walid_92');
    expect(res.json().needsAccessSetup).toBe(false);

    const me2 = (await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) })).json();
    expect(me2.needsAccessSetup).toBe(false);
  });

  it('refuse sans confirmation "18 ans ou plus"', async () => {
    const token = await loginAs(stack, '+213555000002', 'Karim');
    const res = await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(token),
      payload: { pseudo: 'karim92', password: 'Moubarat1', phoneVisible: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('AGE_CONFIRMATION_REQUIRED');
  });

  it('refuse sans l’accord "numéro visible"', async () => {
    const token = await loginAs(stack, '+213555000003', 'Sofiane');
    const res = await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(token),
      payload: { pseudo: 'sofiane92', password: 'Moubarat1', ageConfirmed: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PHONE_VISIBLE_REQUIRED');
  });

  it('refuse un mot de passe trop faible (règle 29)', async () => {
    const token = await loginAs(stack, '+213555000004', 'Nadia');
    const res = await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(token),
      payload: { pseudo: 'nadia92', password: 'faible', ...ACCESS },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PASSWORD_INVALID');
  });

  it('refuse un pseudo déjà pris (réutilise l’unicité de PATCH /me)', async () => {
    const t1 = await loginAs(stack, '+213555000005', 'Amine');
    await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(t1),
      payload: { pseudo: 'amine_pro', password: 'Moubarat1', ...ACCESS },
    });
    const t2 = await loginAs(stack, '+213555000006', 'Yacine');
    const res = await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(t2),
      payload: { pseudo: 'amine_pro', password: 'Moubarat1', ...ACCESS },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NAME_TAKEN');
  });
});

describe('POST /auth/login — pseudo ou numéro + mot de passe (règle 28)', () => {
  async function setup(phone: string, pseudo: string): Promise<void> {
    const token = await loginAs(stack, phone, 'Joueur');
    await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(token),
      payload: { pseudo, password: 'Moubarat1', ...ACCESS },
    });
  }

  it('connexion par numéro', async () => {
    await setup('+213555000010', 'hamid_10');
    const res = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '0555000010', password: 'Moubarat1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('connexion par pseudo, insensible à la casse/aux espaces de l’identifiant saisi', async () => {
    await setup('+213555000011', 'hamid_11');
    const res = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '  HAMID_11  ', password: 'Moubarat1' } });
    expect(res.statusCode).toBe(200);
  });

  it('identifiant inconnu et mauvais mot de passe rendent le MÊME message (anti-oracle)', async () => {
    await setup('+213555000012', 'hamid_12');
    const unknown = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'personne_ici', password: 'Moubarat1' } });
    const wrong = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'hamid_12', password: 'MauvaisMdp1' } });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error).toBe('LOGIN_INVALID');
    expect(wrong.json().error).toBe('LOGIN_INVALID');
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  /* Décision d'Aymen (27/10/2026) : plus de verrou de 15 min — un RALENTISSEMENT progressif par (identifiant tapé, adresse). Un inconnu qui connaît un pseudo
     public ne peut donc plus empêcher le vrai joueur de se connecter. */
  const login = (identifier: string, password: string, remoteAddress?: string) => stack.app.inject({
    method: 'POST', url: '/auth/login', payload: { identifier, password }, ...(remoteAddress ? { remoteAddress } : {}),
  });

  it('ralentissement progressif : 2 fautes gratuites, puis le délai double (2 s, 4 s, 8 s…) ; même le bon mot de passe attend', async () => {
    await setup('+213555000013', 'hamid_13');
    for (let i = 0; i < 2; i++) expect((await login('hamid_13', 'MauvaisMdp1')).statusCode).toBe(401);          // fautes de frappe : aucune pénalité
    expect((await login('hamid_13', 'MauvaisMdp1')).statusCode).toBe(401);                                       // 3e échec → 2 s
    const slow = await login('hamid_13', 'Moubarat1');
    expect(slow.statusCode).toBe(429);
    expect(slow.json().error).toBe('LOGIN_SLOWDOWN');
    expect(slow.json().details?.retryAfterSec ?? slow.json().retryAfterSec).toBeLessThanOrEqual(2);
    // On « laisse passer le délai » (recule l'échéance) : la tentative suivante est jugée ; une 4e faute double le délai.
    const rewind = () => stack.db.updateTable('login_throttle').set({ next_allowed_at: new Date(Date.now() - 1000) }).execute();
    const delays: number[] = [];
    for (let n = 4; n <= 7; n++) {
      await rewind();
      expect((await login('hamid_13', 'MauvaisMdp1')).statusCode).toBe(401);
      const row = (await stack.db.selectFrom('login_throttle').selectAll().execute())[0]!;
      expect(row.failures).toBe(n);
      delays.push(Math.round((row.next_allowed_at.getTime() - Date.now()) / 1000));
    }
    expect(delays[0]).toBeGreaterThanOrEqual(3); expect(delays[0]).toBeLessThanOrEqual(4);       // 4 s
    expect(delays[1]).toBeGreaterThanOrEqual(7); expect(delays[1]).toBeLessThanOrEqual(8);       // 8 s
    expect(delays[2]).toBeGreaterThanOrEqual(15); expect(delays[2]).toBeLessThanOrEqual(16);     // 16 s
    expect(delays[3]).toBeGreaterThanOrEqual(31); expect(delays[3]).toBeLessThanOrEqual(32);     // 32 s
    // Une fois le délai écoulé, le bon mot de passe passe et le compteur repart de zéro.
    await rewind();
    expect((await login('hamid_13', 'Moubarat1')).statusCode).toBe(200);
    expect(await stack.db.selectFrom('login_throttle').selectAll().execute()).toEqual([]);
  });

  it('un inconnu qui s’acharne sur un pseudo public ne bloque PAS le vrai joueur (autre adresse) ; ni les autres pseudos de son adresse', async () => {
    await setup('+213555000016', 'hamid_16');
    await setup('+213555000017', 'hamid_17');
    for (let i = 0; i < 8; i++) await login('hamid_16', 'MauvaisMdp1', '10.9.9.9');                           // l'attaquant, depuis SON adresse
    expect((await login('hamid_16', 'Moubarat1', '10.9.9.9')).statusCode).toBe(429);                        // lui est ralenti
    const real = await login('hamid_16', 'Moubarat1', '10.1.1.1');                                           // le vrai joueur, ailleurs : aucune attente
    expect(real.statusCode, real.body).toBe(200);
    expect((await login('hamid_17', 'Moubarat1', '10.9.9.9')).statusCode).toBe(200);                         // un autre pseudo, même adresse : libre
  });

  it('aucun oracle : un identifiant INCONNU est ralenti exactement comme un identifiant réel (même clé = ce qui est tapé)', async () => {
    for (let i = 0; i < 3; i++) await login('personne_ici_99', 'MauvaisMdp1');
    const slow = await login('personne_ici_99', 'MauvaisMdp1');
    expect(slow.statusCode).toBe(429);
    expect(slow.json().error).toBe('LOGIN_SLOWDOWN');
    // « PERSONNE_ici_99 » (casse) = même identifiant pour le ralentissement.
    expect((await login('PERSONNE_ici_99', 'MauvaisMdp1')).statusCode).toBe(429);
  });

  it('un mot de passe oublié réinitialisé par SMS lève le ralentissement du compte', async () => {
    await seedAccessedPlayer(stack, '+213555000018', 'reda_18', 'Moubarat1');
    for (let i = 0; i < 4; i++) await login('reda_18', 'MauvaisMdp1');
    expect((await login('reda_18', 'Moubarat1')).statusCode).toBe(429);
    await stack.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone: '0555000018' } });
    const code = stack.sms.codeFor('+213555000018');
    expect((await stack.app.inject({ method: 'POST', url: '/auth/password/reset', payload: { phone: '0555000018', code, newPassword: 'Nouveau2' } })).statusCode).toBe(200);
    expect((await login('reda_18', 'Nouveau2')).statusCode).toBe(200);
  });

  it('compte suspendu : révélé seulement après un mot de passe juste', async () => {
    await setup('+213555000014', 'hamid_14');
    await stack.db.updateTable('users').set({ status: 'SUSPENDED' }).where('phone', '=', '+213555000014').execute();
    const wrongPw = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'hamid_14', password: 'MauvaisMdp1' } });
    expect(wrongPw.json().error).toBe('LOGIN_INVALID');
    const rightPw = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'hamid_14', password: 'Moubarat1' } });
    expect(rightPw.statusCode).toBe(403);
    expect(rightPw.json().error).toBe('ACCOUNT_SUSPENDED');
  });

  it('un compte qui n’a pas encore de mot de passe (needsAccessSetup) ne peut pas se connecter par mot de passe', async () => {
    await loginAs(stack, '+213555000015', 'Pas encore passé');
    const res = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '0555000015', password: 'Moubarat1' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('Règle 28 (corrections d’Aymen, 24/10/2026) — un compte qui a déjà un mot de passe ne reçoit plus AUCUN SMS de connexion', () => {
  it('/auth/otp/request refuse AVANT d’envoyer le SMS — aucun code capturé', async () => {
    await seedAccessedPlayer(stack, '+213555000030', 'nassim_30', 'Moubarat1');

    const otpReq = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '0555000030' } });
    expect(otpReq.statusCode).toBe(403);
    expect(otpReq.json().error).toBe('PASSWORD_LOGIN_REQUIRED');
    // Le cœur du correctif : pas seulement "la session est refusée" — le SMS n'est jamais parti.
    expect(stack.sms.codeFor('+213555000030')).toBeUndefined();
  });

  it('le SMS continue de partir pour /auth/password/forgot, même pour ce compte', async () => {
    await seedAccessedPlayer(stack, '+213555000032', 'nassim_32', 'Moubarat1');
    const forgot = await stack.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone: '0555000032' } });
    expect(forgot.statusCode).toBe(200);
    expect(stack.sms.codeFor('+213555000032')).toBeTruthy();
  });

  it('/auth/otp/verify reste une 2e barrière si un code valide existait déjà avant que le mot de passe soit posé (course)', async () => {
    // Code demandé pendant que le compte n'avait PAS encore de mot de passe (passerelle d'accès).
    const token = await seedUnaccessedPlayerSession(stack, '+213555000030', 'Nassim');
    const otpReq = await stack.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '0555000030' } });
    expect(otpReq.statusCode).toBe(200);
    const code = stack.sms.codeFor('+213555000030');
    expect(code).toBeTruthy();

    // Le mot de passe est posé ENTRE-TEMPS (un autre onglet, par exemple).
    await stack.app.inject({
      method: 'POST', url: '/me/access-setup', headers: bearer(token),
      payload: { pseudo: 'nassim_30', password: 'Moubarat1', ...ACCESS },
    });

    const verify = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: '0555000030', code } });
    expect(verify.statusCode).toBe(403);
    expect(verify.json().error).toBe('PASSWORD_LOGIN_REQUIRED');
    expect(verify.json().token).toBeUndefined();

    // Le code était pourtant juste : il reste consommé (usage unique), un rejeu échoue en OTP_ALREADY_USED.
    const replay = await stack.app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: '0555000030', code } });
    expect(replay.json().error).toBe('OTP_ALREADY_USED');
  });

  it('/auth/otp/verify continue d’ouvrir une session pour un compte SANS mot de passe (pas encore passé par access-setup)', async () => {
    const token = await loginAs(stack, '+213555000031', 'Pas encore passé');
    expect(token).toBeTruthy();
  });
});

describe('Mot de passe oublié par SMS (règle 28)', () => {
  it('réinitialise le mot de passe et révoque les autres sessions', async () => {
    await seedAccessedPlayer(stack, '+213555000020', 'reda_20', 'Moubarat1');
    const login = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'reda_20', password: 'Moubarat1' } });
    const token = login.json().token as string;
    const oldSessionStillWorks = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(oldSessionStillWorks.statusCode).toBe(200);

    const forgot = await stack.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone: '0555000020' } });
    expect(forgot.statusCode).toBe(200);
    const code = stack.sms.codeFor('+213555000020');
    expect(code).toBeTruthy();

    const reset = await stack.app.inject({
      method: 'POST', url: '/auth/password/reset',
      payload: { phone: '0555000020', code, newPassword: 'Nouveau2' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().token).toBeTruthy();

    // L'ancienne session (avant réinitialisation) est révoquée.
    const revoked = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(revoked.statusCode).toBe(401);

    // L'ancien mot de passe ne fonctionne plus, le nouveau oui.
    const oldPw = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'reda_20', password: 'Moubarat1' } });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: 'reda_20', password: 'Nouveau2' } });
    expect(newPw.statusCode).toBe(200);
  });

  it('audit 26/10 (P1-5) : sur un compte qui n’a pas fini la passerelle, le mot de passe n’est PAS posé — needsAccessSetup reste vrai', async () => {
    await stack.db.insertInto('users').values({ phone: '+213555000022', name: 'ancien_22' }).execute();
    await stack.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone: '0555000022' } });
    const code = stack.sms.codeFor('+213555000022');
    const reset = await stack.app.inject({ method: 'POST', url: '/auth/password/reset', payload: { phone: '0555000022', code, newPassword: 'Nouveau2' } });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json().needsAccessSetup).toBe(true);
    const me = await stack.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(reset.json().token) });
    expect(me.json().needsAccessSetup).toBe(true);                // la passerelle (18 ans, numéro visible, mot de passe) s'affichera
    const row = await stack.db.selectFrom('users').select('password_hash').where('phone', '=', '+213555000022').executeTakeFirstOrThrow();
    expect(row.password_hash).toBeNull();
    const login = await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: '0555000022', password: 'Nouveau2' } });
    expect(login.statusCode).toBe(401);                            // le mot de passe tapé n'a jamais été enregistré
  });

  it('refuse un nouveau mot de passe trop faible', async () => {
    await stack.app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { phone: '0555000021' } });
    const code = stack.sms.codeFor('+213555000021');
    const res = await stack.app.inject({
      method: 'POST', url: '/auth/password/reset', payload: { phone: '0555000021', code, newPassword: 'faible' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PASSWORD_INVALID');
  });
});
