import { getLang } from './lang.js';

const THIN_SPACE_CODES = [0x202f, 0x00a0];

/** Espace fine insécable (U+202F) — maquettes refonte-app-joueur (Onboarding.dc.html,
    MdpOublie.dc.html) la placent avant « ? » dans toute phrase française complète
    ("Ton pseudo{NNBSP}?", jamais "Ton pseudo ?" a l'espace normale). Constante plutot
    qu'un échappement   dans le JSX — même risque de corruption silencieuse que les
    diacritiques combinants (AccessSetupGate.tsx), évité de la même façon. */
export const NNBSP = String.fromCharCode(0x202f);

export function fmt(n: number): string {
  let out = n.toLocaleString('fr-FR');
  for (const code of THIN_SPACE_CODES) out = out.split(String.fromCharCode(code)).join(' ');
  return out;
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const WEEKDAY_ABBR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Libelle jour seul ("Ven. 21") a partir d'un epoch reel — moitie de
    epochDayTimeLabel(), utile la ou l'heure est deja affichee separement
    (ex. .mb-match__day a cote de .mb-match__h dans une carte de liste). */
export function epochDayLabel(epochMs: number): string {
  const d = new Date(epochMs);
  return `${WEEKDAY_ABBR[d.getDay()]}. ${d.getDate()}`;
}

/** Libelle "Ven. 23 août" (jour + quantieme + mois) a partir d'un epoch reel
    — epochDayLabel() n'a pas le mois, trop court pour la carte deux-colonnes
    de Match Detail ou la date seule doit se suffire (rapprochement visuel
    du prototype, `.mh-frame`). Intl plutot qu'un tableau de mois retape a
    la main : jamais deux sources du meme calendrier. */
export function epochFullDateLabel(epochMs: number): string {
  const s = new Date(epochMs).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Nom du jour en entier ("Vendredi"), sans date ni heure — pour les lignes
    ou le jour porte tout le sens ("Mes réservations", demande directe
    d'Aymen 29/08/2026 : "Vendredi · 19:30 → 20:30", pas d'abreviation).
    Intl plutot qu'un tableau retape, comme epochFullDateLabel(). */
export function epochWeekdayLabel(epochMs: number): string {
  const s = new Date(epochMs).toLocaleDateString('fr-FR', { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Libelle "Ven. 21 · 20:00" a partir d'un epoch reel — meme format que les
    libelles ecrits a la main ailleurs (EXISTING_KICKOFF_LABEL...), mais pour
    un epoch qui n'est pas fixe a l'avance (ex. un defi accepte a une date
    variable). dayLabel()/hhmm() restent pour l'abstraction jour-de-semaine +
    minutes-du-jour de Booking/SlotPicker — usage different, pas doublon. */
export function epochDayTimeLabel(epochMs: number): string {
  return `${epochDayLabel(epochMs)} · ${hhmm(epochMinutesOfDay(epochMs))}`;
}

/** Minutes depuis minuit pour un epoch reel — pont vers hhmm() quand seule
    l'heure de fin importe (le jour est deja affiche par epochDayTimeLabel). */
export function epochMinutesOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  return d.getHours() * 60 + d.getMinutes();
}

/** Prochaine occurrence reelle d'un jour-de-semaine + heure, au moins
    `minDaysOut` jours dans le futur — epoch reel, pas une abstraction
    jour-de-semaine seule. Partagee entre Challenges (proposer un creneau) et
    Booking (ancrer une reservation confirmee pour que canCancelBooking()
    puisse comparer un vrai "maintenant" au vrai debut du creneau) : une
    seule implementation de cette resolution date, jamais deux qui peuvent
    diverger. */
export function resolveNextWeekday(weekday: number, minutesOfDay: number, minDaysOut: number): number {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + minDaysOut);
  base.setDate(base.getDate() + ((weekday - base.getDay() + 7) % 7));
  base.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  /* minDaysOut=0 + le jour cible = AUJOURD'HUI : si l'heure choisie est deja
     passee, rester "aujourd'hui" produirait un epoch dans le passe (bug
     live trouve en verifiant le lot Premium — une resa au tout premier
     depart libre du jour, apres cette heure, se confirmait dans le passe et
     l'annulation gratuite se voyait aussitot refusee). Reculer d'une
     semaine complete resout le cas sans jamais changer le resultat pour
     minDaysOut>=1 (deja garanti futur par construction). */
  if (base.getTime() <= Date.now()) base.setDate(base.getDate() + 7);
  return base.getTime();
}

/** "YYYY-MM-DD" a partir d'un epoch reel, jour LOCAL (getters Date locaux —
    meme convention que le reste du fichier, ex. resolveNextWeekday) : le
    format exact attendu par apps/api (POST /bookings, POST /challenges...)
    en paramètre `date`. Lot 3B, étape 3 (mutations) : premier point ou
    apps/player doit parler epoch -> date+startMin plutôt que l'inverse. */
export function epochDateStamp(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date reelle ("YYYY-MM-DD") du jour represente par un chip de jour-de-
    semaine (SlotPicker/Booking/Créer un match) — Lot 3B, étape 4. Reproduit
    EXACTEMENT le cas particulier deja utilise pour l'affichage du chip
    "aujourd'hui" (SlotPicker.tsx, rangee des chips jour) : resolveNextWeekday
    recule TOUJOURS d'une semaine complete des que minuit est passe, y compris
    pour le jour d'aujourd'hui lui-meme (son propre commentaire l'explique) —
    sans ce cas a part, "aujourd'hui" resoudrait a tort la semaine prochaine.
    Reutilisee ici (recuperation des vraies disponibilites) pour que la date
    fetchee corresponde TOUJOURS a la date affichee sur le chip : une seule
    regle de resolution jour, jamais deux qui pourraient diverger. */
export function pickerDateForWeekday(weekday: number): string {
  const now = new Date();
  return weekday === now.getDay()
    ? epochDateStamp(now.getTime())
    : epochDateStamp(resolveNextWeekday(weekday, 0, 0));
}

/** Deux epochs tombent-ils le meme jour calendaire ? Utilise pour filtrer
    "aujourd'hui" (Home, demande directe d'Aymen 29/08/2026) — comparaison
    de vraies dates, jamais une fenetre glissante approximee. */
export function isSameCalendarDay(epochA: number, epochB: number): boolean {
  return new Date(epochA).toDateString() === new Date(epochB).toDateString();
}

/** Libelle jour relatif ("Ce soir" / "Aujourd'hui" / "Demain" / "Ven. 23 oct.") a partir
    d'un epoch reel — "Tes amis jouent bientot" (regle 11, Main(Ar).dc.html montre "Ce soir
    · 21:30" et "Ven. 23 oct. · 20:00") et "Ton prochain match" partagent le meme besoin.
    "Ce soir" seulement si l'heure est deja du soir (>=18h), sinon "Aujourd'hui" pour le
    meme jour calendaire — la maquette ne montre qu'un exemple du soir, ce choix evite
    d'afficher "Ce soir" pour un match du matin. Au-dela de demain, Intl avec la locale de
    la langue active (getLang() — synchrone, lu hors composant comme documente dans
    lib/lang.ts) donne directement le jour/mois en arabe, jamais un tableau de mois retape
    a la main pour chaque langue — DEJA localise, donc jamais repasse dans t(). `t` est pris
    en parametre (pas d'appel a useT() ici, fonction pure sans hook) pour traduire seulement
    les trois mots-cles francais ("Ce soir"/"Aujourd'hui"/"Demain"), jamais le resultat Intl. */
export function relativeDayLabel(epochMs: number, now: number, t: (key: string) => string): string {
  if (isSameCalendarDay(epochMs, now)) {
    return t(new Date(epochMs).getHours() >= 18 ? 'Ce soir' : 'Aujourd’hui');
  }
  if (isSameCalendarDay(epochMs, now + 86_400_000)) return t('Demain');
  const locale = getLang() === 'ar' ? 'ar-DZ' : 'fr-FR';
  const s = new Date(epochMs).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Monogramme 2 lettres a partir d'un nom d'equipe reel (Team.name) — donne
    a .tm-crest une identite distinguable par equipe sans inventer de donnee
    ni de couleur : "FC Kahwa" -> "FK", "Panthers Alger" -> "PA". Partagee
    entre Teams, Challenges et Profil (meme calcul partout, jamais retapee
    a la main). */
/** Numéro national ("0550123456", 10 chiffres — `normalizeAlgerianMobile().national`)
    regroupé "0550 12 34 56" (maquette Onboarding.dc.html, écran O3 "Ton code") — jamais
    le E.164 brut affiché au joueur. */
export function algerianLocalGrouped(national: string): string {
  const d = national.replace(/\D/g, '');
  return `${d.slice(0, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

/** Même numéro national, masqué "0550 •• •• 56" (maquette MdpNouveau.dc.html) — seuls
    les 4 premiers et les 2 derniers chiffres restent visibles. */
export function algerianLocalMasked(national: string): string {
  const d = national.replace(/\D/g, '');
  return `${d.slice(0, 4)} •• •• ${d.slice(8, 10)}`;
}

/** "0:42" — minutes:secondes à partir d'un reste en ms (maquette Onboarding.dc.html,
    "Pas reçu ? Tu pourras le redemander dans 0:42.") : jamais le "(59 s)" de l'ancien
    texte, qui n'existe dans aucune maquette. */
export function mmss(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
  return (words[0] ?? '').slice(0, 2).toUpperCase();
}
