# MOUBARAT V1 — BUSINESS RULES & PRODUCT SPECIFICATION

**Version:** 1.0 — Working specification  
**Purpose:** Source of truth for Moubarat V1 product, business rules and backend behavior.  
**Audience:** Claude Code, frontend/backend developers, CRM developers, product/design.

> The validated UI prototype is the visual source of truth. This document is the functional source of truth.

## 1. Core architecture

Moubarat consists of:

- mobile app for players;
- CRM for sports centers;
- API/backend;
- shared `@moubarat/core` package.

The mobile app and CRM import the same business rules from `@moubarat/core`; neither implements a competing source of truth. fileciteturn47file0L1-L14

Target structure:

```text
moubarat/
├── packages/
│   ├── core/
│   └── ui/
└── apps/
    ├── mobile/
    ├── crm/
    └── api/
```

## 2. Product mission

Moubarat makes amateur sport in Algeria easier to organize.

For players:

1. discover matches and venues;
2. reserve a field;
3. create a match;
4. join an existing match;
5. manage a team;
6. challenge another team;
7. record results;
8. rate teammates;
9. progressively build a reliable sports profile.

For centers:

1. manage fields;
2. manage availability;
3. manage reservations;
4. record external reservations;
5. avoid double-booking;
6. operate the venue through the CRM.

## 3. V1 navigation

Bottom navigation is fixed:

**Accueil | Explorer | [+ Créer] | Mes matchs | Profil**

### Accueil

Primary action surface containing notification access, player identity/OVR when available, next match, matches to join, venue discovery and the primary **RÉSERVER / CRÉER** CTAs.

### Explorer

Three tabs:

1. **Matchs** — default;
2. **Terrains**;
3. **Équipes**.

Tournament functionality is postponed until sufficient traction and enough formed teams exist.

### Mes matchs

Two tabs:

- **À venir**
- **Passés**

Contains matches in which the player is already involved.

### Profil

Consolidated player profile containing identity, OVR when available, sport identity, teams, recent matches, ratings/badges and account/settings.

## 4. Roles and permissions

Initial roles:

- `PLAYER`
- `TEAM_CAPTAIN`
- `CENTER_ADMIN`
- `SUPERADMIN`

Permissions are centralized in `@moubarat/core`.

Only a team captain can initiate a team challenge.

## 5. Core entities

The current core model contains the 16 entities from the product specification plus the audit corrections and `MatchResult`. It also defines centralized state machines and permissions. fileciteturn47file0L19-L30

The exact TypeScript entities and PostgreSQL schema in `@moubarat/core` are authoritative once implemented.

## 6. Match rules

Target lifecycle:

```text
DRAFT → OPEN → FULL → LOCKED → PLAYED
```

Permitted pre-play cancellation leads to `CANCELLED`.

Invalid state transitions must be rejected.

A match must define, as applicable:

- sport;
- venue/field;
- date/time;
- duration;
- format/capacity;
- price model;
- level;
- organizer;
- join status.

Joining is allowed only while the match is joinable, capacity exists, no schedule conflict exists, and the match is not locked.

Current product rule: **H-2 lock**.

## 7. Booking rules

Booking is a first-class entity.

Price semantics are explicit:

- `PER_PLAYER`
- `PER_HOUR`
- `TOTAL`

A raw amount without a unit is invalid. fileciteturn47file0L21-L22

The database enforces the no-overlap rule. The current PostgreSQL `no_double_booking` constraint rejects overlapping reservations while allowing contiguous reservations. fileciteturn47file0L41-L44

### External bookings

A telephone/direct-center reservation is represented as:

```text
Booking.source = EXTERNAL
```

It blocks the slot, is initially unverified by the center and generates the appropriate center notification. This prevents a phone reservation from being invisible to the Moubarat availability system. fileciteturn47file0L42-L44

### Cash lifecycle

Current core lifecycle:

