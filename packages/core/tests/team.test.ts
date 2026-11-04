import { describe, expect, it } from 'vitest';
import {
  createTeam, invitePlayer, respondInvite, leaveTeam, removeMember, transferCaptaincy,
  activeMembers, captainOf, canSendChallenge, MAX_TEAM_SIZE,
  type TeamMember,
} from '../src/index.js';

const NOW = Date.parse('2026-08-22T12:00:00Z');
const H = 3_600_000;

function crew(): TeamMember[] {
  const { captainEntry } = createTeam('A', 'FC Kahwa', 'aymen', NOW) as { captainEntry: TeamMember };
  return [captainEntry,
    { teamId: 'A', userId: 'karim', role: 'PLAYER', status: 'ACTIVE', joinedAt: NOW },
    { teamId: 'A', userId: 'walid', role: 'PLAYER', status: 'INVITED' },
  ];
}

describe('création & invitations', () => {
  it('le créateur est capitaine actif ; nom borné', () => {
    const r = createTeam('A', '  FC Kahwa ', 'aymen', NOW);
    expect(r.result.ok).toBe(true);
    expect(r.team!.name).toBe('FC Kahwa');
    expect(r.captainEntry!.role).toBe('CAPTAIN');
    expect(createTeam('B', 'ab', 'x', NOW).result.ok).toBe(false);
  });
  it('seul le capitaine invite ; pas deux fois la même personne ; effectif borné', () => {
    const m = crew();
    expect(invitePlayer(m, 'A', 'karim', 'nassim').result.ok).toBe(false);
    expect(invitePlayer(m, 'A', 'aymen', 'karim').result.ok).toBe(false);
    expect(invitePlayer(m, 'A', 'aymen', 'walid').result.ok).toBe(false);   // déjà invité
    const ok = invitePlayer(m, 'A', 'aymen', 'nassim');
    expect(ok.result.ok).toBe(true);
    expect(ok.invite!.status).toBe('INVITED');
    const big = [m[0]!, ...Array.from({ length: MAX_TEAM_SIZE - 1 }, (_, i) =>
      ({ teamId: 'A', userId: `p${i}`, role: 'PLAYER' as const, status: 'ACTIVE' as const, joinedAt: NOW }))];
    const full = invitePlayer(big, 'A', 'aymen', 'trop');
    expect(!full.result.ok && full.result.code).toBe('TEAM_FULL');
  });
  it('l’invité accepte (actif, daté) ou refuse (invitation effacée)', () => {
    const m = crew();
    const acc = respondInvite(m, 'A', 'walid', true, NOW + H);
    expect(acc.result.ok).toBe(true);
    const w = acc.members!.find((x) => x.userId === 'walid')!;
    expect(w.status).toBe('ACTIVE');
    expect(w.joinedAt).toBe(NOW + H);
    const dec = respondInvite(m, 'A', 'walid', false, NOW + H);
    expect(dec.members!.some((x) => x.userId === 'walid')).toBe(false);
    expect(respondInvite(m, 'A', 'karim', true, NOW).result.ok).toBe(false); // pas invité
  });
});

describe('vestiaire : partir, retirer, transmettre', () => {
  it('un joueur part ; le capitaine, jamais sans transmettre', () => {
    const m = crew();
    expect(leaveTeam(m, 'A', 'karim').result.ok).toBe(true);
    const cap = leaveTeam(m, 'A', 'aymen');
    expect(!cap.result.ok && cap.result.code).toBe('LAST_CAPTAIN');
  });
  it('le capitaine retire un joueur ou annule une invitation — jamais lui-même', () => {
    const m = crew();
    const r = removeMember(m, 'A', 'aymen', 'karim');
    expect(r.members!.find((x) => x.userId === 'karim')!.status).toBe('LEFT');
    const inv = removeMember(m, 'A', 'aymen', 'walid');
    expect(inv.members!.some((x) => x.userId === 'walid')).toBe(false);
    expect(removeMember(m, 'A', 'aymen', 'aymen').result.ok).toBe(false);
    expect(removeMember(m, 'A', 'karim', 'aymen').result.ok).toBe(false);
  });
  it('le brassard se transmet à un membre actif, et l’invariant tient', () => {
    const m = crew();
    expect(transferCaptaincy(m, 'A', 'aymen', 'walid').result.ok).toBe(false); // invité ≠ actif
    const t = transferCaptaincy(m, 'A', 'aymen', 'karim');
    expect(t.result.ok).toBe(true);
    const caps = activeMembers(t.members!, 'A').filter((x) => x.role === 'CAPTAIN');
    expect(caps.length).toBe(1);
    expect(captainOf(t.members!, 'A')!.userId).toBe('karim');
    // l'ex-capitaine peut maintenant partir
    expect(leaveTeam(t.members!, 'A', 'aymen').result.ok).toBe(true);
  });
  it('après transfert, c’est le NOUVEAU capitaine qui peut défier (pont Phase 8)', () => {
    const m = crew();
    const t = transferCaptaincy(m, 'A', 'aymen', 'karim').members!;
    const c = { fromTeamId: 'A', toTeamId: 'B' };
    expect(canSendChallenge(c, 'karim', t).ok).toBe(true);
    expect(canSendChallenge(c, 'aymen', t).ok).toBe(false);
  });
});
