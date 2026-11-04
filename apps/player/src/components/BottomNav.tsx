import { Icon } from './Icon.js';
import { NAV_ITEMS, type Route, type Tab } from '../nav.js';
import { useT } from '../lib/i18n.js';

interface BottomNavProps {
  route: Route;
  onNavigate: (tab: Tab) => void;
  onCreate: () => void;
}

/* Coquille de navigation reelle (Accueil/Explorer/Creer central/Mes matchs/
   Profil) — 5 destinations, state React reel (pas de routeur URL : V1 PWA
   sans besoin de deep-link). Gabarit repris du bottom-nav du prototype de
   reference (4 .nav-item + 1 .nav-fab central), recode avec les vrais
   tokens de design/moubarat-ds.css plutot que les couleurs locales de la
   reference.

   Icône pleine de l'entrée active (direction-artistique.md §7) : vérifié sur
   les 4 maquettes réelles (Main/Explorer/MesMatchs/Profil.dc.html) — seul
   Accueil a un tracé "plein" dédié dans la maquette (`i-home-fill`,
   design/sprite-icons.svg), les trois autres restent en contour, seule la
   couleur change. Jamais inventé de tracé "plein" pour Explorer/Mes matchs/
   Profil sans référence. */
export function BottomNav({ route, onNavigate, onCreate }: BottomNavProps) {
  const t = useT();
  const [left, right] = [NAV_ITEMS.slice(0, 2), NAV_ITEMS.slice(2)];
  const renderItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = route.name === 'tab' && route.tab === item.tab;
    const icon = active && item.tab === 'home' ? 'i-home-fill' : item.icon;
    return (
      <button
        key={item.tab}
        type="button"
        className={`nav-item${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(item.tab)}
      >
        <Icon id={icon} />
        {t(item.label)}
      </button>
    );
  };
  return (
    <nav className="bottom-nav" aria-label={t('Navigation principale')}>
      {left.map(renderItem)}
      <div className="nav-fab-slot">
        <button type="button" className="nav-fab mb-tap" aria-label={t('Créer ou réserver')} aria-haspopup="dialog" onClick={onCreate}>
          <Icon id="i-plus" />
        </button>
      </div>
      {right.map(renderItem)}
    </nav>
  );
}
