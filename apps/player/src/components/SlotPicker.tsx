import type { ReactNode } from 'react';
import { fieldAvailability, quoteRange, rateAt, DEFAULT_DURATIONS_MIN, FORMAT_CAPACITY, type MatchFormat, type Quote } from '@moubarat/core';
import { Icon } from './Icon.js';
import { fmt, hhmm, resolveNextWeekday } from '../lib/format.js';
import {
  BASE_RATE, PRICING_RULES, DEMO_FORMAT, FIELD_ID, HOURS_START_MIN, HOURS_END_MIN, DAYS, dayLabel, type Blocker,
} from '../data/bookingDemo.js';
import type { AvailabilityStart } from '../lib/mappers.js';

const DURATION_OPTIONS = [...DEFAULT_DURATIONS_MIN];
const MIN_MS = 60_000;

/* Creneaux groupes par periode (demande directe d'Aymen, 29/08/2026) :
   DATE -> PERIODE -> HEURE plutot que DATE -> une grille indifferenciee.
   Sections plates dans le meme ecran, jamais des onglets (l'objectif est
   de voir toute la disponibilite d'un coup d'oeil) ; une periode sans
   creneau ne s'affiche pas du tout. Bornes : matin < 12h, apres-midi
   12h-17h, soir >= 17h — reprend exactement l'exemple d'Aymen (16h30 en
   apres-midi, 17h00 en soir). Le tag "Plus populaire" est un choix
   editorial du produit (pas une statistique — aucune donnee de frequentation
   reelle n'existe), assume comme copy fixe plutot que presente comme un
   chiffre mesure. */
const PERIODS: { key: string; label: string; tag?: string; test: (m: number) => boolean }[] = [
  { key: 'matin', label: 'Matin', test: (m) => m < 12 * 60 },
  { key: 'apresmidi', label: 'Après-midi', test: (m) => m >= 12 * 60 && m < 17 * 60 },
  { key: 'soir', label: 'Soir', tag: 'Plus populaire', test: (m) => m >= 17 * 60 },
];

/** Chevauchement semi-ouvert [start, end) entre un creneau candidat et les
    blockers d'un jour — exportee pour etre LA seule implementation cote app
    (BookingFlow la dupliquait verbatim, dedup relevee par le spec §5). */
export function overlaps(blockers: readonly Blocker[], startMin: number, endMin: number): boolean {
  return blockers.some((b) => b.startMin < endMin && startMin < b.endMin);
}

interface SlotPickerProps {
  weekday: number;
  duration: number;
  selected: number | null;
  blockers: readonly Blocker[];
  onSelectWeekday: (weekday: number) => void;
  /** Optionnel depuis que la duree peut etre imposee (cf. durationLocked). */
  onSelectDuration?: (duration: number) => void;
  onSelectStart: (startMin: number) => void;
  /** Contenu injecte sous le total (ex. le champ "Au nom de qui ?" de Booking) — Create Match n'en a pas besoin. */
  recapFooter?: ReactNode;
  /** Duree imposee par l'appelant (ex. deplacer un match existant : la duree
      reservee ne change pas) — masque la rangee de chips de duree. */
  durationLocked?: boolean;
  /** Lot 3B, étape 4 : départs déjà résolus par le serveur (GET
      /fields/:fieldId/availability, mappés en lib/mappers.ts, récupérés via
      lib/useFieldAvailability.ts) — remplace le calcul mock local ligne pour
      ligne (même forme exacte : startMin/totalDa/peak/quote) quand fourni.
      `undefined` = comportement actuel inchangé (mock), pour ne rien casser
      tant qu'un appelant n'est pas migré (ex. Défis, hors périmètre de ce
      lot). Le serveur a déjà exclu les créneaux pris ET, pour aujourd'hui,
      les départs déjà entamés — aucun filtre temporel supplémentaire n'est
      réappliqué ici. */
  remoteStarts?: readonly AvailabilityStart[] | undefined;
  /** Formats RÉELS du terrain avec le tarif de base de chacun (DA/heure), pour
      classer chaque bande du récap Pleines/Creuses CONTRE LE TARIF DE BASE DU
      FORMAT CHOISI — sans lui, le récap comparait à tort contre `BASE_RATE`
      mock même quand `remoteStarts` est fourni (revue Lot 3B, étape 4).
      Ignoré si `remoteStarts` est absent (comportement mock inchangé). */
  remoteFormats?: readonly { format: MatchFormat; hourlyRateDa: number }[] | undefined;
  /** 16/09/2026 (demande d'Aymen) : quand le terrain propose PLUSIEURS formats,
      le récap du créneau choisi les présente côte à côte avec leur prix — au
      joueur de choisir, jamais une présélection ni une recommandation. Le
      parent porte ce choix (`selectedFormat`, remis à null quand il change de
      créneau/jour/durée) ; terrain à UN format : rien n'est affiché et le
      parent n'a rien à fournir (le serveur déduit). */
  selectedFormat?: MatchFormat | null | undefined;
  onSelectFormat?: ((format: MatchFormat) => void) | undefined;
}

