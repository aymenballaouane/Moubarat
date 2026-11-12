import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import type { AppStore } from '../state/useAppStore.js';
import type { Match, MatchPlayer } from '@moubarat/core';

/* Audit final, MS-038 (12/11/2026) — ouvrir un match par son identifiant (notification, lien, carte) quand il n'est pas
   encore en mémoire affichait le PREMIER match ouvert à la place (`?? store.openMatches()[0]!`) — on pouvait rejoindre le
   mauvais match —, ou plantait s'il n'y en avait aucun. Ici : le match est chargé par son identifiant ; en attendant, un
   état « chargement » ; s'il n'existe pas (ou plus), un état « introuvable ». Jamais un autre match. */

type Entry = { match: Match; players: MatchPlayer[] };

export function MatchRoute({ matchId, store, onExit, children }: {
  matchId: string | undefined;
  store: AppStore;
  onExit: () => void;
  children: (entry: Entry) => ReactNode;
}) {
  const t = useT();
  const entry = matchId ? store.findMatch(matchId) : undefined;
  const [missing, setMissing] = useState(matchId === undefined);

  useEffect(() => {
    if (!matchId || entry) return;
    let cancelled = false;
    setMissing(false);
    void store.loadMatchDetail(matchId).then((res) => { if (!cancelled && !res.ok) setMissing(true); });
    return () => { cancelled = true; };
    // `entry` n'est pas une dépendance : une fois le match chargé, le rendu suivant le trouve et n'appelle plus l'effet utilement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  if (entry) return <>{children(entry)}</>;
  return (
    <section className="au-screen pf pf-sub" id="s-match-route">
      <div className="pf-sub__top"><button type="button" className="pf-back mb-tap" aria-label={t('Retour')} onClick={onExit}><Icon id="i-back" /></button></div>
      {missing ? (
        <div className="mb-note" role="alert">
          <div className="mb-note__mark"><Icon id="i-search" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">{t('Ce match est introuvable')}</h4>
          <p className="mb-note__text">{t('Il a peut-être été retiré, ou le lien n’est plus valable.')}</p>
        </div>
      ) : (
        <p className="mb-note__text" role="status" aria-live="polite">{t('Chargement du match…')}</p>
      )}
    </section>
  );
}
