import { Icon } from './Icon.js';
import { useT } from '../lib/i18n.js';
import type { Route } from '../nav.js';
import '../styles/profil2.css';

/* « Tes données » (Lot 10, NoticeDonnees.dc.html, règle 37 — loi n° 18-07 modifiée par la loi n° 25-11) : qui s'occupe de tes données, ce qu'on garde, qui voit quoi, combien de temps,
   tes droits. Textes EXACTS de la maquette, aucune reformulation (un texte légal). « Voir mes infos » ouvre le Profil, « Mes accords » l'écran des accords. */

interface Fact { title: string; text: string }

const WHO: Fact[] = [
  { title: 'MOUBARAT SPORT SARL', text: 'Société algérienne à responsabilité limitée' },
  { title: 'Siège', text: 'N° 8, Parc Paradou, Hydra, Alger' },
  { title: 'Registre du commerce', text: '16/00-1283427B26' },
  { title: 'Nif', text: '002616128342732' },
  { title: 'Une question ?', text: 'contact@moubaratsport.com' },
];
const KEPT: Fact[] = [
  { title: 'Ton numéro', text: 'Pour créer ton compte, te connecter, et qu’on puisse t’appeler pour un match' },
  { title: 'Ton nom et ton pseudo', text: 'Pour te reconnaître dans les matchs et les réservations' },
  { title: 'Ton mot de passe', text: 'Chiffré : même nous, on ne peut pas le lire' },
  { title: 'Ta ville, tes sports, ton niveau, homme ou femme', text: 'Pour te montrer les bons matchs, et plus tard des matchs entre femmes' },
  { title: 'Tes matchs et tes réservations', text: 'Pour ton historique et ta fiabilité' },
];
const SEEN: Fact[] = [
  { title: 'Les autres joueurs', text: 'Ton prénom ou pseudo et ton niveau' },
  { title: 'L’organisateur d’un match que tu rejoins', text: 'En plus, ton numéro, pour t’appeler au sujet du match' },
  { title: 'Les joueurs d’un match que tu organises', text: 'Ton numéro, pour te joindre au sujet du match' },
  { title: 'Les centres où tu réserves', text: 'Ton nom, ton numéro, tes réservations chez eux et ta fiabilité' },
  { title: 'Le groupe WhatsApp d’un match', text: 'Seulement si tu choisis de le rejoindre : ses membres voient ton numéro, comme dans tout groupe WhatsApp' },
  { title: 'Nos prestataires', text: 'Le service SMS reçoit ton numéro et ton code, à chaque SMS : inscription, mot de passe oublié ou nouveau numéro' },
];
const HOW_LONG: Fact[] = [{ title: 'Et tes anciennes réservations ?', text: 'Elles restent chez le centre pour ses comptes, sans ton nom' }];

export function NoticeScreen({ onBack, onNavigate }: { onBack: () => void; onNavigate: (route: Route) => void }) {
  const t = useT();
  const facts = (list: Fact[]) => (
    <div className="pf-card pf-facts">
      {list.map((f) => <div key={f.title} className="pf-fact"><b>{t(f.title)}</b><span>{t(f.text)}</span></div>)}
    </div>
  );
  return (
    <section className="au-screen pf pf-sub pf-notice" id="s-notice">
      <div className="pf-sub__top"><button type="button" className="pf-back mb-tap" aria-label={t('Retour')} onClick={onBack}><Icon id="i-back" /></button></div>
      <header style={{ textAlign: 'center', paddingTop: 6 }}>
        <h1 className="pf-sub__title">{t('Tes données')}</h1>
        <p className="pf-sub__lede">{t('On t’explique simplement ce qu’on fait de tes infos. Pas de petits caractères.')}</p>
      </header>

      <h2>{t('Qui s’en occupe')}</h2>
      <p>{t('C’est MOUBARAT SPORT SARL, la société qui fait l’app.')}</p>
      {facts(WHO)}

      <h2>{t('Ce qu’on garde, et pourquoi')}</h2>
      <p>{t('Juste ce qu’il faut pour jouer. Pas de carte bancaire, rien sur ta santé. Ta position, seulement si tu l’autorises : elle sert sur le moment à calculer les distances, on ne la garde pas.')}</p>
      {facts(KEPT)}

      <h2>{t('Qui voit quoi')}</h2>
      <p>{t('Ton numéro ne s’affiche jamais pour tout le monde.')}</p>
      {facts(SEEN)}

      <h2>{t('Combien de temps')}</h2>
      <p>{t('Tant que ton compte existe. Si tu le supprimes, ton nom et ton numéro sont effacés.')}</p>
      {facts(HOW_LONG)}

      <h2>{t('Tes droits')}</h2>
      <p>{t('Tu peux voir, corriger ou effacer tes infos, et retirer un accord quand tu veux. C’est gratuit, et on te répond sous 10 jours.')}</p>
      <div className="pf-rights">
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => onNavigate({ name: 'tab', tab: 'profile' })}>{t('Voir mes infos')}</button>
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => onNavigate({ name: 'accords' })}>{t('Mes accords')}</button>
      </div>
      <p>{t('Pas de réponse sous 10 jours ? Tu peux saisir l’ANPDP, l’autorité qui protège les données en Algérie.')}</p>

      <p className="pf-legal">
        MOUBARAT SPORT SARL · N° 8, Parc Paradou, Hydra, Alger<br />
        RC 16/00-1283427B26 · NIF 002616128342732 · contact@moubaratsport.com<br />
        {t('Loi n° 18-07 du 10 juin 2018 modifiée par la loi n° 25-11')}
      </p>
    </section>
  );
}
