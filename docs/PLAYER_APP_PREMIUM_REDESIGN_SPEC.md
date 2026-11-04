# MOUBARAT — PLAYER APP PREMIUM REDESIGN SPEC

**Produced**: 27/08/2026, by a 9-cluster + 2-synthesis multi-agent audit (11 agents, ~2.65M tokens, 479 tool calls) covering all 35 screens of the attached benchmark (`moubarat_prototype_live__6_.html`, cleaned copy referenced throughout as `prototype_live_clean.html`) against the real `apps/player` implementation, `@moubarat/core`, `design/moubarat-ds.css`, `apps/player/src/styles/player.css`, and every relevant product doc (`BUSINESS_RULES_V1.md`, `UIUX_ARCHITECTURE_STRATEGIE.md`, `VISUAL_REFINEMENT_STRATEGY.md`, `QA_PHASE12_REGISTRE.md`).

**This is the execution specification for the Fable 5 + UltraCode implementation session.** Everything below is grounded in a real file, a real function, a real class name, or a real line of the benchmark — not invented. Where a recommendation would require a new business rule, it is explicitly marked **BUSINESS DECISION REQUIRED** rather than silently decided, per the audit mandate's rule 8.

**Scope confirmed**: `apps/player` only. `apps/crm` is untouched, unread, and out of scope. No production code was modified during the audit — this document is the only output.

---

## 0. Read this first — one bug that isn't a visual finding

**✅ RÉSOLU — Lot 1 fondations (26/08/2026), voir `docs/DECISIONS.md`.** `cancelProof()` appelle désormais le vrai `canCancelBooking()`, message réel dans les deux branches, régression testée. Section conservée telle quelle pour la trace d'audit.

Independent of everything else in this document, the completeness-critic pass verified a real, already-shipped defect against source directly:

`apps/player/src/components/BookingFlow.tsx`'s `cancelProof()` **unconditionally** shows *"Annulée sans frais (plus de 2 h avant le créneau)"* regardless of how close to kickoff the cancellation actually happens — it never imports or calls `canCancelBooking()` from `packages/core/src/rules/booking.ts`, which is the real, tested, frozen rule that would return `CANCEL_WINDOW_PASSED` inside the 2-hour window. A player cancelling 5 minutes before kickoff today sees the same "free, no problem" message as one cancelling a week out.

This is a live violation of CLAUDE.md's rule 1 ("Toute règle serveur ou client DOIT passer par ce package — jamais de règle dupliquée ailleurs") and of `VISUAL_REFINEMENT_STRATEGY.md §8`. It is not a visual-polish item and does not need to wait for the redesign pass — it's a small, mechanical fix (call `canCancelBooking()`, branch the toast on the result) with real user-trust stakes. **Recommend fixing this on its own, independent of when the visual pass ships.**

---

## 1. Global ratings and verdict

**Global app quality**: functionally, the 5 shipped screens (Auth, Booking, Match, Teams, Challenges) are built correctly on real `@moubarat/core` logic with no reimplemented business rules — this was independently reverified across all 9 clusters, not assumed. Visually, they are "Functional visual" to "Refined" but were built before this benchmark existed and were never A/B-compared against it. The other ~25 screens the canonical navigation and business rules require (Home, Explorer, Mes Matchs, Profil, Notifications, the fuller Create Match flow) are **not started at all** — not weak, simply absent. **✅ Lot 1 fondations (26/08/2026)** built the real nav shell itself (`nav.ts`/`BottomNav.tsx`, 5 destinations, real `onExit` on all 4 existing flows) plus minimal honest placeholders for Home/Explorer/Mes Matchs/Profil — see `docs/DECISIONS.md`. The Discovery layer's real content (this section's actual subject) is still fully open, now genuinely reachable rather than blocked on routing.

**Verdict on "was Create Match given the deepest treatment"**: yes — two dedicated agents (screen-by-screen + 8-scenario systematic audit) produced the largest, most decisive body of findings of any cluster, including correcting the audit's own working hypothesis on capacity (see §4).

**Classification tally** (A=Preserve · B=Refine · C=Restructure · D=Rebuild/Not-started):

| Cluster | A | B | C | D |
|---|---|---|---|---|
| Discovery (Home/Explorer/Search/Filters/Results — 7 screens) | 0 | 0 | 0 | 7 |
| Booking/Terrain (3 screens) | 0 | 3 | 0 | 0 |
| Create Match (6 screens) | 1 | 4 | 0 | 1 |
| Match Lifecycle (5 screens) | 0 | 1 | 0 | 4 |
| Teams + Profile (2 screens) | 0 | 0 | 1 | 1 |
| Challenges — core (4 screens) | 0 | 4 | 0 | 0 |
| Challenges — outcomes (5 screens) | 0 | 5 | 0 | 0 |
| Notifications (3 screens) | 0 | 0 | 0 | 3 |
| **Total (35)** | **1** | **17** | **1** | **16** |

Read this table carefully: **"D" here overwhelmingly means "not started," not "badly built."** Every screen that exists and was actually read (Booking's 3, Create Match's 5 of 6, Match Detail, Team Detail, all 9 Challenges screens) classified B or better — real, correctly-wired, core-driven work. The 16 D's are concentrated in the 25 not-yet-built screens the canonical nav (`BUSINESS_RULES_V1.md §3`) requires. **This is a coverage gap, not a quality problem** — see §12 for what to build first.

**On `currentRating` for not-started screens**: per the completeness critic's Gap 8, when `existsAs: "not_started"`, the numeric rating in §3 below scores **the benchmark's own proposal quality**, not a shipped screen — e.g. "Filtres Terrains: 8/10, classification D" means "the benchmark's proposal for this screen is an 8/10 design, and 0% of it is built," not "we built something and it scores 8." Keep this distinction in mind throughout — it is *not* the contradiction it looks like at a glance.

**Biggest strengths** (do not lose these while redesigning):
- Zero reimplemented business logic anywhere, in any of the 5 shipped flows — every price, every capacity, every permission check goes through real `@moubarat/core` functions, re-verified this pass.
- `SlotPicker.tsx` — a genuinely exemplary shared component (day/duration/price engine reused identically by Booking, Match creation, and Challenges compose) that the benchmark itself never achieves (it reinvents 4 incompatible match-card patterns and 3 terrain-card patterns for lack of exactly this discipline).
- Create Match's format/capacity pipeline (`FORMAT_OPTIONS` derived from `FIELD.formats`/`FORMAT_CAPACITY`, guarded by `validateFieldFormats()` at load time) is **provably more correct** than the benchmark, which offers formats/capacities a real field cannot host.
- `design/moubarat-ds.css` already contains several fully-built, zero-bug, currently-unused components (`.mb-match`, `.mb-note`, `.mb-skel`) that solve problems the benchmark solves badly or not at all — see §7.

