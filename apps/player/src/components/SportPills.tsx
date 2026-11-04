import type { Sport } from '@moubarat/core';
import { Icon } from './Icon.js';
import type { SportChoice } from '../lib/venueCatalog.js';

/* Rangee de pills sport — composant partage (BookingFlow, CreateMatchFlow :
   les deux parcours de reservation capturent l'intention Sport avant la
   disponibilite, demande directe d'Aymen 29/08/2026). `options` : sports
   RÉELLEMENT proposés par le centre (A7, 22/09/2026, lib/venueCatalog.ts::
   sportChoicesFor) — jamais une liste figée (Padel restait « Bientôt » même
   avec un vrai terrain Padel en base). Un sport réel absent de `options`
   n'est simplement pas affiché, jamais un bouton désactivé qui fait croire
   à une fonctionnalité "à venir" qui n'existe pas. */
export function SportPills({ sport, options, onSelect }: {
  sport: Sport | null; options: SportChoice[]; onSelect: (v: Sport) => void;
}) {
  return (
    <div className="cm-sub">
      <p className="hm-section-label">Sport</p>
      <div className="cm-sports">
        {options.map((s) => (
          <button
            key={s.value} type="button" className="cm-sport" aria-pressed={sport === s.value}
            onClick={() => onSelect(s.value)}
          >
            <Icon id={s.icon} />{s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
