-- Refonte app joueur, lot "Inscription et connexion" (règles 28, 29, 30, 36 — décidées par
-- Aymen le 24/10/2026, corrigeant un statut "inchangée" erroné dans docs/regles.md : aucune
-- des quatre n'avait jamais été codée).
--
-- Mot de passe (règle 28/29) : hachage scrypt, même format "salt:hash" et même fonction
-- (apps/api/src/lib/crypto.ts::hashPassword) que les comptes plateforme — jamais un second
-- mécanisme de hachage. NULL = compte antérieur à ce lot, pas encore passé par la passerelle
-- d'accès (sert de condition de garde, pas de colonne booléenne séparée).
--
-- Verrou anti-bruteforce : MÊMES colonnes et MÊME règle que platform_accounts (migration 0004,
-- packages/core/src/rules/platform-auth.ts — déjà générique, jamais "plateforme" dans sa
-- logique) — jamais un second mécanisme de verrouillage.
ALTER TABLE users
  ADD COLUMN password_hash text,
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz;

-- Pseudo (règle 28) : RÉUTILISE `users.name`, déjà unique (migration 0030) et déjà cherché par
-- les invitations d'équipe (P0-6) — un identifiant garanti unique y est plus juste qu'un nom
-- d'affichage qui pourrait doubler. `first_name`/`last_name` (écran "Tes accès",
-- OnboardingAcces.dc.html, "Comment tu t'appelles ?") sont un affichage SÉPARÉ, jamais unique.
ALTER TABLE profiles
  ADD COLUMN first_name text,
  ADD COLUMN last_name text;

-- Accords "numéro visible" et "bons plans" (règle 30) : contrairement à CGU/confidentialité/
-- "18 ans ou plus" (immuables, journal d'acceptation ci-dessous), ceux-ci sont RETIRABLES
-- depuis "Mes accords" — un état courant, pas un journal d'évènements. "bons plans" est le
-- MÊME réglage que l'interrupteur "bons plans" des notifications (règle 30 : "un seul et même
-- réglage") — un lot futur (Notifications) y ajoutera l'écran de réglages, jamais une 2e colonne.
ALTER TABLE profiles
  ADD COLUMN phone_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN promo_opt_in boolean NOT NULL DEFAULT false;

-- "18 ans ou plus" (règle 30, obligatoire, jamais retirable hors suppression du compte) :
-- MÊME mécanisme que CGU/confidentialité (migration 0023, journal append-only) — un 3e type de
-- document, jamais une table séparée pour un accord qui se comporte exactement pareil.
ALTER TABLE legal_acceptances DROP CONSTRAINT legal_acceptances_document_check;
ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_document_check
  CHECK (document IN ('CGU', 'CONFIDENTIALITE', 'AGE_MAJEUR'));
