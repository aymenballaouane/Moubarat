import { useEffect, useState } from 'react';
import { activeMembers, captainOf, type Sport, GENERIC_ERROR_MESSAGE } from '@moubarat/core';
import { Icon } from './Icon.js';
import { ExplorerMatchCard } from './ExplorerMatchCard.js';
import { LoadMoreButton } from './LoadMoreButton.js';
import type { SegTab } from './SegmentedTabs.js';
import { teamInitials, epochDayLabel, epochDateStamp } from '../lib/format.js';
import type { CityFilter, FeedParams } from '../lib/feedQuery.js';
import { sportLabel } from '../lib/labels.js';
import { CURRENT_USER_ID } from '../data/identity.js';
import { sportIcon } from '../lib/venueView.js';
import { NO_VENUE_FILTERS, fold, type VenueFilters } from '../lib/venueFilters.js';
import { VenuesPanel } from './VenuesPanel.js';
import { ExplorerFilters } from './ExplorerFilters.js';
import { ExplorerSearch } from './ExplorerSearch.js';
import { DayAlertButton } from './DayAlertButton.js';
import { useT } from '../lib/i18n.js';
import { CALENDAR_HORIZON_DAYS, WEEKDAY_KEYS } from '../lib/calendar.js';
import { applyWhen, matchFilterCount, sportChipLabel, whenOf, type WhenFilter } from '../lib/explorerFilters.js';
import { TEAMS_CHALLENGES_ENABLED } from '../lib/featureFlags.js';
import { MY_TEAM, MY_TEAM_MATCHES_PLAYED, INITIAL_MEMBERS, memberDisplayName } from '../data/teamsDemo.js';
import { OPPONENT_TEAMS } from '../data/challengesDemo.js';
import type { ExplorerTabName, Route } from '../nav.js';
import type { AppStore } from '../state/useAppStore.js';
import '../styles/explorer.css';
import '../styles/explorer-v2.css';

/* Explorer — reproduction fidele du prototype v6 (retour direct d'Aymen,
   29/08/2026 : premiere passe trop eloignee du prototype visuel). Onglets
   avec icones, rail jour chronologique EN PREMIER sous les onglets (jamais
   une barre de recherche a cette place — « on n'est pas un moteur de
   recherche »), filtres rapides Tous/Aujourd'hui/Ce soir/Week-end (patron
   .filter-pills du prototype, remplace les chips de niveau qui n'existent
   pas a cet endroit dans le prototype). Recherche textuelle deplacee
   derriere l'icone loupe de l'entete (reste reelle, jamais un bouton mort
   comme dans le prototype source) — sauf onglet Equipes qui garde sa barre
   de recherche permanente, fidele au prototype (`.searchbar` de
   panel-equipes). Carte match reconstruite en variant="around" de
   MatchCard (photo 100px, heure+niveau superposes, bouton Rejoindre) —
   patron `.around-card` exact, jamais une carte concurrente inventee. */

type ExplorerTab = 'matchs' | 'terrains' | 'equipes';
type QuickFilter = FeedParams['quick'];

/* Onglet Equipes retire de la liste (scope gate MVP, 29/08/2026) — le
   panneau lui-meme (plus bas, tab === 'equipes') et son etat restent en
   place, juste inatteignables sans ce bouton. */
const TABS: SegTab<ExplorerTab>[] = [
  { value: 'matchs', label: 'Matchs', icon: 'i-users' },
  { value: 'terrains', label: 'Terrains', icon: 'i-grass' },
  ...(TEAMS_CHALLENGES_ENABLED ? [{ value: 'equipes' as const, label: 'Équipes', icon: 'i-shield' }] : []),
];


/* Sports proposés : calculés d'après le catalogue entier (A7/A8), jamais une liste figée. */
const SPORT_ORDER: Sport[] = ['FOOTBALL', 'PADEL', 'BASKET'];
function sportTabsFor(venues: AppStore['venues']): SegTab<Sport>[] {
  const offered = new Set(venues.flatMap((v) => v.sports));
  return SPORT_ORDER.filter((s) => offered.has(s)).map((s) => ({ value: s, label: sportLabel(s), icon: sportIcon(s) }));
}