**Biggest weaknesses**:
- No nav shell / bottom tab bar exists anywhere — this single gap blocks Home, Explorer, Mes Matchs, and Profil from having anywhere to live, and is why "teams"/"challenges" are currently dead branches in `App.tsx` reachable only by hand-editing `initialScreen`.
- Single-venue, single-field fiction: `bookingDemo.ts`/`matchDemo.ts` both hardcode exactly one field (`t1`/Complexe Ryad). This is the root cause of at least 4 independent findings across 3 clusters (no venue choice in Booking, no venue choice in Create Match, 11v11 unreachable in both Create Match and Challenges, Home/Explorer's multi-venue content has nothing real to bind to).
- `.mb-match` — the design system's own designated, fully-built, truncation-safe match-card component — is used **zero times** anywhere in `apps/player/src`. This is the single highest-leverage unfixed gap in the whole audit.
- A4 (open QA anomaly, name truncation on short blocks) is real and current: multiple already-shipped components (`.mt-player .n b`, `.tm-hero-low`, `.ch-vs`/`.ch-team`, `.mt-title`/`.mb-d2`) have no overflow/ellipsis guard, while the fix already exists and is proven in `.mb-match__title` a few lines away in the same stylesheet.

**Risks of over-redesigning** (explicit, per the mandate's own warning): do not touch Create Match's format/details steps (independently re-verified as the correct reference, not the benchmark), do not unbundle Challenges' unified sender/receiver Detail screen into 5 separate routes (the architecture is sound — the benchmark's richer content should be *restored inside* the existing branches, not used as a reason to fork the component), do not build a tournament screen or a native chat screen (both explicitly out of V1 scope, confirmed against `BUSINESS_RULES_V1.md §23` and zero supporting `packages/core` domain model), do not pre-build a 4-tier privacy picker or a Créer-flow venue picker ahead of the shared data model both actually depend on.

---

## 2. Design standard — confirmed, not reinvented

Every color/type token the benchmark uses was cross-checked against `design/moubarat-ds.css` and matches exactly: `--primary:#FF2B00`, `--gold:#F2B705`, `--ink:#050505`, Bebas Neue (display) / IBM Plex Mono (technical labels/tags) / Barlow (body). **Do not adopt the benchmark's own local iframe-scoped variable names** (`--text-muted`, `--gold-2`, `--danger:#FF3B30`) — several are stale (moubarat-ds.css deliberately moved `--danger` to `#FF8A7A`, 8.9:1 contrast, specifically because the old value was "a second red, indistinguishable next to `--primary`" — the benchmark still carries the old value in its own iframe `:root` blocks). Always resolve color through the real, frozen token file.

**"Mêmes règles → différentes compositions intelligentes"** — confirmed as the correct operating principle throughout this audit, and given a concrete per-screen character assignment wherever a screen was found (see each screen's `recommendedFinalDirection` in §5-§11 for the specific character call). Do not homogenize screens into one generic list-of-cards look. Representative assignments already established:

| Screen | Character |
|---|---|
| Home | action-oriented — hero + two CTA rectangles stay visually dominant |
| Explorer | discovery-oriented — denser, filter-forward, browsing-first |
| Terrain Detail | decision-oriented — confidence-building before commit |
| Terrain Slots | configure & commit, full price transparency |
| Terrain Confirm | reassurance + pivot (the one "celebratory" moment in Booking) |
| Create Match (sport/when/slot) | decision-oriented gates |
| Create Match (format+details) | decision-oriented → identity-oriented (naming the match) |
| Create Match (review/confirm) | the flow's one deliberate "final check" beat — do not cut |
| Match Detail | decision-oriented (join or not) |
| Mes Matchs | personal commitment ledger — "mine," reuses Match Card language |
| Team Detail | identity-oriented — should lead with crest/photo/win-rate, not a member-management form |
| Profil | personal — Aymen's own dashboard, not a new sub-app |
| Défi compose | builder, not decision-moment |
| Défi reçu | decision-oriented (Match-Detail-adjacent) |
| Défi envoyé | tracking-oriented (needs restoring, see §9) |
| Défi refused/expired | quiet, respectful closure — not celebratory, not silent either |
| Notifications | calm, dense, scannable triage — Défis/Result cards the one deliberately louder element |

**A4 (open QA anomaly — name truncation on short blocks) is this pass's named top priority** (`QA_PHASE12_REGISTRE.md`: *"chasse au « generic AI UI », A4 en tête de liste"*). The fix already exists and is proven: `.mb-match__title` in `design/moubarat-ds.css` (`white-space:nowrap; overflow:hidden; text-overflow:ellipsis` inside a `minmax(0,1fr)` grid track). Confirmed **currently missing** on, at minimum: `.join-body .n`/`.hero-loc`/`.around-name`/`.result-card .n`/`.match-result-row .n`/`.stade-pick-body .n` (all not-yet-built Discovery screens, would inherit the gap on build), `.mt-player .n b` (Match Detail, shipped), `.tm-hero-low`'s team name (Team Detail, shipped), `.ch-vs`/`.ch-team` team names (Challenges, shipped — directly demonstrable today with the seeded "Sporting Bab Ezzouar," 21 characters), `.mt-title`/`.mb-d2`/`.mt-frame b` (Create Match confirm/review, shipped), `.defi-row-item .n` (Notifications, not built). **Apply `.mb-match__title`'s exact pattern everywhere a name/title renders, as a blanket rule, not a per-screen patch.**

**Tap targets**: `--tap-min:44px` is correctly honored by `.mb-btn`/`.mb-field__control` but **`.mb-chip` is hardcoded to `min-height:34px`** — a live, already-shipped violation hitting every chip-based control app-wide (SlotPicker's day/duration chips — the primary controls on the busiest flow in the app — plus Auth, Match format/level/visibility, Challenges stake/tabs, Booking sport/day). This is a **one-line fix in the frozen `design/moubarat-ds.css`** (raise to `var(--tap-min)`) that resolves the gap everywhere simultaneously. `.au-back`/`.bk-back`/`.mt-back` (36px, three duplicate definitions of the identical rule) have the same gap and the same one-line-fix opportunity once consolidated (see §7).

**Icon budget**: the 37-symbol frozen `design/sprite-icons.svg` is close to fully sufficient. Confirmed gaps: no heart/favorite icon (Explorer/Résultats Terrains "save" affordance), no lightning-bolt equivalent for a "Défier" CTA (use `i-whistle` instead — reads more Moubarat-native than inventing a new symbol), `ic-calendar2` referenced but never defined in the benchmark's own tournoi-detail screen (not relevant since that screen is out of scope). Everything else needed across all 35 screens already exists in the frozen sprite.

**Zero-emoji rule**: violated repeatedly in the benchmark (📍/⚽/🎾/🏀/🔍/⏳/😄/🔥/👑/🎯) — all have real sprite equivalents except three Profil badge icons (fire/crown/target), which need an explicit substitute decision. The real, shipped screens are already clean of this — do not introduce it while porting benchmark content.

---

## 3. Discovery layer — Home, Explorer, Search, Filters, Results (7 screens, none built)

**Status**: nothing in this cluster exists in `apps/player`. This is the largest single missing surface and the one every other "browse/discover" reference (venue choice in Booking and Create Match, team discovery for Challenges) ultimately depends on.

**Cross-cutting findings** (fix once, not per-screen):
1. **The benchmark independently reinvented 4 incompatible match-card classes** (`.join-card`, `.around-card`, unstyled search cards, `.match-result-row`) and 3 terrain-card classes (`.venue-card`, `.terrain-card2`, `.result-card`) — exactly the fragmentation `design/moubarat-ds.css §4.6`'s own comment already anticipated and solved (*"MatchCard : UN composant... Remplace les trois listes concurrentes (explorer / search / résultats)"*). Build every match list here on `.mb-match`/`.mb-match--rail`, never a new bespoke class.
2. **Level taxonomy (§24-A) is already broken inside the benchmark itself** — Home/Explorer's Terrains tab correctly use LOISIR/INTERMÉDIAIRE/COMPÉTITION (matching frozen `SkillLevel`), but Explorer's Matchs tab, Filtres Matchs' Niveau section, and Résultats Matchs' result rows all use "Débutant"/"Avancé" — values that don't exist in core. This is code-verifiable, not a style nitpick, and must not be wired to real data until Aymen ratifies §24-A (see §11).
3. **Five Stadium is tagged 🎾 PADEL on Home and "Football · Synthétique" on Résultats Terrains** — same venue, two different sports, same benchmark file. Direct evidence for needing one canonical venue/field data source (not per-screen hand-authored data).
4. Zero-emoji violations throughout (📍⚽🎾🏀🔍) — all have real sprite equivalents already in the frozen icon set.
5. A4 truncation gap confirmed on `.join-body .n`, `.around-name`, `.result-card .n`, `.match-result-row .n` — `.mb-match__title` already solves this; consolidating onto it (finding 1) fixes A4 here for free.

**The single largest architecture gap**: `bookingDemo.ts` hardcodes `FIELD_ID='t1'` and one `VENUE` object. Home implies ≥3 venues; there is no way to represent a second one today. This blocks real content on every screen in this cluster simultaneously — design the Venue Card (§7) and its backing data model together, once.

### Home
Not started. **`BUSINESS_RULES_V1.md §16` explicitly freezes this screen's validated elements** — "the two main actions RÉSERVER and CRÉER... do not redesign validated Home elements without an explicit product decision." Confirmed in the benchmark: `.action-row2` holds exactly two rectangles, RÉSERVER (icon: pitch) and CRÉER (icon: group) — build faithfully, do not redesign. Preserve: the hero "prochain match" card, the avatar+gold-ring+OVR-badge treatment, the two-rectangle action row, the overall section rhythm.
- **Real gap, not a redesign question**: the avatar/OVR badge has no click handler anywhere in the benchmark's own script — wire it to Profil.
- **Real tension, flag don't silently resolve**: "Matchs à rejoindre" mixes sports (Padel, football, Basket) while `matchDemo.ts`'s own `SPORT_OPTIONS` marks only football available, with a comment stating Basket's absence is deliberate ("pas inventé"). **BUSINESS DECISION REQUIRED**: should Home surface joinable matches for sports the center can't yet let players book?
- `.join-btn` computes to ~25-28px tall (`padding:8px 12px` around 9px text) — below `--tap-min`. Must use `.mb-btn`/`.mb-tap` sizing when built, not literal benchmark padding.
- Build on `.mb-match--rail` for the hero + join-list + venue rail. Source the greeting from `identity.ts`, the hero card from the real `EXISTING_MATCH` fixture (don't invent new demo data).

### Explorer
Not started. 3-tab IA (Matchs default / Terrains / Équipes) matches `BUSINESS_RULES_V1.md §3` exactly. `.tm-crest` (already built for Teams/Challenges) is a direct reuse target for the Équipes tab instead of inline per-team gradient SVGs.
- **Dead button, confirmed**: the header search icon (`#ic-search2`) has no click handler anywhere in the benchmark's own script — only the filter icon is wired, despite Explorer's own tagline being "TROUVE TON TERRAIN. TON MATCH. TON ÉQUIPE." Direct violation of "no dead buttons."
- **Level-taxonomy drift within a single screen**: the Terrains tab and Matchs tab (same `.around-card` component) disagree with each other on level labels — a concrete, in-file instance of finding 2 above.
- **BUSINESS DECISION REQUIRED (F, privacy)**: the Équipes tab's "Équipes populaires" publicly lists other teams' OVR and roster size to any viewer — confirm this matches the intended privacy tiering before building.
- Build as a tabbed root with React state (not raw DOM class toggling per the benchmark). Terrains tab and Résultats Terrains should share one results-list component/data hook, same for Matchs tab / Résultats Matchs — this screen and the two results screens are one search experience with different entry filter-state, not three separate builds.

### Search Matchs
**Recommend not building as a distinct screen.** Verified: it's the thinnest, least-finished screen in the whole benchmark (literal placeholder "Match 0"–"Match 5" rows, no photos, no level, no join button — a real functional regression versus every sibling match-card in the same file). `design/moubarat-ds.css §4.6`'s own comment already names "search" as one of the three redundant lists `.mb-match` is meant to replace. Fold its one real entry point (Explorer's "Matchs autour de toi → voir tout") into Résultats Matchs directly. **BUSINESS DECISION REQUIRED**: confirm with Aymen whether this consolidation is acceptable (it is currently a real, wired node in the benchmark's navigation) or the lighter-weight entry point is deliberately wanted.

### Filtres Terrains
Not started. Most spec-complete screen in the cluster — matches `BUSINESS_RULES_V1.md §15`'s filter-dimension list almost exactly (location/radius, sport, price, equipment, minimum rating). Correctly omits match-level filtering (out of scope for a venue filter). Swap raw emoji sport chips for the real sprite icons (identical fix to Explorer). Make the price range slider and its two text boxes one live-synced control, not two disconnected representations. Share the Sport chip-group as one literal component with Filtres Matchs (benchmark markup is already byte-identical between the two).

### Résultats Terrains
Not started. The direct landing screen for Home's RÉSERVER CTA — on the critical path of the app's primary conversion. Results-count-row and active-filters-row directly satisfy §15's requirements and should become the canonical shared header, reused by Résultats Matchs too.
- Fix the Five Stadium sport contradiction (finding 3) at the data-model level.
- The back button is hardwired to `nav('explorer')` regardless of entry point, but Home's RÉSERVER also lands here — a user backing out from Home would unexpectedly land on Explorer. Resolve via real router history, not a hardcoded target.
- **BUSINESS DECISION REQUIRED**: canonical per-venue sport/field catalog needed (same root cause as finding 3).

### Filtres Matchs
Not started. Correctly scopes level filtering to matches only (never appears on Filtres Terrains), matching §15's "match level where relevant" phrasing exactly. **The single most concrete, code-verifiable instance of Open Decision A found in the whole audit**: the Niveau section offers Débutant/Intermédiaire/Avancé — neither "Débutant" nor "Avancé" exists in frozen `SkillLevel`. Cannot be wired to real data until §24-A is ratified. Format options (5v5/7v7/11v11) skip 6v6/8v8, which are real, valid `FORMAT_CAPACITY` values — confirm whether this 3-of-5 curation is deliberate. "Places disponibles" tiers map cleanly and directly to `capacity - activePlayers(players).length`, already exported from `match-flow.ts` — buildable today once wired to real data.

### Résultats Matchs
Not started. `.match-result-row`'s layout is structurally almost identical to `.mb-match`'s already-built grid (60px time column + body column) — build directly on the real component instead of reinventing it. Level values in sample rows include "Avancé" (invalid) — same §24-A conflict, now visible in result CONTENT, not just filter options, meaning the result template must be corrected in lockstep with the filter. Sort-chip copy ("PLUS PROCHE" here vs "TRIER : PROXIMITÉ" on Résultats Terrains) should be unified. Introduces a 4th venue name ("Mustapha Foot") never seen elsewhere — **BUSINESS DECISION REQUIRED**: confirm deliberate catalog breadth vs. data inconsistency (cross-reference: "Complexe El Biar" and "Stade de Birkhadem" recur pervasively across Explorer/Create-Match/Mes-Matchs/5 Challenge screens, which actually strengthens the case for one canonical venue catalog).

---

## 4. Create Match — complete UX specification (Priority #1, 6 screens)

**This cluster received the deepest treatment in the audit**, per the explicit mandate: a screen-by-screen structural comparison plus a systematic 8-scenario audit (A-H) with a decisive ideal-flow proposal. Read together, they resolve every open question the original build session carried.

### Verdict: gain the manual-entry path now; do not gain a venue-choice step yet

The current 5-6 step real flow (sport → when → slot/format → format → details → review/confirm) is the right proportionate size for a single-venue pilot. It should grow by exactly **one** new path (manual/external booking) before it grows by a venue dimension.

### Finding 1 — the manual-entry screen (benchmark's `creer-manual`) is the single most important gap in the whole audit

**✅ RÉSOLU (partiellement, cf. `docs/DECISIONS.md` Lot 1) — nouvel écran `declare`**, réutilisant `SlotPicker` + `registerExternalBooking()` (prix via `quoteRange`, jamais saisi à la main, exactement l'exigence ci-dessous), plus la réservation Moubarat existante proposée comme rangée tapable si elle existe (b1+b2). Limite assumée : la vérification de conflit ne porte pas sur un vrai historique persisté (`apps/player` n'en a aucun aujourd'hui) — voir le détail dans DECISIONS.md. Aucun redesign visuel (hors lot).

`packages/core` **already fully implements** "declare a phone/walk-in reservation" end-to-end, and **none of it is wired to any `apps/player` screen**:
- `Booking.source: 'MOUBARAT'|'PHONE'|'WALK_IN'|'CENTER'`, comment: *"PHONE : «j'ai déjà réservé par téléphone» (déclaré par le joueur, à vérifier)"* (`entities.ts:110-115`)
- `Booking.reservationName?`/`verifiedByCenter` (`entities.ts:118-120`)
- `NotificationType 'EXTERNAL_BOOKING_TO_VERIFY'` with real copy already written (`notify.ts:78`)
- `registerExternalBooking()` (`booking.ts:36-49`) — doc-comment literally reads *"Chemin B — «J'ai déjà réservé par téléphone»"*
- `prepareBooking()` (`booking-flow.ts:16-83`) — accepts source/reservationName, computes `verifiedByCenter`/`notifyCenter` correctly
- `createMatch()` never checks `verifiedByCenter` — only `isBlocking(booking)` — **nothing in the rules layer blocks this. The gap is 100% UI.**

The real "when" screen's own subtitle already promises this ("réservé — en ligne ou par téléphone," `MatchFlow.tsx:264`) without delivering it. Meanwhile `match-flow.ts`'s own header comment scopes "Path B" as *"réservation existante, y compris téléphonique"* — the currently-built `chooseBookingB()` quietly repurposed that name for a different scenario (auto-selecting one pre-verified booking) and never built the phone-declaration case the name originally meant.

**Fix**: build MatchFlow's real "chemin B" (reclaiming the name), calling `prepareBooking({source:'PHONE', reservationName, ...})` then `createMatch()` unchanged. Split into two real sub-cases: (b1) list the player's own unlinked Moubarat bookings as real selectable rows if any exist; (b2) offer "déclarer une réservation externe" — sport + venue (dropdown of known partner venues) + date/time/duration, with **price derived from the venue's real rate via `quoteRange`, never typed by hand** (the benchmark's own form contradicts itself here — a typed "Prix par joueur" field conflicts with `match-flow.ts`'s frozen *"jamais saisi à la main"* rule, and its own later `creer-config` screen shows a read-only computed price instead).

**BUSINESS DECISION REQUIRED**: (1) confirm `prepareBooking(source:'PHONE')` vs a free-typed price for a genuinely off-platform venue — the benchmark's single form conflates two different real cases; (2) confirm reclaiming "chemin B" naming to avoid two different scenarios both being called "Path B" in the codebase.

### Finding 2 — venue choice (benchmark's `creer-stade`) should NOT be built inside Create Match

`matchDemo.ts`/`bookingDemo.ts` are both anchored to exactly one field — there is nothing real to choose between today; the benchmark's 4 venues are invented for the mockup. Building a picker here now would either decorate fictional data (the benchmark's sport pill-toggle doesn't actually filter venues, and offers Basket as normal though no real venue supports it) or fork a second, divergence-prone venue list later. **Multi-venue browsing belongs to Explorer** (§3) — Create Match should consume whatever venue list Explorer ends up owning, mirroring the codebase's own precedent of extracting `SlotPicker` specifically so pricing has "une seule implémentation... pas deux qui peuvent diverger." **BUSINESS DECISION REQUIRED**: confirm V1 stays single-pilot-venue scoped for Create Match until Explorer/Terrains ships.

### Finding 3 — the other 4 real steps substantively surpass the benchmark

Real format selection is always bound to `FORMAT_CAPACITY`/`FIELD.formats` (the benchmark's freeform "up to 22 — 11v11" stepper could produce an illegal format/capacity pair T1 can't host). Real pricing runs through the same `quoteRange`/`SlotPicker` pipeline as Booking, showing real peak/off-peak bands the benchmark's flat total doesn't. Real "details" captures Nom du match + Description with no benchmark equivalent at all. **Do not "fix" these toward benchmark parity.**

Two adoptable ideas regardless: a "Mon équipe" bulk-invite share option on confirm (Team/TeamMember already modeled, cheap to wire — needs a notification-mechanism decision, see §11); a reassurance banner naming the "arrived via an existing booking's shortcut" entry variant (see Finding 4).

### Finding 4 — a real, unwired shortcut exists on Booking's own confirmation screen

**✅ RÉSOLU — Lot 1 fondations (26/08/2026), voir `docs/DECISIONS.md`.** `Route['match'].prefill` transporte le vrai `Booking` confirmé (même construction que `cancelProof()`) ; `MatchFlow` atterrit directement sur "format" avec la vraie référence/le vrai créneau/le vrai prix. Vérifié en direct de bout en bout.

`terrain-confirm`'s "CRÉER UN MATCH SUR CE CRÉNEAU" pivot exists and navigates, but `App.tsx` wires `onCreateMatch` into `MatchFlow`'s very first step (`initialScreen="sport"`) with no way to carry venue/field/date/time across. The mechanism to fix this already exists in the same file: `chooseBookingB()` sets `resolvedBooking`/`resolvedLabel`/`resolvedRef` and jumps straight to `'format'`, skipping sport/when/slot — thread `BookingFlow`'s proof state through the same mechanism rather than building something new.

### Entry-scenario audit (A-H) — verdict per scenario

| # | Scenario | Handled today? | Verdict |
|---|---|---|---|
| A | No reservation | Yes | Real, SlotPicker-driven. Gap: no venue/field choice (see Finding 2). Don't build a second picker — extend SlotPicker's own shared-reuse pattern once venue data exists. |
| B | Already has a reservation | Yes, but thinly | Not actually a list — one silent auto-selection of a hardcoded booking. See Finding 1 for the real fix. **✅ Résolu, Lot 1 (26/08/2026)** — real `declare` screen, see Finding 1. |
| C | Different sports | Yes, football-only in practice | Core is fully ready (`SPORT_FORMATS` has Padel/Basket); it's a fixture-data gap, not a rules gap. Home's benchmark content already assumes multi-sport — a sequencing question, not a new rule. |
| D | Different formats | **Yes — a verified strength, close this as resolved.** | `FORMAT_OPTIONS` never hardcoded, guarded by `validateFieldFormats()` at load time, independently re-confirmed correct and tested twice over (this session's original hardening + this audit). |
| E | Different capacities | **No — corrects the audit's own working hypothesis** | Real gap. `CreateMatchInput.capacity?` is explicitly overridable and `validateCapacity()` already accepts 2..max — only the UI refuses to offer it. The benchmark's stepper independently wants exactly this (max value = real `FORMAT_CAPACITY['11v11']`, not invented). **BUSINESS DECISION REQUIRED (D)**: ratify "organizer may reduce capacity below the format's full roster, never above it" before building. |
| F | Different levels | Yes, mechanically correct | `LEVEL_OPTIONS` is a direct 1:1 map of `SkillLevel` — cannot drift. **§24-A is still formally "open" in the docs despite triple (core/real-UI/benchmark) agreement** — recommend Aymen explicitly ratify it; this is a documentation action, not an implementation gap. |
| G | Public/private | Yes | Two-value toggle, correctly wired. Important nuance: `canJoinMatch()` has **no visibility check at all** — PRIVATE is a discoverability control today, not an access gate (anyone reaching a PRIVATE match via its WhatsApp link can still join). Confirm this is intended. **BUSINESS DECISION REQUIRED (F)**: §24-F names 4 privacy tiers; the frozen type only has 2 — flagging so a future §24-F resolution doesn't surprise this screen. |
| H | Match from an accepted challenge | Yes, but bypasses booking integrity | `acceptChallenge()` never validates availability (no `canReserve()`/`isBlocking()` call anywhere in its real callers), hardcodes `title:'Défi entre équipes'` (never the two team names), hardcodes `level:'COMPETITION'` regardless of the challenge's own `stakeKind`, and `pricePerPlayer` is always exactly 0 DA with no real reservation ever created to make that number eventually correct. **The most serious data-integrity finding in this cluster.** **BUSINESS DECISION REQUIRED**: should accepting a challenge require/create a real Booking with the same guarantees every other match gets? **✅ RÉSOLU, Lot 1 (26/08/2026)** — decision ratified by Aymen: `acceptChallenge()` signature changed to accept a real caller-validated `Booking` + `title` (via new `challengeMatchTitle()`), wired through `createBooking()` at the real callers (API route, `ChallengesFlow.tsx`, demo fixtures). Real price/title/booking row now, never 0 DA / generic title. `level:'COMPETITION'` hardcoding not addressed (separate from booking integrity) — see `docs/DECISIONS.md`. |

### Decisive ideal-flow proposal

**Structural decision**: the flow should both *gain* steps (venue/field discovery, a real external-booking declaration) and *lose* steps (merge sport into discovery, merge format+details into one Configure screen) — net screen count goes down while real capability goes up.

```
TODAY   Path A: sport → when → slot → format → details → review → confirm  (7)
        Path B: sport → when → format → details → review → confirm         (6)

PROPOSED (both paths start at one Fork — "As-tu déjà réservé ?", unchanged copy/pattern, moved first):
        Path A: Fork → Discovery → Configure → Review → Confirm  (5)
        Path B: Fork → Declare    → Configure → Review → Confirm  (5)
```

- **Why sport moves out of its own screen**: today's standalone step gates venue/field choice behind a decision the player can't yet evaluate. Discovery's top section becomes a sport pill-row (enabled only where a real nearby field supports it) with venue cards below — this is explicitly shared capability with Booking/Explorer, not a Create-Match-only artifact.
- **Declare** (replacing `chooseBookingB()`): check the player's own unlinked bookings first, list as real rows; else fall through to the manual form backed by `registerExternalBooking()` (Finding 1).
- **Configure** (merging today's format+details): format chips unchanged (verified strength) → optional capacity stepper under the chosen format (gated on the §24-D ratification above) → level chips unchanged → title field **pre-filled with a generated default** ("Football 5v5 · Complexe Ryad · 18h00") the player can overwrite → description unchanged → visibility chips unchanged. Keep clear visual subsections, not one undifferentiated form-dump (directly answers `VISUAL_REFINEMENT_STRATEGY.md §11`'s "generic AI UI" warning).
- **Review and Confirm**: keep exactly as built — no benchmark equivalent exists at all, and the review step was independently self-scored 9/10 on every axis after live end-to-end testing. Cutting it to match benchmark screen count would optimize for the wrong thing.
- One more low-risk addition: give `mymatch` a "Modifier l'horaire" control wired to `canOrganizerAct(..., 'EDIT_TIME', ...)` — the guard already exists and is already tested, only the UI button is missing.

**What ships immediately, no dependency**: the Declare screen, the Configure merge, the pre-filled title default, the EDIT_TIME button — all touch only `matchDemo.ts`/`MatchFlow.tsx`. **✅ Lot 1 shipped the Declare screen and the pre-filled title default** (minimal, non-Premium versions — see Findings 1 and above, and `docs/DECISIONS.md`). The Configure merge (format+details → one screen) and the EDIT_TIME button remain open — visual/structural work explicitly deferred to the Premium session.

**What's gated on shared work**: Discovery (venue/field choice) — should not be built twice, once bespoke for Create Match and once "for real" later for Booking/Explorer.

**Explicitly out of scope**: no tournament-creation branch of any kind (confirmed: none of the 6 benchmark Create Match screens link to `tournoi-detail`; the "mini-tourn-card" CSS class name is a reused generic photo-card style, not a functional tie). No pre-publish selective-invite picker (post-publish WhatsApp sharing is the correct V1 mechanism). No 4-tier privacy picker until §24-F is decided.

**Before building, ratify with Aymen** (do not silently decide): §24-D (sub-max capacity), §24-A (level taxonomy, plus the AMICAL-challenge-tagged-COMPETITION ambiguity from scenario H), and the new challenge/booking-integrity question from scenario H (a core/API fix, not a screen change, but should not ship silently unaddressed).

**A4 note for this cluster**: `.mt-frame`'s fixed `1fr 1fr` grid (review/confirm/detail) has no `white-space`/`text-overflow` rule on `.mt-frame b` and has not been visually verified against a 40-character title (the real maximum `createMatch()` itself validates) — needs a real-content pass, not a rebuild (it won't silently clip since no `nowrap` is set, but could break the tidy grid look).

---

## 5. Booking / Terrain flow (3 screens, all built — the most solid cluster)

All three screens classify **B (Refine)**, never C/D — real core-driven pricing throughout (`quoteRange`/`rateAt`/`canReserve`/`registerExternalBooking`/`canCancelBooking` genuinely called), no invented rules, no fabricated statistics. Gaps found are small-to-medium effort, not structural rebuilds.

**Cross-cutting**: status-color semantics correctly applied everywhere (including the non-obvious case: an unverified phone booking = gold/vigilance, not red). `.mb-chip` (34px) and `.bk-back`/`.au-back` (36px) both under `--tap-min:44px` — same frozen-DS fix as §2. A trivial `overlaps()` helper is duplicated verbatim between `BookingFlow.tsx:23-25` and `SlotPicker.tsx:10-12` — export it from SlotPicker instead.

### terrain-detail
B. Real strengths beyond the benchmark: sport/field chips, a 2×2 rate grid showing both off-peak and peak pricing (more transparent than the benchmark's single headline rate), a real Path-B phone-booking entry point wired to `registerExternalBooking()`. **Main fix**: no sticky CTA — the benchmark's price bar stays pinned via `position:absolute;bottom:20px`; the real screen's CTA is pushed only by a flex spacer and will scroll out of view once real content (equipment grid + rates grid + policy text) exceeds one viewport — on a product whose own strategy doc calls RÉSERVER/CRÉER "particulièrement importants." Do NOT add a payment-method selector (V1 is cash-only per §7 — the benchmark's pay-option pattern is arguably over-built for an already-decided question). **BUSINESS DECISION REQUIRED**: a venue-review system — both benchmark and real screen display a star rating as if reviews exist, but no venue-review entity/rule exists in core.

### terrain-slots
B, `benchmarkVerdict: surpasses`. SlotPicker's real per-band pricing (peak/off-peak, live per slot) is genuinely richer than the benchmark's flat per-duration total. **Main gap**: no field/court choice within a venue — `core.Field` already models `indoor:boolean` and per-field formats, only the demo fixture is thin. No empty-state message for zero available departures (the code path exists, the message doesn't). **Recommended fix**: add a field selector as a new `.bk-row` of chips between day and duration pickers, driven by a real `fields[]` array — a small, contained extension to SlotPicker's existing props, not a rebuild.

### terrain-confirm
B, `benchmarkVerdict: underperforms`. **See §0 — the `cancelProof()` bug lives here and should be treated as higher priority than this screen's other findings.** Beyond that: real strengths the benchmark lacks entirely (itemized proof card, real cancellation-policy transparency, an actual "Annuler la réservation" action). Missing: success checkmark icon (reuse `.mt-check`, already built and used elsewhere for exactly this moment), a real return-to-Home path (blocked on the nav-shell gap, not fixable in isolation), and — near-zero effort — "Partager sur WhatsApp" is currently a non-functional toast stub even though the real `whatsappShareUrl`/`matchShareText` utilities are already used correctly one file over in `MatchFlow.tsx`. **The create-match-pivot prefill wiring described in Create Match Finding 4 belongs here too** — it's the single most concrete, well-understood fix in this cluster.

---

## 6. Match Lifecycle (5 screens — 1 built as B, 1 substitute-mechanism, 3 not started)

**Six things recur and should be fixed once, centrally**:
1. `.mb-match` — fully built, zero usages anywhere (`grep -r mb-match apps/player/src` → 0 hits). Both Mes Matchs tabs should be built on it directly, turning two "design from scratch" screens into "wire real data into an existing component" screens. **✅ Premier vrai consommateur, Lot 1 (26/08/2026)** — Home + Mes matchs (`DiscoveryTabs.tsx`), voir `docs/DECISIONS.md`. Le reste du périmètre (Explorer, Résultats) reste ouvert pour la session Discovery.
2. Chat-vs-WhatsApp: the benchmark leaks "Chat du match" language (a full banner + fake transcript in `match-confirm`); native chat is explicitly V2 (`entities.ts` comment, `BUSINESS_RULES_V1.md §11`). The real app already gets this right everywhere — keep following it, not the benchmark.
3. Status-color drift: benchmark colors "Complet" red-tinted; the real, frozen `.mb-status--full` is neutral gray (same family as `--locked`, deliberately not alarming). Pull colors from `.mb-status--*` only, never re-derive from the benchmark's local tokens.
4. No entry point anywhere, system-wide — `App.tsx` has no bottom nav, and `MatchFlow initialScreen="sport"` currently means the JOIN flow (`screen==='detail'`) isn't reachable through the live app at all today.
5. `tournoi-detail` is correctly out of scope (§23) — but the benchmark's own Mes Matchs "à venir" list mixes a tournament row into the plain match list with no distinct treatment. Keep tournament content out of Mes Matchs entirely until §23 is lifted.
6. Join-vs-create confirmation asymmetry (screen vs toast) is a **defensible, deliberate** difference (creating is a heavier commitment), not an oversight — see Match Confirm below for the actual recommendation.

### Match Detail (join a match)
B, `benchmarkVerdict: matches`. Real, working (`joinMatch`/`leaveMatch` genuinely called), and beats the benchmark on WhatsApp-correctness, provisional-OVR demonstration, and JS pluralization. **§16/§12 name this an "especially important reference" — do not redesign the fundamental structure.** Fixes: make the action zone sticky (same class of fix as terrain-detail), add `role="status" aria-live="polite"` to the join toast, add A4 truncation guards to `.mt-player .n b`. Do not adopt the benchmark's two-column layout — it's a desktop-simulated 365px frame, real single-column is more mobile-honest at true 360-390px widths.

### Match Confirm (dedicated screen)
**Recommend NOT building a dedicated full-screen confirm for V1** — this is a deliberate opinion, not benchmark-parity-seeking. The benchmark's version mostly re-displays information the player just read, then spends most of its space on the not-real chat feature (even the benchmark's own script never wires "OUVRIR LE CHAT DU MATCH" to anything). What the toast substitute already does — in-place roster update, always-present WhatsApp CTA — is the right-weight response to a single-tap action. Instead: add `aria-live` to the toast, give the cash-payment line a brief one-time visual pulse after joining, and if more ceremony is ever wanted, reuse the exact success pattern `MatchFlow.tsx` already built for the CREATE flow (`.mt-check` + recap `.mt-frame`) as an inline/expandable state on Match Detail itself rather than forcing a new route.

### Mes Matchs — À venir / Passés
Both not started, both **very high expected value** — two of five fixed bottom-nav destinations, currently zero code, zero entry point, and unusually cheap to close because the hardest part (`.mb-match`) is already fully designed. Build as a new `MesMatchsFlow`-style component (matching the existing per-domain pattern), local tab state (not the benchmark's full-navigation tab switch), filtered to the viewer's own `MatchPlayer` entries with status JOINED at play time (real-app-verified bug to avoid repeating: `MatchFlow.tsx`'s own `'mymatch'` screen has an incomplete ternary that silently mislabels a PLAYED/FULL match as "Annulé" — use an exhaustive switch over the full `MatchStatus` union). À venir needs an explicit tap-routing rule (organizer's own match → `'mymatch'`-equivalent, joined-only → `'detail'`-equivalent — nothing decides this today). Passés should add a result/score sub-line and a conditional "Noter ce match" CTA wherever `canRate()` would currently succeed — the cheapest way to finally exercise the fully-built, fully-tested 72-hour rating window from a real screen. **BUSINESS DECISION REQUIRED (B)**: §24-B still formally lists rating rules "open" though `rating.ts` already fully implements them (R1-R5, documented) — confirm ready to treat as resolved.

### Tournoi Detail
**Do not implement.** §23 lists tournaments under V1 exclusions, conditioned on "sufficient traction and enough formed teams" (§2) — a concrete bar, not a someday. `grep -ril tournament packages/core/src` returns exactly two cosmetic hits, no domain model. Rated only as a benchmark proposal (7/10 — well-composed, reusable if reintroduced later) per the audit's own instruction to rate what's proposed even when out of scope. Note: the benchmark's own registration CTA admits (via its own toast) that its multi-screen registration flow was never actually linked to this detail screen — integration debt on top of the missing domain model. **BUSINESS DECISION REQUIRED**: any reintroduction is Aymen's explicit call, gated on §2's stated condition; a 150 000 DA cash-prize figure shown in the benchmark would additionally need its own legal sign-off, adjacent to but distinct from the existing disabled challenge-stake decision.

---

## 7. Teams + Profile (2 screens — 1 built as C, 1 not started)

**Cross-cutting**: both screens independently display an **ungrounded "team OVR" figure (86)** with no backing in `computeOvr()` (a per-player-only formula) — the same already-declined pattern as "Fiabilité 82" (see `DECISIONS.md`'s Teams entry). Profil additionally shows Aymen's own personal OVR as 82 on the same screen — two different, unexplained numbers. **Resolve once, applied identically in both places**: real win-rate + forme récente (both zero-new-data derivations already computable via `outcomeFor()`/`winRateFrom()`), not a second invented single figure. Both screens also independently surface the still-open level taxonomy — share one formatting helper so a future §24-A resolution updates both automatically. Icon budget for this cluster is nearly complete (only 1 real gap: a lightning/"Défier" icon — use `i-whistle` instead).

### team-detail
**C (Restructure)**. Real strengths: zero-reimplementation core wiring across all 6 mutations (`invitePlayer`/`respondInvite`/`leaveTeam`/`removeMember`/`transferCaptaincy`), correct captain-only gating, the LAST_CAPTAIN block, real `ALREADY_MEMBER` messaging, stats genuinely derived via `outcomeFor()` (never hardcoded). Three real bugs were found and fixed live before this ever shipped (see `DECISIONS.md`).

**Why C, not B**: `BUSINESS_RULES_V1.md §8` describes ONE adaptive screen whose action row changes by viewer relationship to the team ("only eligible captains see the challenge action") — the current build only implements the captain-admin half. A non-captain member or an outsider arriving via Explorer has nowhere real to land.

**Restructure into one component with two compositions on the same data**: keep the existing `team` screen as the captain/member management composition (reuse `.tm-hero`/`.tm-stats`/`.mt-player`/`.mt-sec`/`.mt-actions` verbatim — this part is solid). Add an outsider-facing composition: replace the generic `i-shield` badge with a per-team monogram/color treatment (every team currently looks identical — the most direct "generic AI UI" risk in this cluster), add `winRateFrom()`-driven stats and a `.slice(-5)`-driven forme row, render recent match history on `.mb-match`'s own anti-truncation grid, gate a real "Défier cette équipe" CTA behind `canSendChallenge`/`isCaptain`. Cap the inline roster and add a "voir tout" path (real ceiling: `MAX_TEAM_SIZE=25`).

**A4, directly demonstrable**: `.tm-hero-low` is absolute-positioned with no top constraint and the name has no overflow guard — demo data ("FC Kahwa," 8 chars) never stress-tests this. **BUSINESS DECISION REQUIRED**: team-level reputation figure (see cross-cutting above); §24-A/§15 aggregation rule for "Niveau moyen" across members; §24-F whether team pages are publicly viewable; the benchmark's unlabeled outsider "+" button next to "Défier" has no defined meaning (a "request to join" flow doesn't exist in `team.ts` today — would be a new core rule, not a UI addition, if that's what it means).

### profil
**D — not started, but the benchmark proposal is unusually implementation-ready.** All 7 nouns `BUSINESS_RULES_V1.md §3` requires (identity, OVR, sport identity, teams, recent matches, ratings/badges, account/settings) are present as real sections in the benchmark, verified line-by-line. Every icon needed already exists in the frozen sprite. Core's OVR/rating machinery (`computeOvr`/`explainOvr`/`ratingSummary`) needs zero changes — it already produces exactly the numbers and empty-state copy this screen needs, and `.mb-ovr--provisional` already exists for the not-yet-computed state.

**Build a new `ProfileFlow.tsx` + `profileDemo.ts` pair, mirroring the `TeamsFlow.tsx`/`teamsDemo.ts` precedent exactly**: seed a plausible match/rating history for `CURRENT_USER_ID`, then derive every displayed number through real core calls (`outcomeFor`/`winRateFrom` for matches/wins/forme, `computeOvr`/`explainOvr` for the OVR badge with its provisional fallback, `ratingSummary` for "note moyenne" gated by its own `.visible` flag). Import `CURRENT_USER_ID`/`CURRENT_USER_NAME` from `identity.ts`, same single-source-of-truth discipline already established for Teams.

Fixes needed in the benchmark content before porting: replace the native `alert()` settings placeholder with the app's established toast pattern (already used consistently everywhere else, including in TeamsFlow); replace 3 of 4 emoji badge icons (only trophy has a clean sprite equivalent); the benchmark's own headline stats (24 matchs / 16V / 8D, implying 0 draws) don't reconcile with its own "forme récente" row showing a drawn match two cards down — deriving every number from one real pass over one outcomes array (as `teamsDemo.ts` already does) prevents this by construction; add the 4 missing empty/threshold states (OVR, note moyenne, zero-teams, zero-matches) using primitives that already exist (`.mb-ovr--provisional`/`.mb-note`/`ratingSummary().visible`). **BUSINESS DECISION REQUIRED**: "Rôle préféré"/"Style de jeu" fields have no home in the frozen `Profile` entity — extend it (needs sign-off, same category as the `Match.description` amendment already made this session) or drop them; §24-A/F as above.

---

## 8. Challenges — Core objects (4 screens, all built as B)

All four screens are real, tested, core-driven — `canSendChallenge`/`newChallenge`/`canRespond`/`acceptChallenge`/`rejectChallenge`/`cancelChallenge`/`expireChallenges`/`challengeInbox`/`timeLeftLabel` all genuinely called, never reimplemented. The 4 bugs `DECISIONS.md` already records as found-and-fixed this session were independently spot-checked and confirmed still fixed — not re-flagged here.

**Single biggest lever**: `.tm-crest`/`--sm` renders every team, everywhere in this cluster, as the identical generic outlined shield — confirmed by reading `Icon.tsx` (a bare `<use>` wrapper with zero color logic). Since Compose's opponent picker, Detail's `ch-vs`, and Inbox's `ch-row` all reuse this one class, **fixing it once (deterministic accent color + initials from team id/name) upgrades all four screens simultaneously** — the most direct, concrete answer to "does this look unmistakably like Moubarat?" for this whole cluster. **◐ PARTIELLEMENT RÉSOLU, Lot 1 (26/08/2026)** — monogramme 2 lettres (`teamInitials()`) livré sur les 6 points d'appel réels (Teams, Challenges, Profil). L'accent-couleur-par-équipe volontairement **pas** construit : `--gold` est documenté « OVR, badges, distinction. Rien d'autre. » dans le design system gelé, une rotation de couleurs par équipe risquait la collision sémantique. Reste une décision ouverte pour la session Premium si une couleur par équipe est toujours voulue (voir `docs/DECISIONS.md`).

**Second finding, answers the audit's central architecture question**: the unified Detail screen (one component, `isSender` branch) is a faithful port of the *older*, lower-priority `prototypes/app/challenges.html` — but the newer, higher-priority benchmark shows meaningfully more per-state differentiation than that older source did (défi-envoyé drops the crest header for an envelope motif + a 4-step timeline; défi-recu keeps the crest and adds the opponent's quoted message). **The fix is restoring that richness inside the existing branches — not splitting the screen back into two.** See §9 for exactly what to restore.

**Venue/terrain is never surfaced anywhere until after acceptance** — Compose has no venue picker, Detail shows Format/Créneau/Enjeu only. This is the same root architecture gap as Create Match Finding 2 — resolve together, not twice. Direct consequence: `FIELD.formats` caps Compose at 8v8, making 11v11 (a real, core-recognized format) structurally unreachable.

**The benchmark's monetary-stake UI (live "Mise" toggle + amount field) directly contradicts `STAKE_AMOUNT_ENABLED=false` and §9/§23.** The real app correctly excludes it with well-written disabled-copy that is itself a verbatim, already-correct port. **This is the one place in the whole audit where the priority-1 visual benchmark should be explicitly disregarded in favor of the business-rule sources — flag clearly so it is never "fixed" by copying the stake UI back in.**

### defi-form (Compose)
B. Keep the architecture exactly as built (one scrollable screen: opponent→format→slot→enjeu→message — correct "builder" character, contrast with défi-recu's "decision" character). Two concrete upgrades: real per-team crest identity (propagates to 3 other screens for free); a lightweight persistent "Tu défies {opp.name}" confirmation once an opponent is picked, so the choice stays visible while scrolling. Leave the disabled-stake section exactly as-is. **BUSINESS DECISION REQUIRED**: venue/terrain selection when composing (same as above).

### defi-envoye (sender, pending)
B. **This is the concrete evidence for the audit's central question**: the shared DATA fields are correctly unified; the sender-specific EMOTIONAL register (structured "your challenge is progressing" reassurance) was flattened by the port. Fix: when `status==='PENDING' && isSender`, replace the bare status tag with a small 3-step status list (Envoyé → En attente de réponse → [outcome]) built from existing primitives (`.mb-tag` + `.mb-status` dot styling) — no new component needed. Correctly, already MORE correct than the benchmark on one point: "Retirer le défi" is styled `mb-btn--danger` (real `--danger` token) where the benchmark uses the same neutral ghost style for both "cancel" and "view team" — a real benchmark inconsistency, don't import it.

### defi-recu (receiver, pending)
B. Closest of the two Detail states to the benchmark already (crest header, message shown, binary CTA). One real upgrade: add an attribution line under the quoted message (`— {opp.name}`) so it reads as a specific rival's voice, not an unlabeled note — the cheapest, highest-payoff way to lean into this screen's correct decision-oriented character. "Refuser" uses neutral gray where the benchmark uses red-outlined — flagged as a genuine, considered design question (refusing isn't inherently "dangerous" the way withdrawing your own challenge is), not a bug — confirm rather than silently change.

### mes-defis (Inbox)
B, `benchmarkVerdict: surpasses`. **Do not chase benchmark parity here — the real screen is the stronger artifact.** Real tab switching backed by `challengeInbox()`, live counts in the tab label, real empty states, a captain-gated create CTA — none of which the benchmark's own version actually has (direct read confirms it's a largely static mock: "Envoyés" hardcoded active, "Reçus" tab click just navigates to a different screen instead of showing a list). Real upgrades: the shared crest fix; replace the `.mb-chip` pair used as tabs with a proper segmented control (worth building as a new shared primitive — Explorer's 3-tab and Mes Matchs' 2-tab needs will want the identical pattern). **BUSINESS DECISION REQUIRED**: this screen's entry point — the canonical bottom nav has no "Défis" slot at all; decide access via Team Detail's challenge action + a future Notification Center, a Profil sub-destination, or a new affordance.

---

## 9. Challenges — Outcome screens (5 screens, all built as B)

**Pattern across all 5**: the benchmark consistently gives the ÉMETTEUR (sender) a richer treatment than the RÉCEPTEUR on both the accept and refuse pairs — a "Statut du défi" timeline with dated steps, and (on the negative side) a forward "DÉFIER UNE AUTRE ÉQUIPE" retry CTA. The real unified screen currently flattens almost all of this — the `isSender` branches differ by little more than a pronoun.

**Two technical facts should govern the fix, in this priority order**: a "sent → resolved" timeline is **100% buildable today with zero core changes** for ACCEPTED (`challenge.createdAt` + `match.createdAt`, both already read) and EXPIRED (`challenge.createdAt` + `challenge.expiresAt`, both already on the entity) — but **NOT buildable** for REJECTED/CANCELLED, because neither `rejectChallenge`/`cancelChallenge` capture a response timestamp and `Challenge` has no such field. Sequence accordingly.

### defi-accepte-recepteur / defi-accepte-emetteur (same underlying 'match' screen)
Both B, `benchmarkVerdict: surpasses`. Real strengths beyond the benchmark: real traceability (Visibilité/Créneau/Terrain/Origine + real roster), a genuinely working WhatsApp CTA where the benchmark's own "chat" button is an admitted stub, correct stake-amount omission.

**Two guaranteed-wrong, demo-default-visible bugs, fix immediately (pure client-side, no core changes)**:
1. The WhatsApp share text will **always** read "0 DA / joueur" — `acceptChallenge()` hardcodes `pricePerPlayer` to 0 by design ("se répartit à la réservation," but no reservation is ever created) and nothing reprices before the share text is built. Gate the price clause on `amount > 0`.
2. "Le résultat de ce match comptera pour le classement" is shown **unconditionally**, never checking `stakeKind` — the seeded demo challenge is itself `AMICAL`, so this false ranking claim is visible on first load with zero interaction. Gate on `stakeKind === 'CLASSEMENT'`.

Add an entrance beat (reuse `.mt-check`'s existing pop-in circle — the benchmark stages a 72px checkmark before any details; the real screen drops straight into content). Add A4 overflow guard to `.mt-title`/`.mb-d2` (directly demonstrable with the seeded 21-character opponent name). **Sender-specific addition**: a compact 2-point "Défi envoyé → Match confirmé" recap using the already-fetched `createdAt` dates — restores the one genuine informational loss this audit's central question was aimed at, at effectively zero cost. **BUSINESS DECISION REQUIRED**: should `stakeKind` actually affect ranking (it's currently unused anywhere in core outside its type declaration — AMICAL and CLASSEMENT are treated identically end-to-end today, making the Compose-time choice currently cosmetic)?

### defi-refuse-recepteur
B. Perspective-correct copy confirmed (fix #3). Retains more context than the benchmark's own recepteur variant (which drops to icon+title+one-button with zero recap). Everything else is one `.mb-meta` line at the design system's smallest type size. Add: a muted `i-x` badge (identical path data already sits unused in the frozen sprite), promote the status word to `.mb-d3`, add an explicit "Retour à mon équipe" CTA — all inside the existing branch, no new route.

### defi-refuse-emetteur
B. **Contains the single cheapest, highest-confidence, most valuable specific recommendation in the whole audit**: add the "Défier une autre équipe" retry CTA (`onClick={() => setScreen('compose')}` — the target screen and the button pattern both already exist in this exact file). Validated twice by the benchmark (also present on `defi-expire`), absent twice from the real app, zero technical obstacle. The dated-timeline half of this screen genuinely cannot be built without a core change — see below.

### defi-expire
B. **Best return-on-effort screen in the whole cluster to refine first** — a fully real, zero-new-data, zero-core-change 2-step timeline (`createdAt`/`expiresAt`, both already on the entity) plus the same retry CTA, closing the cleanest "benchmark is right and it costs nothing to catch up" gap found anywhere in this audit. `.mb-status--expired`'s already-neutral token independently arrives at the same actor-neutral framing the benchmark reaches visually — keep it. **BUSINESS DECISION REQUIRED (C)**: should repeated/unanswered challenges feed any team-level reliability signal, analogous to `clientReliabilityV1` for booking no-shows? (Currently no team-level metric exists at all — see §7.)

### Cross-screen business decision for this cluster
**Should `packages/core`'s `Challenge` entity gain a response timestamp** (e.g. `respondedAt`, set by `rejectChallenge`/`cancelChallenge`), so the UI can show a real "refused/withdrawn on [date]" step? Unlike ACCEPTED (where `match.createdAt` already substitutes), REJECTED/CANCELLED have no equivalent anywhere today — **this cannot be added without touching frozen core**, and should be scoped as a deliberate follow-up, not attempted inline.

**Visual-verification caveat, carried forward honestly**: `DECISIONS.md`'s own entry for this build states its "VISUEL 8/10" self-rating came from DOM/computed-style inspection only, not an actual rendered screenshot comparison, due to a Browser-pane tooling incident. This audit's own findings for this cluster are grounded the same way (exact CSS/token reading, not a live render) — Aymen still owes this cluster a real screenshot pass whenever the tooling cooperates.

---

## 10. Notifications (3 screens, none built)

**Net read**: the newer benchmark used for this audit is unambiguously better on IA/persona-correctness than the older `prototypes/app/notifications.html`; the older prototype is unambiguously more complete on STATE modeling. Verified directly: the older file literally ships a manager-only item (`EXTERNAL_BOOKING_TO_VERIFY`, tagged "Vue gérant") mixed into a player feed — the newer benchmark's 3 screens contain no such content, a real, confirmed improvement. But none of the older prototype's real state modeling (numeric unread badge with a zero-state, per-item read/unread dimming, "tout lire," inline accept/refuse) survived into the newer benchmark. **A real build must marry the newer benchmark's correct persona scoping to the older prototype's state completeness — port neither wholesale.**

**Second cross-cutting issue**: "Tout"↔"Défis" navigation is 3 separately-routed screens in the benchmark (a click-through-mock artifact) — per `BUSINESS_RULES_V1.md §21`'s own instruction not to turn the iframe prototype into production architecture, this should collapse into one component with client-side tab state.

**Third**: the identical A4 truncation gap (`.defi-row-item .n`, no overflow rule beyond a `min-width:0` wrapper) appears in both Défis sub-screens here **and** already exists in apps/player's own shipped `.ch-row` (backing `ChallengesFlow.tsx`) — the frozen `.mb-match__title` fix should be applied to both simultaneously, one fix, two beneficiaries.

### screen-notifications (Tout)
D, not started. Correct player-only persona in all 4 demo items (verified: none reference `EXTERNAL_BOOKING_TO_VERIFY` or center-admin content). Clean "Défis get a bordered card, everything else lighter" IA, directly matching `§10`'s wording ("a captain receiving a challenge can reach the challenge detail and accept/refuse it" — the benchmark's CTA literally reads "VOIR LE DÉFI →", a nav-to-detail pattern, not the older prototype's inline buttons).
- **Real copy bug in the benchmark, correct it before porting**: "Ton équipe a accepté un défi contre Hydra Sports" doesn't match core's own recipient semantics — `RECIPIENTS.challengeAnswered(fromCaptainId)` sends CHALLENGE_ACCEPTED only to the team that SENT the original challenge, i.e. this recipient's team did NOT do the accepting, the OTHER team did. Correct copy: "Hydra Sports a accepté ton défi."
- No unread badge anywhere despite `unreadCount()` existing specifically as a real, non-hardcoded count (core comment: "audit D5") — the older prototype already modeled this correctly and it should be re-skinned in, not reinvented.
- **BUSINESS DECISION REQUIRED**: is the "Activité" section meant to be sourced 1:1 from core's `Notification` rows (in which case copy must follow `RECIPIENTS`/`NOTIFICATION_LABELS` exactly, which the benchmark's own demo copy currently violates), or a broader concept beyond the entity?

### notif-defis-recus / notif-defis-envoyes
Both D, not started. Correct sub-tab IA matching core's distinct recipient functions. Reçus's copy correctly uses singular "ta réponse" (matches `challengeReceived`'s single-captain-only recipient). **Real gap on Envoyés**: no example of an ACCEPTED outgoing challenge — arguably the most important outcome for a sender to see (core's own `CHALLENGE_ACCEPTED` label body literally says "le match est créé") — yet it's absent from the one screen whose entire job is tracking sent défis; also no DECLINED example (a distinct core type from EXPIRED). Recommend one shared row component (Envoyés' swappable-status-pill pattern is the better of the two, extend it back onto Reçus) reusing `.ch-row`/`.tm-crest`/`.ch-empty` from the already-shipped Challenges feature rather than inventing bespoke Notification-scoped markup. **BUSINESS DECISION REQUIRED**: does the frozen `.mb-status` vocabulary gain modifiers for "pending"/"declined" défi states, or stay bespoke (extending the frozen design system needs Aymen's sign-off); does an accepted outgoing challenge stay listed here after graduating into a match, or disappear once it's in Mes Matchs?

---

## 11. Shared component recommendations (priority order)

### Build first — highest leverage, currently blocking real work
1. **Match Card (`.mb-match`)** — fully built, zero usages anywhere. Highest-leverage item in the whole audit: Home's hero/rail, Explorer's Matchs tab and Terrains previews, Résultats Matchs, Mes Matchs all need it and are currently blank slates. Treat creating any new match-card class as a red flag. One gauge collision to resolve before it goes live: `.mb-match__gauge` (built, unused) vs `.mt-gauge` (player.css, live today) are near-identical — standardize on the ds.css one (more complete, `border-radius:inherit`).
2. **Navigation shell (bottom nav + shared back/top-bar)** — the product owner's primary structural concern. Zero nav/tabbar pattern exists anywhere; `App.tsx` is a flat screen-union switch. Fix the smaller, already-shipped duplication first (collapse `.au-back`/`.bk-back`/`.mt-back` into one `.mb-back` — also fixes their shared 36px-vs-44px tap-target gap in one place; extract the byte-identical duplicate `StepTop` component from `MatchFlow.tsx`/`ChallengesFlow.tsx`), then build the persistent 5-destination shell in `App.tsx` per `§3`. **✅ RÉSOLU en entier, Lot 1 (26/08/2026)** — `.mb-back` consolidation (+ correctif d'équilibrage de l'entête découvert en vérifiant, voir DECISIONS.md), `StepTop` extrait en composant partagé (`StepTop.tsx`), coquille de navigation réelle à 5 destinations construite. Voir `docs/DECISIONS.md`.
3. **Team Crest identity** — the generic single `i-shield` glyph (via `.tm-crest`) makes every team in the app look identical at a glance, hit across Teams AND all 9 Challenges screens simultaneously since they all reuse the one class. Deterministic accent color + initials from team id/name; fixing it once upgrades every screen that reuses `.tm-crest`. **◐ Partiellement résolu — voir §7 ci-dessus** (initiales oui, accent-couleur volontairement non construit).

### Fix now — small, real, already-drifted
4. **`.mb-chip` tap target** — one-line fix (`min-height: 34px` → `var(--tap-min)`) in the frozen `design/moubarat-ds.css`, resolves a live 44px-floor violation everywhere chips are used (SlotPicker's primary controls hit hardest).
5. **Toast** — 4 independently hand-written `showToast()` implementations have already drifted (2 of 4 are missing an empty-message guard that the other 2 correctly added, one edge case away from flashing an empty bubble). One `useToast()` hook + one `.mb-toast` class (carry over `.mt-toast`'s max-width, the more correct of the two current definitions).
6. **Empty/Error state** — `.mb-note` (+ `--error` modifier) is fully built with zero real call sites; `ChallengesFlow.tsx`'s `.ch-empty` already hand-rolled a near-equivalent instead. Swap it in now — same-day fix. Separately, merge `.au-error`/`.mb-field__error` (already near-identical and already cross-contaminating: `.au-error` has leaked from Auth into Booking's external-booking-conflict message).
7. **Price Block** — 99% consolidated; one confirmed bypass in `BookingFlow.tsx`'s terrain-detail rate grid (raw `<b>` instead of `.mb-price[data-unit="hour"]`) — the one place an hourly rate is shown is the one place that doesn't use the component built for it. Two-line fix.

### Build alongside the screens that need them
8. **Venue Card** — nothing exists; design it together with a real `Venue{id,name,sport[],fields[],rating,photo,location}` data source, not as CSS alone — the Discovery cluster's Five Stadium contradiction is exactly the failure mode a shared card+data-source prevents.
9. **Team Card** (browsable list item, distinct from Player Row and the single-team hero) — for Explorer's Équipes tab. Supporting pieces (`.tm-crest`, `.mt-qcard`) already exist and are already reused correctly, lowering the real cost.
10. **Player Row** — genuinely fragmented today (not hypothetical): `MatchFlow.tsx` has a real, reusable `PlayerRow` component; `TeamsFlow.tsx` and `ChallengesFlow.tsx` each independently reimplement the same row inline with diverging feature sets, while all three already share identical CSS. Promote MatchFlow's version to a shared component with optional trailing-action/status-pill props.
11. **Modal / confirmation dialog** — zero exist anywhere; 5 already-shipped actions are irreversible/high-consequence and fire immediately on tap with only a post-hoc toast (cancel match, cancel booking, remove teammate, leave team, retire challenge). Build one primitive, route all 5 through it before they ship for real users.
12. **Progress indicator** — two sub-patterns: step-dots (Auth has a real one, Match/Challenges creation flows use plain text despite being comparable-or-longer) and capacity-gauge (see #1's gauge-collision note). Lower priority than the above.

### Already solid — confirm, do not touch
**Status Badge**, **CTA/buttons**, **Typography hierarchy**, **Slot Picker**, and **Loading state (button-level)** were all independently confirmed consistent and correct across every screen read. Slot Picker in particular is "the strongest existing example of the pattern this whole review is asking for elsewhere" — extend its props (field selector) when needed, never fork it.

---

## 12. Consolidated business decisions required

Every decision flagged across all 35 screens, deduplicated and grouped. Nothing below has been silently decided anywhere in this spec — each needs Aymen's explicit call before the affected UI is wired to real data.

**§24-A — Level taxonomy**: mechanically resolved everywhere in real code (`SkillLevel` = LOISIR/INTERMEDIAIRE/COMPETITION, matched exactly by `matchDemo.ts`, Home, Explorer's Terrains tab) but still formally "open" in `BUSINESS_RULES_V1.md §15`. The benchmark itself is internally inconsistent (Explorer's own two tabs disagree; Filtres Matchs and Résultats Matchs both show invalid "Débutant"/"Avancé" values). **Recommend formally ratifying the 3-tier scale given triple independent agreement** — this closes Explorer, Filtres Matchs, Résultats Matchs, Team Detail's "Niveau moyen," and Profil's "Niveau" all at once.

**§24-B — Rating rules**: formally "open" in the docs but `rating.ts` already fully implements who/when/scale/edit (R1-R5, documented in the file's own header). Confirm ready to treat as resolved before Mes Matchs' rating CTA ships.

**§24-D — Match formats/capacities**: the "formats" half is resolved and should be closed (`validateFieldFormats()` verified correct twice over). The "capacities" half is genuinely open: ratify "organizer may reduce capacity below the format's full roster, never above it" — core already supports this safely, only the UI refuses to offer it (Create Match scenario E).

**§24-F — Privacy**: four tiers named, only two (`OPEN`/`PRIVATE`) exist in the frozen `Match.visibility` type. Multiple concrete instances need this resolved: Explorer's Équipes tab publicly showing other teams' OVR/roster, Team Detail's page visibility, PRIVATE matches being joinable-if-reached rather than access-gated (`canJoinMatch()` has no visibility check at all today).

**New — canonical venue/field catalog** (the single most-repeated new decision in this audit, surfaced independently by Discovery, Booking, and Create Match clusters): is V1 scoped to one pilot venue (current implementation) or does venue choice need to be real now? Recommend: single-venue for V1, with Explorer owning the eventual real catalog that Booking and Create Match both consume — never fork a second venue list.

**New — external/phone booking in Create Match**: should `MatchFlow`'s manual-entry step compute price from a known venue rate (`prepareBooking`) vs. accept a free-typed price for an off-platform venue? Should "chemin B" naming be reclaimed for this case (currently repurposed for a different scenario)?

**New — challenge/booking integrity**: should accepting a challenge require/create a real `Booking` with the same `canReserve()`/`isBlocking()` guarantees every other match gets? Currently the most serious data-integrity finding in the whole audit (Create Match scenario H).

**New — `stakeKind` effect**: should AMICAL vs CLASSEMENT actually affect ranking/winRate? Currently unused anywhere in core outside its type declaration — the Compose-time choice is cosmetic today, while the accepted-match screen unconditionally claims "comptera pour le classement" regardless.

**New — Challenge response timestamp**: should `rejectChallenge`/`cancelChallenge` capture a real timestamp (frozen-core amendment) so a "refused/withdrawn on [date]" step can be shown? Only needed if the Défis-outcome timeline richness (§9) is wanted for REJECTED/CANCELLED, not just ACCEPTED/EXPIRED.

**New — team-level reputation/reliability**: no metric exists anywhere in core (the "Fiabilité 82"/"OVR 86" figures in both Team Detail and Profil are ungrounded). Recommend real win-rate + forme as the answer, not a new invented single figure — see §7.

**New — bulk team-invite notification mechanism**: none of the 12 current `NotificationType` values fits "you were invited to a specific match by a teammate" — needed if Create Match's "Mon équipe" bulk-invite (§4) is built.

**New — Profil's non-modeled fields**: "Rôle préféré"/"Style de jeu" have no home in the frozen `Profile` entity — extend it (needs sign-off) or drop them.

**New — IA consolidations, lower stakes, engineering-recommended**: Search Matchs folding into Résultats Matchs; Notifications' 3-routed-screens collapsing into one tabbed component; Mes Défis' bottom-nav entry point (no slot exists in the canonical 5-item nav).

**Reintroduction-gated, not currently open**: tournaments (§23, conditioned on §2's traction bar) and native chat (§23, "décision n°1 de l'audit") are correctly excluded — no action needed unless Aymen explicitly reopens either.

---

## 13. State requirements checklist

Every major flow should account for: loading, empty, populated, success, error, disabled, locked, unavailable, cancelled, expired (per `VISUAL_REFINEMENT_STRATEGY.md §8`). Cross-referenced to what already exists:

| State | Primitive | Status |
|---|---|---|
| Loading (button) | `.mb-btn[data-loading="true"]` | Built, used consistently (Match/Challenges/Booking confirm buttons) |
| Loading (section/list) | `.mb-skel`/`--text`/`--title` | Built, **zero call sites** — will matter the moment any screen fetches real data |
| Empty | `.mb-note` | Built, zero call sites (`ChallengesFlow.tsx` hand-rolled a near-duplicate instead — swap it in) |
| Error (inline field) | `.au-error` / `.mb-field__error` | Two near-identical implementations already live and cross-contaminating — merge |
| Error (page/list) | `.mb-note--error` | Built, unused |
| Provisional/not-yet-computed (OVR) | `.mb-ovr--provisional` | Built, unused (Profil is the first real consumer) |
| Success/confirmation | `.mt-check`/`.au-check` | Built, used in 2 places (Auth done, Match create-confirm) — reuse pattern for Booking-confirm and Challenge-accept entrance beats rather than inventing new ones |
| Disabled | `.mb-btn[disabled]`, `.mb-chip[disabled]` | Built, correctly used throughout |
| Cancelled/Expired/Locked | `.mb-status--cancelled/--expired/--locked` | Built, correctly used — verify every new screen pulls from this vocabulary, never re-derives colors |
| Conflict (double-booking, taken slot) | none live-tested | `SlotPicker` pre-filters rather than surfacing a post-selection conflict; real conflict states are currently unreachable since apps/player makes zero network calls anywhere (confirmed by grep) |

---

## 14. What must NOT change

- `packages/core` — read extensively across all 35 screens' audits, zero changes proposed anywhere except the explicitly-flagged, Aymen-gated items in §12 (all pre-existing, deliberately raised, none silently assumed).
- `apps/crm` — untouched, unread, out of scope for this entire audit.
- `design/moubarat-ds.css`'s token values (`--primary`, `--gold`, `--ink`, font families) — confirmed correct and consistent with every product doc; only the two specific frozen-file edits explicitly called out (`.mb-chip` tap-target, `.mb-back` consolidation) are recommended, both additive/corrective, never a token-value change.
- Create Match's format-chip mechanism (`FORMAT_OPTIONS`/`FORMAT_CAPACITY`/`validateFieldFormats`) and its Review step — independently re-verified as correct and, in the format-chip case, provably safer than the benchmark.
- Challenges' unified `isSender`-branch Detail-screen architecture — the richness gap is real but the fix is restoring content inside the branches, not forking the component.
- Booking's cash-only V1 assumption — do not add a payment-method selector matching the benchmark's pattern; this is an already-decided question (`§7`), and the benchmark is arguably over-built here, not the real app under-built.
- Tournaments, native chat, monetary challenge stakes — all explicitly excluded (§23), all correctly excluded in every real screen this audit found.

---

## 15. Recommended implementation order

Sequenced for maximum unblock-per-effort, per the audit's own repeated findings about which gaps compound:

1. **Fix `cancelProof()`** (§0) — independent of everything else, small, real trust stakes.
2. **`.mb-chip` tap-target + `.mb-back` consolidation** — two tiny, frozen-file, one-line-each fixes that resolve a live accessibility violation across every existing screen simultaneously.
3. **Navigation shell** (bottom nav + shared header) — unblocks Home/Explorer/Mes Matchs/Profil from having anywhere to exist at all; without this nothing else in the "not started" column can ship as a real, reachable screen.
4. **Venue/field data model** (even as an extended demo fixture first) — unblocks Discovery, the Create Match Declare/Discovery split, and Défis' venue surfacing simultaneously; this is the single most-repeated dependency in the whole audit.
5. **Create Match**: the Declare screen (manual/phone booking, `registerExternalBooking` wiring) and the Configure merge — both ship independently of #4, highest-value close-to-implementation-ready gap in the audit.
6. **`.mb-match` adoption** — build Mes Matchs (cheapest possible win: the hardest part already exists, unused) and Home's hero/rail on it.
7. **Team crest identity fix** — one component change, upgrades Teams + all 9 Challenges screens at once.
8. **Challenges outcome-screen restoration** (§9) — the timeline/retry-CTA additions, prioritized `defi-refuse-emetteur`/`defi-expire` first (zero core dependency, highest value-for-effort), the two guaranteed-wrong accept-screen bugs (0 DA share text, unconditional ranking claim) immediately regardless of sequencing since they're currently visible by default.
9. **Profil** — net-new, unusually implementation-ready, closes the last of the five fixed nav destinations.
10. **Explorer + the two Filtres/Résultats pairs** — once §24-A is ratified (blocks wiring Niveau filters to real data) and the venue model (#4) exists.
11. **Notifications** — benefits from Défis (#8) and Mes Matchs (#6) already existing to link into.
12. Everything else in §11's shared-component list, opportunistically, as each screen above touches it.

Do not build: `screen-tournoi-detail`, a native-chat screen, a monetary-stake UI, or a Create-Match-local venue picker (§4, Finding 2) — all explicitly out of scope or explicitly deferred to shared work above.