/** Un départ, tel que SlotPicker l'affiche — la voie mock (sans `remoteStarts`)
    produit UN seul devis sans format (`format: null`). */
interface PickerStart {
  startMin: number;
  byFormat: { format: MatchFormat | null; totalDa: number; peak: boolean; quote: Quote }[];
}

/** Grille jour/duree/departs + recap par bande, partagee entre Booking (chemin normal)
    et Create Match (chemin A, "je pars de zero") — memes regles de prix (quoteRange),
    un seul endroit qui les affiche, pas deux implementations qui peuvent diverger. */
export function SlotPicker({
  weekday, duration, selected, blockers, onSelectWeekday, onSelectDuration, onSelectStart, recapFooter, durationLocked,
  remoteStarts, remoteFormats, selectedFormat, onSelectFormat,
}: SlotPickerProps) {
  /* "Maintenant" reel — pour le jour "aujourd'hui" uniquement (Lot 2, §8) :
     un depart deja passe ne doit plus jamais etre propose ni confirmable,
     comme le fait deja le bandeau "departs encore libres aujourd'hui" de
     BookingFlow (todayStarts, meme filtre). Avant ce correctif, SlotPicker
     n'avait aucune notion de "maintenant" — un depart passe se confirmait
     silencieusement la semaine suivante (resolveNextWeekday). */
  const now = new Date();
  const isToday = weekday === now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  /* Lot 3B, étape 4 : `remoteStarts`, quand fourni, remplace intégralement ce
     calcul mock — les départs viennent alors de GET /fields/:fieldId/
     availability (vraies horaires, vraies réservations, vrai devis), déjà
     dans la même forme exacte que ce bloc construit ci-dessous. Sans lui,
     comportement 100% inchangé : les departs libres viennent du MOTEUR core
     (fieldAvailability : horaires + blockers + devis par depart), plus
     jamais d'une boucle recodee ici — l'app et le CRM consomment la meme
     fonction (revue Premium, lentille core). dayStartMs 0 : la grille
     raisonne en minutes du jour, l'ancrage epoch reel est fait par
     l'appelant a la confirmation. */
  const starts: readonly PickerStart[] = remoteStarts ?? fieldAvailability({
    field: { id: FIELD_ID, hourlyRate: BASE_RATE },
    // venueId : valeur synthétique jamais vérifiée par le moteur (structure seulement) —
    // ce chemin mock n'est plus exercé que par Défis (flag TEAMS_CHALLENGES_ENABLED off).
    hours: [{ venueId: FIELD_ID, weekday, startMin: HOURS_START_MIN, endMin: HOURS_END_MIN }],
    rules: PRICING_RULES,
    weekday,
    dayStartMs: 0,
    durationMin: duration,
    format: DEMO_FORMAT,
    blockers: blockers.map((b) => ({ start: b.startMin * MIN_MS, end: b.endMin * MIN_MS })),
  }).filter((s) => !isToday || s.startMin > nowMinutes).map((s) => ({
    startMin: s.startMin,
    byFormat: [{
      format: null,
      totalDa: s.quote.total.amount,
      /* « Pleine » = le tarif au depart differe du tarif de base — derive de la
         regle, jamais d'un montant litteral. */
      peak: rateAt(PRICING_RULES, BASE_RATE, weekday, s.startMin, DEMO_FORMAT).amount !== BASE_RATE.amount,
      quote: s.quote,
    }],
  }));
  const selectedStart = selected !== null ? starts.find((s) => s.startMin === selected) : undefined;
  const multiFormat = (selectedStart?.byFormat.length ?? 0) > 1;
  /* Devis affiche dans le recap : terrain a UN format -> son devis ; plusieurs
     formats -> celui que le joueur a choisi, RIEN tant qu'il n'a pas choisi
     (jamais une valeur par defaut qui ferait office de recommandation). */
  const selectedEntry = selectedStart
    ? (multiFormat ? selectedStart.byFormat.find((f) => f.format === selectedFormat) : selectedStart.byFormat[0])
    : undefined;
  const selectedQuote = selectedEntry?.quote
    // Filet mock uniquement en l'absence de donnees reelles — jamais un
    // prix mock affiche quand remoteStarts est fourni (mieux vaut aucun
    // recap qu'un prix qui pourrait diverger du vrai).
    ?? (selected !== null && !remoteStarts && !selectedStart
      ? quoteRange(PRICING_RULES, BASE_RATE, weekday, selected, selected + duration, DEMO_FORMAT)
      : null);
  const baseRateDa = remoteFormats?.find((f) => f.format === selectedEntry?.format)?.hourlyRateDa
    ?? (remoteStarts ? undefined : BASE_RATE.amount);

  return (
    <>
      {/* Chips jour empiles (abrev + vrai chiffre du jour, prochaine
          occurrence reelle via resolveNextWeekday) — rapprochement visuel
          du prototype (`.day-pill`), plus informatif que l'abrev seule :
          on voit QUEL vendredi, pas juste "vendredi". Partage par
          Reservation/Creer un match/Defis (SlotPicker commun), aucune
          divergence introduite. */}
      <div className="bk-row bk-row--days">
        {DAYS.map((d) => (
          <button
            key={d.weekday} type="button" className="bk-day-pill" aria-pressed={weekday === d.weekday}
            onClick={() => onSelectWeekday(d.weekday)}
          >
            <span className="bk-day-pill__abbr">{d.label}</span>
            {/* Lot 2, §8 : resolveNextWeekday(jour, 0, 0) recule TOUJOURS
                d'une semaine pour le jour "aujourd'hui" (minuit est deja
                passe) — la pastille du jour meme affichait donc la date de
                la semaine prochaine. Cas special : le jour reel pour
                aujourd'hui, la formule normale pour les 6 autres. */}
            <span className="bk-day-pill__n">
              {d.weekday === now.getDay() ? now.getDate() : new Date(resolveNextWeekday(d.weekday, 0, 0)).getDate()}
            </span>
          </button>
        ))}
      </div>
      {!durationLocked ? (
        <div className="bk-row">
          {DURATION_OPTIONS.map((d) => (
            <button key={d} type="button" className="mb-chip" aria-pressed={duration === d} onClick={() => onSelectDuration?.(d)}>
              {d} min
            </button>
          ))}
        </div>
      ) : null}
      <p className="mb-meta" style={{ margin: '2px 0 10px' }}>
        {starts.length} départ{starts.length > 1 ? 's' : ''} libre{starts.length > 1 ? 's' : ''} · {dayLabel(weekday)} · {duration} min
      </p>
      {starts.length === 0 ? (
        <div className="mb-note">
          <div className="mb-note__mark"><Icon id="i-clock" className="mb-ic--lg" /></div>
          <h4 className="mb-note__title">Aucun départ libre</h4>
          <p className="mb-note__text">
            Tout est pris {dayLabel(weekday)} sur {duration} min — essaie un autre jour{durationLocked ? '' : ' ou une durée plus courte'}.
          </p>
        </div>
      ) : (
        <div className="bk-periods">
          {PERIODS.map((period) => {
            const periodStarts = starts.filter((s) => period.test(s.startMin));
            if (periodStarts.length === 0) return null;
            return (
              <div className="bk-period" key={period.key}>
                <p className="bk-period__label">
                  {period.label}
                  {period.tag ? <span className="bk-period__tag">{period.tag}</span> : null}
                </p>
                <div className="bk-starts">
                  {periodStarts.map((s) => {
                    const multi = s.byFormat.length > 1;
                    const cheapest = Math.min(...s.byFormat.map((f) => f.totalDa));
                    return (
                      <button
                        key={s.startMin} type="button" className={`bk-start${s.byFormat.some((f) => f.peak) ? ' peak' : ''}${selected === s.startMin ? ' on' : ''}`}
                        onClick={() => onSelectStart(s.startMin)}
                      >
                        {/* Plusieurs formats : « dès X » = le prix le plus bas, un fait
                            (pas une recommandation) — chaque format a son prix dans
                            le récap une fois le créneau choisi. */}
                        <b>{hhmm(s.startMin)}</b><span>{multi ? `dès ${fmt(cheapest)} DA` : `${fmt(s.byFormat[0]!.totalDa)} DA`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected !== null && selectedStart && (selectedQuote || multiFormat) ? (
        <div className="bk-recap on">
          {multiFormat ? (
            <>
              <p className="bk-recap__label">Choisis ton format</p>
              <div className="bk-fmts">
                {selectedStart.byFormat.map((f) => (
                  <button
                    key={f.format} type="button" className="bk-fmt" aria-pressed={selectedFormat === f.format}
                    onClick={() => f.format && onSelectFormat?.(f.format)}
                  >
                    <b>{f.format}</b>
                    <small>{f.format ? `${FORMAT_CAPACITY[f.format]} joueurs` : ''}</small>
                    <span>{fmt(f.totalDa)} DA</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {selectedQuote ? (
            <>
              {selectedQuote.bands.map((b, i) => (
                <div className="bk-band" key={i}>
                  <span>{b.rate.amount !== baseRateDa ? 'Pleines' : 'Creuses'} · {hhmm(b.fromMin)} → {hhmm(b.toMin)}</span>
                  <span>{fmt(b.amount)} DA</span>
                </div>
              ))}
              <div className="bk-total">
                <span className="mb-tag">Total à payer sur place</span>
                <span className="mb-price" data-unit="total">{fmt(selectedQuote.total.amount)}<span className="mb-price__cur">DA</span></span>
              </div>
              {recapFooter}
            </>
          ) : (
            <p className="mb-meta" style={{ margin: '10px 0 0' }}>Le prix dépend du format — choisis-en un pour voir le détail.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
