import { Icon } from './Icon.js';
import { PEOPLE } from '../data/people.js';
import { CURRENT_USER_ID, VIEWER_ID } from '../data/identity.js';

/* Rangee joueur partagee (Match Detail, Mon match, et a terme Teams/
   Challenges) — promue depuis MatchFlow.tsx ou elle etait deja un vrai
   composant, pendant que Teams et Challenges reimplementaient la meme
   rangee en ligne (finding §11.10 du spec Premium : "genuinely fragmented
   today"). Une seule implementation, props optionnelles pour l'action de
   fin de rangee. Le prefixe « Organisateur · » est un fait PAR MATCH
   (organizerId), jamais un attribut de la personne dans l'annuaire. */

/** `knownName` (Lot 3B, étape 3 point 5) : nom réel résolu via GET
    /matches/:id (roster nominatif, store.knownPlayerName) — vérifié EN
    PREMIER, avant l'annuaire mock PEOPLE, pour qu'un vrai coéquipier
    l'emporte toujours sur une coïncidence d'id avec le jeu de démo. */
export function playerDisplay(userId: string, knownName?: string): { name: string; role: string; ovr: string } {
  if (userId === VIEWER_ID) return { name: 'Toi', role: 'Nouveau joueur', ovr: '—' };
  if (userId === CURRENT_USER_ID) return { name: 'Toi', role: 'Joueur', ovr: '—' };
  if (knownName) return { name: knownName, role: 'Joueur', ovr: '—' };
  const p = PEOPLE[userId];
  if (p) return { name: p.name, role: p.position, ovr: p.ovr };
  /* Lot 3B (lectures) : un vrai coéquipier absent de l'annuaire local PEOPLE
     (mock, Teams/Défis) ET pas encore résolu via le roster nominatif n'est
     JAMAIS "Toi" — l'ancien repli inconditionnel supposait un monde à deux
     personnes (l'annuaire ou VIEWER_ID) qui n'a jamais été vrai dès qu'un
     vrai autre joueur existe. Repli honnête plutôt qu'une identité inventée. */
  return { name: 'Joueur', role: 'Inscrit', ovr: '—' };
}

interface PlayerRowProps {
  userId: string;
  organizerId?: string | undefined;
  onKick?: (() => void) | undefined;
  knownName?: string | undefined;
}

export function PlayerRow({ userId, organizerId, onKick, knownName }: PlayerRowProps) {
  const d = playerDisplay(userId, knownName);
  const role = organizerId && userId === organizerId ? `Organisateur · ${d.role}` : d.role;
  const initial = d.name === 'Toi' ? 'T' : d.name[0];
  return (
    <div className="mt-player">
      <span className="mt-ava">{initial}</span>
      <span className="n"><b>{d.name}</b><span>{role}</span></span>
      <span className={`mb-ovr${d.ovr === '—' ? ' mb-ovr--provisional' : ''}`}>
        <b className="mb-ovr__n">{d.ovr}</b><i className="mb-ovr__l">OVR</i>
      </span>
      {onKick ? <button type="button" className="mt-kick mb-tap" aria-label={`Retirer ${d.name}`} onClick={onKick}><Icon id="i-x" className="mb-ic--sm" /></button> : null}
    </div>
  );
}