/* Rail chronologique — sept jours réels (Aujourd'hui + 6, maquette Explorer.dc.html) ; le calendrier « Choisis un jour » couvre le reste.
   Un jour sans match d'après les décomptes réels est estompé, jamais un chiffre inventé. */
const DAY_RAIL_LENGTH = 7;
function dayRailStarts(): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: DAY_RAIL_LENGTH }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.getTime();
  });
}
/** Règle 33 : Explorer › Terrains s'ouvre sur les centres de la ville du joueur (la maquette de la page « Filtres » ouvre sur sa ville) ;
    « Autre » ou une ville inconnue = pas de ville imposée. « Tout effacer » revient à cet état de départ. */
function defaultVenueCity(city: string | null): CityFilter | null {
  return city !== null && ['ALGER', 'ORAN', 'CONSTANTINE', 'ANNABA', 'BLIDA', 'SETIF'].includes(city) ? (city as CityFilter) : null;
}

interface BrowsableTeam { id: string; name: string; captainName: string; playerCount: number; mine: boolean; matchesPlayed: number | null }

/* Confidentialité §24-F encore ouverte : une équipe parcourue publiquement
   n'expose NI son OVR NI son roster détaillé — nom, capitaine, effectif
   seulement. L'effectif de MON équipe sort du core (activeMembers), jamais
   d'un chiffre tapé en dur. Les équipes adverses n'ont pas de compteur de
   matchs joués dans le modele de donnees actuel (OpponentTeam) — affiche
   honnetement absent plutot qu'invente. */
const MY_TEAM_CAPTAIN = captainOf(INITIAL_MEMBERS, MY_TEAM.id);
const BROWSABLE_TEAMS: BrowsableTeam[] = [
  {
    id: MY_TEAM.id,
    name: MY_TEAM.name,
    captainName: MY_TEAM_CAPTAIN ? memberDisplayName(MY_TEAM_CAPTAIN.userId) : '—',
    playerCount: activeMembers(INITIAL_MEMBERS, MY_TEAM.id).length,
    mine: true,
    matchesPlayed: MY_TEAM_MATCHES_PLAYED,
  },
  ...OPPONENT_TEAMS.map((t) => ({
    id: t.id, name: t.name, captainName: t.captainName, playerCount: t.playerCount, mine: false, matchesPlayed: null,
  })),
];

/* Degrade par equipe — accent visuel deterministe (id d'equipe -> teinte),
   PAS une donnee metier (aucun rapport avec --gold, reserve OVR/badges).
   Rotation fixe de 4 teintes non-semantiques, jamais primary/gold/success/
   danger — evite exactement la collision deja signalee dans DECISIONS.md. */
const CREST_GRADIENTS = [
  ['#4A9EFF', '#0A2A47'], ['#1E9C57', '#063017'], ['#B05CFF', '#2A0A47'], ['#FF8A3D', '#4A2200'],
] as const;
/* Indexe sur la POSITION dans la liste affichee (jamais un hash de l'id) —
   la liste d'equipes reelles est courte (3 aujourd'hui) et un hash de
   chaine courte collisionne facilement sur un petit modulo (verifie :
   t-fckahwa/t-panthers/t-babezzouar tombaient tous sur le meme index avec
   un hash simple). L'index de position garantit zero collision tant que la
   liste ne depasse pas 4 equipes, et reste stable (BROWSABLE_TEAMS est un
   tableau fixe, pas reordonne). */
function crestGradient(index: number): readonly [string, string] {
  return CREST_GRADIENTS[index % CREST_GRADIENTS.length]!;
}

