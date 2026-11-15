import { describe, expect, it } from 'vitest';
import { localeOf, translate } from '../src/lib/i18n.js';
import translations from '../src/i18n/fr-ar.json';
import { literalKeys } from './i18n-keys.js';

/* CRM en arabe — lot A (P1-15, 15/11/2026) : la clé est le texte français exact ; repli sur le français si l'arabe manque. */
describe('translate', () => {
  it('français : le texte tel quel ; arabe : la traduction ; traduction manquante : le français, jamais une clé vide', () => {
    expect(translate('Afficher le CRM en arabe', 'fr')).toBe('Afficher le CRM en arabe');
    expect(translate('Afficher le CRM en arabe', 'ar')).toBe('عرض الواجهة بالعربية');
    expect(translate('Texte qui n’existe pas', 'ar')).toBe('Texte qui n’existe pas');
  });

  it('chiffres 0-9 en arabe (choix d’Aymen) : jamais les chiffres arabes orientaux', () => {
    expect((1234567).toLocaleString(localeOf('ar'))).toMatch(/^[0-9\s.,٬  ]+$/);
    expect(new Date(Date.UTC(2026, 10, 15, 12)).toLocaleDateString(localeOf('ar'), { day: 'numeric' })).toBe('15');
  });

  /* P1-15, lot B : toute clé passée à t() en littéral a sa traduction ; les textes passés par une variable (menu, Aide, « prêt à
     publier », sports, erreurs) sont listés ici à la main — un nouveau texte sans traduction fait échouer le test. Les écrans
     du lot C ne passent pas encore par t() : ils n'entrent dans ce contrôle qu'une fois branchés. */
  it('aucune clé utilisée sans traduction arabe', () => {
    const have = { ...translations.textes_provisoires, ...translations.textes } as Record<string, string>;
    const viaVariable = [
      'Dashboard', 'Planning', 'Réservations', 'Abonnements', 'Analytics', 'Clients', 'Personnel', 'Caisse', 'Journal', 'Centre',
      'Confirmer', 'WhatsApp', 'Téléphone', 'Email', 'Football', 'Padel', 'Basket',
      'Terrains et tarifs', 'Horaires', 'Fiche du centre', 'Votre équipe', 'Publication', 'Au quotidien',
      'Au moins un terrain actif', 'Chaque terrain actif a un tarif', 'Des horaires d’ouverture', 'Un compte gérant actif', 'Un téléphone',
      'aucun terrain actif', 'aucun horaire d’ouverture', 'aucun compte gérant — personne ne pourra confirmer les réservations', 'téléphone du centre non renseigné',
      'Ce compte n’est rattaché à aucun centre.', 'Connexion impossible. Réessayez.', 'Envoi impossible. Réessayez.',
      'Impossible de charger les documents. Vérifiez votre connexion et réessayez.', 'Choisissez au moins un sport.',
      'Le consentement à être recontacté est requis.', 'Envoi impossible. Vérifiez votre connexion et réessayez.',
      'Une erreur est survenue. Réessayez.', 'Connexion au serveur Moubarat impossible. Vérifiez votre connexion internet, puis réessayez.',
      'Moubarat est prévenu : votre centre est prêt à être publié.',
    ];
    const missing = [...literalKeys().keys(), ...viaVariable].filter((k) => !(k in have));
    expect(missing).toEqual([]);
  });

  it('le fichier de traductions a ses deux blocs, et aucune traduction vide', () => {
    expect(Object.keys(translations)).toEqual(expect.arrayContaining(['textes', 'textes_provisoires']));
    for (const [fr, ar] of Object.entries({ ...translations.textes_provisoires, ...translations.textes })) {
      expect(ar.trim(), fr).not.toBe('');
    }
  });
});
