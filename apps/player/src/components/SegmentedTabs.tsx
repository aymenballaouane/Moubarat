import { Icon } from './Icon.js';

/* Controle segmente partage — LES onglets internes d'un ecran (Explorer,
   Mes matchs, Defis, Notifications) : un seul pattern (spec §8 mes-defis :
   « worth building as a new shared primitive »), etat actif via
   aria-pressed, compteurs optionnels accordes cote appelant. `icon`
   optionnel (id du sprite gele) — Explorer en a besoin (fidelite au
   prototype, `.expl-tab`), les autres consommateurs ne le passent pas et
   gardent leur rendu texte-seul inchange. */

export interface SegTab<T extends string> { value: T; label: string; icon?: string; disabled?: boolean; title?: string | undefined }

interface SegmentedTabsProps<T extends string> {
  tabs: readonly SegTab<T>[];
  active: T;
  onSelect: (value: T) => void;
}

export function SegmentedTabs<T extends string>({ tabs, active, onSelect }: SegmentedTabsProps<T>) {
  return (
    <div className="mb-seg">
      {tabs.map((t) => (
        <button key={t.value} type="button" className="mb-tap" aria-pressed={active === t.value}
          disabled={t.disabled} title={t.disabled ? t.title : undefined}
          onClick={() => onSelect(t.value)}>
          {t.icon ? <Icon id={t.icon} className="mb-ic--sm" /> : null}
          {t.label}
        </button>
      ))}
    </div>
  );
}