```text
RESERVED → HONORED → PAID
                    ↘ NO_SHOW
```

V1 does not require online payment.

## 8. Teams

Teams contain members and roles, including captain/player.

Team detail provides identity, members, relevant reputation/rating information and recent match information where available.

Only eligible captains see the challenge action.

## 9. Team challenges

Flow:

```text
Captain → Challenge → Sent → Accepted/Refused
                         ↓
                   Accepted → Match created
```

A challenge contains the participating teams and proposed match information such as sport, date, time, duration, venue, objective and message.

Expiration: **48 hours**.

Acceptance creates the resulting match and stores the relationship through `challenge.matchId`. fileciteturn47file0L27-L28

Challenge outcomes:

- accepted → match created;
- refused → no match;
- expired → no match.

### Monetary stake

Cash stake amount is **disabled in V1**. Challenge intent remains:

- **AMICAL**
- **CLASSEMENT**

This decision is explicitly recorded in the current core. fileciteturn47file0L58-L61

## 10. Notifications

Moubarat has a centralized notification center.

V1 must support challenge notifications and be extensible to future operational events such as match reminders and participation events.

Notifications should be actionable: a captain receiving a challenge can reach the challenge detail and accept/refuse it.

## 11. Match coordination

Native chat is postponed.

**V1 uses WhatsApp** for match coordination. The UI should say **Groupe WhatsApp**, not imply native Moubarat chat. Native chat is a V2 possibility. fileciteturn47file0L49-L51

## 12. Match results

Process:

```text
Match played
→ organizer submits result
→ opponent confirms
→ confirmed result
```

The opponent has **24 hours** to confirm.

No response can lead to auto-validation according to the core rule.

A dispute becomes:

```text
DISPUTED
```

The result must not be silently overwritten.

The result becomes the source for later win/loss, rating, OVR, badges and ranking calculations.

## 13. Ratings and OVR

Moubarat must never display fabricated performance statistics.

The current core decision is to hide OVR until the player has **3 rated matches**. Before that:

```text
OVR: —
```

Current V1 formula:

```text
40 base
+ teammate rating component (≤35)
+ win-rate component (≤15)
+ volume component (≤9)
```

`computeOvr()` returns `null` before the threshold. fileciteturn47file0L52-L55

The OVR must always be reproducible from stored data and must live in `@moubarat/core`.

## 14. Statistics

Only statistics generated from real database events may be displayed.

No hard-coded wins, losses, percentages or fictional form strings in production.

The profile becomes richer as real match/result/rating data accumulates.

## 15. Explorer filters

Explorer supports filters for:

- location / wilaya;
- radius;
- sport;
- price;
- equipment;
- minimum venue rating;
- match level where relevant.

Active filters remain visible as removable chips.

Results need a clear count, sorting and highly scannable cards.

**OPEN DECISION:** final level taxonomy.

## 16. Home screen

The Home remains the primary action surface.

The validated visual language is based on the Match Card system and the two main actions:

**RÉSERVER** and **CRÉER**.

Do not redesign validated Home elements without an explicit product decision.

## 17. CRM V1

Core CRM responsibilities:

### Venue / field management
- centers;
- fields;
- sports;
- availability;
- pricing.

### Booking management
- reservations;
- external reservations;
- status;
- cash lifecycle;
- no-shows;
- conflicts.

### Activity
The center should be able to understand the activity occurring on its fields.

The CRM uses the same core rules and database as the player app.

## 18. Authentication

V1 direction:

- phone number;
- OTP;
- profile creation;
- authenticated session.

Onboarding screens are not yet part of the validated prototype and should be built using the shared design system.

## 19. Data integrity — non-negotiable

1. No fabricated production statistics.
2. No ambiguous prices.
3. No double-booking.
4. No unauthorized team challenges.
5. No invalid state transitions.
6. No client-only permission enforcement.
7. No duplicated business logic between mobile, CRM and API.
8. Every important metric must have a traceable database source.
9. External bookings block availability.
10. Accepted challenges create/link a real match.