export function ExplorerScreen({ onNavigate, store, initialTab }: {
  onNavigate: (route: Route) => void; store: AppStore;
  /** Ouvre directement un onglet (« Voir tous les centres » depuis le Home) ; défaut : Matchs. */
  initialTab?: ExplorerTabName | undefined;
}) {
  const [tab, setTab] = useState<ExplorerTab>(initialTab ?? 'matchs');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [dayStart] = useState(dayRailStarts);
  /* Lot 5 (Explorer.dc.html) : l'Explorer s'ouvre sur AUJOURD'HUI (le rail de sept jours a toujours un jour choisi) ; « Tous les jours » = effacer « Quand ? ». */
  const [selectedDay, setSelectedDay] = useState<number | 'ALL'>(() => dayStart[0]!);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('tous');
  const sportTabs = sportTabsFor(store.venues);
  // A7 (22/09/2026) : premier sport RÉELLEMENT proposé — jamais 'FOOTBALL' en dur (un catalogue
  // padel-only afficherait alors un filtre par défaut vide).
  /* « Tous » d'abord (maquette) : le fil montre tous les sports du catalogue tant que le joueur n'en choisit pas un. */
  const [sport, setSport] = useState<Sport | 'ALL' | null>('ALL');
  /* Page « Filtres » (Lot 5) : ce qui s'ajoute au sport, au jour et au filtre rapide déjà là — côté serveur pour les matchs. */
  const t = useT();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [city, setCity] = useState<CityFilter | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [spots, setSpots] = useState(false);
  /** Onglet Terrains : son propre état (ville, sport, format, « libres ce soir »), jamais celui des matchs. */
  const defaultVenueFilters: VenueFilters = { ...NO_VENUE_FILTERS, city: defaultVenueCity(store.identity.city) };
  const [venueFilters, setVenueFilters] = useState<VenueFilters>(defaultVenueFilters);
  const tomorrowStart = dayStart[1]!;
  const todayStart = dayStart[0]!;
  const when: WhenFilter | null = whenOf(quickFilter, selectedDay, todayStart, tomorrowStart);
  const setWhen = (w: WhenFilter | null) => { const a = applyWhen(w, todayStart, tomorrowStart); setQuickFilter(a.quick); setSelectedDay(a.day); };
  /** Un jour choisi au calendrier qui n'est aucun des quatre « Quand ? » (le bouton « Choisir un jour » affiche alors sa date). */
  const customDay = selectedDay !== 'ALL' && quickFilter === 'tous' && when === null ? selectedDay : null;
  const q = fold(query.trim());

  /* L3 (mise à l'échelle, 25/09/2026, décision d'Aymen : « filtres serveur + Afficher plus ») : ce n'est plus l'écran
     qui filtre les 50 matchs les plus proches en mémoire — chaque filtre (sport, jour, « Aujourd'hui / Ce soir /
     Week-end », texte) est un PARAMÈTRE du fil côté serveur, la liste arrive page par page (« Afficher plus »), et le
     décompte par jour du bandeau vient d'une route dédiée. À 15 centres, un jour ou un filtre voyait sinon des matchs
     tronqués au 50ᵉ. La règle de chaque filtre est celle de l'ancien écran (lib/feedQuery.ts). Le texte est attendu
     300 ms après la dernière frappe : une requête par mot tapé, jamais une par lettre. */
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const feed = store.feed;
  const reloadFeed = () => {
    if (!sport) return;
    void store.loadFeed({
      sport: sport === 'ALL' ? null : sport, day: selectedDay, quick: quickFilter, query: debouncedQuery,
      levels, formats, city, spots,
    }, false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'matchs') reloadFeed(); }, [tab, sport, selectedDay, quickFilter, debouncedQuery, levels, formats, city, spots]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'matchs') void store.loadFeedDayCounts(sport === 'ALL' ? null : sport, dayStart[0]!, dayStart.length); }, [tab, sport]);
  const dayCount = (d: number): number => store.feedDayCounts?.[epochDateStamp(d)] ?? 0;
  /** Seul un jour est choisi (aucun autre filtre, aucune recherche) : l'état vide de la maquette parle de CE jour-là. */
  const dayOnly = selectedDay !== 'ALL' && quickFilter === 'tous' && city === null && levels.length === 0 && formats.length === 0 && !spots && debouncedQuery.trim() === '';
  const loadingFirstPage = feed.status === 'loading' && feed.entries.length === 0;
  const visibleTeams = BROWSABLE_TEAMS.filter((t) =>
    q === '' || fold(t.name).includes(q) || fold(t.captainName).includes(q));

  /* La recherche change de cible avec l'onglet : on la vide pour ne jamais
     appliquer silencieusement un texte tapé dans un autre contexte. */
  const selectTab = (t: ExplorerTab) => { setTab(t); setQuery(''); setSearchOpen(false); };

  /* Règle de routage §6 : mon propre match ouvre la vue organisateur. */
  const filterCount = tab === 'matchs' ? matchFilterCount({ city, when, levels, formats, spots }) : (venueFilters.city !== null ? 1 : 0) + (venueFilters.formats.length > 0 ? 1 : 0);
  const openMatch = (matchId: string, organizerId: string) =>
    onNavigate(organizerId === CURRENT_USER_ID
      ? { name: 'match', mode: 'organizer', matchId }
      : { name: 'match', mode: 'detail', matchId });

  return (
    <section className="tab-screen" id="s-explorer">
      {/* En-tête de l'Explorer repeint (Lot 5, Explorer.dc.html) : titre, recherche, filtres — plus de slogan sous le titre.
          La recherche n'a de sens que sur Matchs et Terrains (l'onglet Équipes garde son champ permanent). */}
      <header className="xp-head">
        <h1 className="xp-h1">{t('Explorer')}</h1>
        {tab === 'matchs' || tab === 'terrains' ? (
          <div className="xp-head__btns">
            <button type="button" className="xp-iconbtn mb-tap" aria-label={t('Rechercher')} aria-pressed={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}>
              <Icon id="i-search" className="mb-ic--sm" />
            </button>
            <button type="button" className="xp-iconbtn mb-tap" aria-label={t('Filtres')} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              <Icon id="i-filter" className="mb-ic--sm" />
              {filterCount > 0 ? <span className="xp-iconbtn__n" aria-hidden="true">{filterCount}</span> : null}
            </button>
          </div>
        ) : null}
      </header>

      <div className="xp-tabs" role="tablist" aria-label={t('Que cherches-tu ?')} data-n={TABS.length}>
        {TABS.map((x) => (
          <button key={x.value} type="button" role="tab" className="xp-tab mb-tap" aria-selected={tab === x.value} onClick={() => selectTab(x.value)}>
            {x.icon ? <Icon id={x.icon} className="mb-ic--sm" /> : null}{t(x.label)}
          </button>
        ))}
      </div>

      {/* key par onglet : les trois panneaux occupent le même emplacement JSX —
          sans clé, React muterait le div en place et l'apparition ne se
          rejouerait pas au changement d'onglet. */}
      {tab === 'matchs' ? (
        <div className="ex-panel" key="p-matchs">
          {/* Rail de sept jours (AUJ. + six) : jour choisi = pastille allumée ; un jour sans match d'après les décomptes réels est estompé
              (la maquette n'affiche pas de nombre). Choisir un jour remet le filtre rapide à zéro. */}
          <div className="xp-days" role="group" aria-label={t('Quand ?')}>
            {dayStart.map((d, i) => {
              const date = new Date(d);
              const known = store.feedDayCounts !== null;
              return (
                <button key={d} type="button" className="xp-day mb-tap" aria-pressed={selectedDay === d} data-empty={known && dayCount(d) === 0 ? 'true' : undefined}
                  onClick={() => { setQuickFilter('tous'); setSelectedDay(d); }}>
                  <span className="xp-day__abbr">{t(i === 0 ? 'AUJ.' : WEEKDAY_KEYS[date.getDay()]!)}</span>
                  <span className="xp-day__n">{date.getDate()}</span>
                </button>
              );
            })}
          </div>

          {/* Sport : Tous / Foot / Padel (puces à icône, comme l'onglet Terrains). */}
          {sportTabs.length > 0 ? (
            <div className="xp-chips" role="group" aria-label={t('Quel sport ?')}>
              <button type="button" className="xp-chip mb-tap" aria-pressed={sport === 'ALL'} onClick={() => setSport('ALL')}>{t('Tous')}</button>
              {sportTabs.map((x) => (
                <button key={x.value} type="button" className="xp-chip mb-tap" aria-pressed={sport === x.value} onClick={() => setSport(x.value)}>
                  <Icon id={sportIcon(x.value)} className="mb-ic--sm" />{t(sportChipLabel(x.value))}
                </button>
              ))}
            </div>
          ) : null}
          <div className="xp-list-gap" />

          {feed.status === 'error' && feed.entries.length === 0 ? (
            <div className="mb-note" role="alert">
              <div className="mb-note__mark"><Icon id="i-search" className="mb-ic--lg" /></div>
              <h4 className="mb-note__title">Impossible de charger les matchs</h4>
              <p className="mb-note__text">{feed.error ?? GENERIC_ERROR_MESSAGE}</p>
              <button type="button" className="mb-btn mb-btn--sm mb-tap" onClick={reloadFeed}>Réessayer</button>
            </div>
          ) : loadingFirstPage ? (
            <p className="mb-note__text" role="status" aria-live="polite">Chargement des matchs…</p>
          ) : feed.entries.length > 0 ? (
            <>
              <div className="xp-mlist" aria-busy={feed.status === 'loading'}>
                {feed.entries.map((e) => (
                  <ExplorerMatchCard key={e.match.id} match={e.match} players={e.players} venueName={store.venueName(e.match.venueId)}
                    onOpen={() => openMatch(e.match.id, e.match.organizerId)} />
                ))}
              </div>
              <LoadMoreButton visible={feed.hasMore} loading={feed.loadingMore} onLoad={() => store.loadMoreFeed()} />
            </>
          ) : dayOnly ? (
            /* ExplorerVide.dc.html : un jour sans match, sans autre filtre — « Pas encore de match ce jour-là », avec « M'alerter si un match est créé »
               (Lot 11 : une alerte pour ce jour et ce sport, consommée à la création d'un match, par push et dans l'app). */
            <div className="xp-empty">
              <span className="xp-empty__mark" aria-hidden="true"><Icon id="i-cal" className="mb-ic--lg" /></span>
              <h3 className="xp-empty__title">{t('Pas encore de match')}<br />{t('ce jour-là')}</h3>
              <p className="xp-empty__text">{t('Et si c’était toi qui lançais le premier ?')}</p>
              <button type="button" className="mb-btn mb-btn--block mb-tap" onClick={() => onNavigate({ name: 'match', mode: 'create' })}>
                {t('Créer un match')}
              </button>
              <DayAlertButton store={store} day={epochDateStamp(selectedDay as number)} sport={sport === 'ALL' || sport === null ? null : sport} />
            </div>
          ) : (
            <div className="mb-note">
              <div className="mb-note__mark"><Icon id="i-search" className="mb-ic--lg" /></div>
              <h4 className="mb-note__title">Aucun match trouvé</h4>
              <p className="mb-note__text">Aucun match ouvert ne correspond à tes filtres. Crée le tien et lance l’appel.</p>
              <button type="button" className="mb-btn mb-btn--sm mb-tap" onClick={() => onNavigate({ name: 'match', mode: 'create' })}>
                Créer un match
              </button>
            </div>
          )}
        </div>
      ) : tab === 'terrains' ? (
        <VenuesPanel store={store} onNavigate={onNavigate} filters={venueFilters} onFilters={setVenueFilters} />
      ) : (
        <div className="ex-panel" key="p-equipes">
          <div className="mb-field ex-search" style={{ marginBottom: 16 }}>
            <Icon id="i-search" className="mb-ic--sm ex-search__ic" />
            <input
              type="search"
              className="mb-field__control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom d’équipe, capitaine…"
              aria-label="Rechercher une équipe"
            />
            {query !== '' ? (
              <button type="button" className="ex-search__clear mb-tap" aria-label="Effacer la recherche" onClick={() => setQuery('')}>
                <Icon id="i-x" className="mb-ic--sm" />
              </button>
            ) : null}
          </div>
          <h3 className="hm-section-label">Équipes du centre</h3>
          {visibleTeams.length > 0 ? (
            <div className="ex-teams">
              {visibleTeams.map((t, i) => {
                const [c1, c2] = crestGradient(i);
                return (
                  <button key={t.id} type="button" className="ex-team2"
                    onClick={() => onNavigate(t.mine ? { name: 'teams' } : { name: 'teams', visitTeamId: t.id })}>
                    <span className="ex-team2__crest" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} aria-hidden="true">
                      {teamInitials(t.name)}
                    </span>
                    <span className="ex-team2__body">
                      <span className="ex-team2__name">
                        {t.name}
                        {t.mine ? <i className="ex-team2__badge">Ton équipe</i> : null}
                      </span>
                      <span className="ex-team2__meta">
                        {t.playerCount} joueur{t.playerCount > 1 ? 's' : ''}
                        {t.matchesPlayed !== null ? ` · ${t.matchesPlayed} match${t.matchesPlayed > 1 ? 's' : ''}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mb-note">
              <div className="mb-note__mark"><Icon id="i-shield" className="mb-ic--lg" /></div>
              <h4 className="mb-note__title">Aucune équipe trouvée</h4>
              <p className="mb-note__text">Vérifie l’orthographe ou efface la recherche pour revoir les équipes du centre.</p>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm mb-tap" onClick={() => setQuery('')}>
                Effacer la recherche
              </button>
            </div>
          )}
        </div>
      )}

      {searchOpen && (tab === 'matchs' || tab === 'terrains') ? (
        <ExplorerSearch store={store} onNavigate={onNavigate} onClose={() => setSearchOpen(false)} />
      ) : null}

      {filtersOpen && (tab === 'matchs' || tab === 'terrains') ? (
        tab === 'matchs' ? (
          <ExplorerFilters
            tab="matchs" city={city} onCity={setCity} when={when} onWhen={setWhen}
            customDay={customDay} dayCounts={store.feedDayCounts}
            onNeedDayCounts={() => { void store.loadFeedDayCounts(sport === 'ALL' ? null : sport, dayStart[0]!, CALENDAR_HORIZON_DAYS); }}
            onPickDay={(d) => { setQuickFilter('tous'); setSelectedDay(d); }}
            sports={sportTabs.map((x) => x.value)} sport={sport} onSport={setSport}
            levels={levels} onLevels={setLevels} formats={formats} onFormats={setFormats} spots={spots} onSpots={setSpots}
            onClear={() => { setCity(null); setWhen('aujourdhui'); setLevels([]); setFormats([]); setSpots(false); setSport('ALL'); }}
            onClose={() => setFiltersOpen(false)}
          />
        ) : (
          <ExplorerFilters
            tab="terrains" city={venueFilters.city} onCity={(c) => setVenueFilters((f) => ({ ...f, city: c }))}
            when={null} onWhen={() => {}}
            sports={sportTabs.map((x) => x.value)} sport={venueFilters.sport} onSport={(sp) => setVenueFilters((f) => ({ ...f, sport: sp }))}
            levels={[]} onLevels={() => {}} formats={venueFilters.formats} onFormats={(fm) => setVenueFilters((f) => ({ ...f, formats: fm }))}
            spots={false} onSpots={() => {}}
            onClear={() => setVenueFilters(defaultVenueFilters)}
            onClose={() => setFiltersOpen(false)}
          />
        )
      ) : null}
    </section>
  );
}
