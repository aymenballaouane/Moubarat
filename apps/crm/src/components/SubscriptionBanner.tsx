import { localeOf, useLang, useT } from '../lib/i18n.js';
/* Abonnement SaaS minimal (22/09/2026, C1/CE11 de l'audit produit) : bandeau d'avertissement,
   AUCUNE coupure d'accès — la valeur (plan/statut/échéance) est saisie par le superadmin
   uniquement (console), jamais modifiable depuis le CRM. Voir docs/DECISIONS.md pour la limite
   volontaire de ce lot : la question de couper l'accès CRM d'un centre impayé reste tranchée
   « pas maintenant », en attente d'un avis juridique/comptable sur la conservation des factures. */

const DUE_SOON_DAYS = 7;

/* P0-4 (audit stratégique du CRM, 15/11/2026) : statut « Essai » (TRIAL) — l'échéance est la fin du mois d'essai. Le bandeau
   n'apparaît qu'à 7 jours de la fin, comme pour une échéance de paiement ; aucune coupure à la fin de l'essai. */
export function SubscriptionBanner({ status, dueAt }: { status: 'TRIAL' | 'PAID' | 'UNPAID'; dueAt: string | null }) {
  const t = useT();
  const lang = useLang();
  if (status === 'UNPAID') {
    return (
      <div className="cm-sub-banner cm-sub-banner--danger" role="status">
        {t('Abonnement Moubarat en retard de paiement — contactez Moubarat pour régulariser.')}
      </div>
    );
  }
  if (dueAt) {
    const daysLeft = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= DUE_SOON_DAYS) {
      const label = new Date(dueAt).toLocaleDateString(localeOf(lang), { day: '2-digit', month: 'long', year: 'numeric' });
      return (
        <div className="cm-sub-banner cm-sub-banner--warn" role="status">
          {status === 'TRIAL'
            ? t('Votre mois d’essai Moubarat se termine le {date} — contactez Moubarat pour continuer.', { date: label })
            : t('Abonnement Moubarat à renouveler avant le {date}.', { date: label })}
        </div>
      );
    }
  }
  return null;
}