## 20. UX / design rules

The validated visual direction is considered stable.

Preserve:

- cinematic black base;
- Moubarat red;
- established gold accents;
- Bebas Neue display typography;
- IBM Plex Mono for technical labels/tags;
- Match Card visual language;
- aggressive sports identity;
- high scannability;
- strong hierarchy.

The prototype is a visual reference, **not** the production technical architecture.

## 21. Prototype vs production

The prototype was built screen-by-screen and later assembled.

It exists to validate:

- visual language;
- information architecture;
- user flows;
- product intent.

Do not turn the iframe/srcdoc prototype into the production architecture.

Rebuild production using reusable components, shared design tokens and the core business rules.

## 22. Quality gates

Every major phase must pass:

```text
npx tsc --noEmit
npx vitest run
psql -f schema.sql
```

The current core already reports:

- TypeScript: 0 errors;
- tests: **22/22 passing**;
- PostgreSQL schema: loads successfully;
- no-double-booking behavior: verified. fileciteturn47file0L33-L44

End-to-end QA must cover:

1. sign up;
2. profile;
3. discover match;
4. join;
5. create match;
6. reserve field;
7. external booking;
8. team membership;
9. challenge;
10. accept challenge;
11. play;
12. result;
13. rating;
14. OVR;
15. notification;
16. CRM booking operation.

## 23. V1 exclusions

Unless explicitly reintroduced:

- native chat;
- monetary stakes in team challenges;
- tournaments;
- advanced performance tracking requiring unavailable hardware/data;
- fabricated statistics;
- unnecessary social features.

## 24. Open decisions

These must not be invented silently by an AI agent:

### A. Level taxonomy
Define the exact player/match level scale.

### B. Rating rules
Define who rates whom, when, scale, edits and anti-abuse rules.

### C. Cancellation rules
Define player, organizer and center cancellation, no-show behavior and reputation consequences.

### D. Match formats
Define supported formats/capacities for each sport.

### E. Center permissions
Define exactly what a center admin can create, edit and cancel.

### F. Privacy
Define public, team-only, center-only and private data.

## 25. Implementation order

```text
PHASE 0.5  Prototype finalization
    ↓
PHASE 1    Shared Design System
    ↓
PHASE 2    Core data model + state machines
    ↓
PHASE 3    Auth + Users
    ↓
PHASE 4    Venues / Fields / Availability
    ↓
PHASE 5    Bookings
    ↓
PHASE 6    Matches
    ↓
PHASE 7    Teams
    ↓
PHASE 8    Challenges
    ↓
PHASE 9    Notifications
    ↓
PHASE 10   Results + Ratings + OVR
    ↓
PHASE 11   CRM
    ↓
PHASE 12   End-to-end QA
    ↓
PRIVATE BETA
```

## 26. Developer instruction

**Do not optimize for writing the most code. Optimize for preserving the product rules.**

Before changing an existing rule:

1. identify the rule here;
2. identify its implementation in `@moubarat/core`;
3. identify affected mobile/CRM/API flows;
4. update tests;
5. modify implementation.

If a requirement is ambiguous:

**STOP and escalate the ambiguity. Do not invent a business rule.**

This specification evolves with the codebase. Whenever a product decision changes, update this document and the corresponding core tests before changing downstream applications.

## 27. Current status

The current `@moubarat/core` has:

- strict TypeScript compilation passing;
- 22/22 core tests passing;
- PostgreSQL schema validated;
- no-double-booking verified;
- external booking behavior implemented;
- challenge lifecycle modeled;
- result confirmation modeled;
- OVR calculation modeled;
- WhatsApp coordination chosen for V1;
- monetary challenge stake disabled.

The declared next phase is:

**Phase 3 — Auth + Users: phone + OTP, profile creation and session.** fileciteturn47file0L63-L67
