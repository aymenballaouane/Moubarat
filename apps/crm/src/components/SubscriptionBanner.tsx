/* Abonnement SaaS minimal (22/09/2026, C1/CE11 de l'audit produit) : bandeau d'avertissement,
   AUCUNE coupure d'accès — la valeur (plan/statut/échéance) est saisie par le superadmin
   uniquement (console), jamais modifiable depuis le CRM. Voir docs/DECISIONS.md pour la limite
   volontaire de ce lot : la question de couper l'accès CRM d'un centre impayé reste tranchée
   « pas maintenant », en attente d'un avis juridique/comptable sur la conservation des factures. */

const DUE_SOON_DAYS = 7;

export function SubscriptionBanner({ status, dueAt }: { status: 'PAID' | 'UNPAID'; dueAt: string | null }) {
  if (status === 'UNPAID') {
    return (
      <div className="cm-sub-banner cm-sub-banner--danger" role="status">
        Abonnement Moubarat en retard de paiement — contactez Moubarat pour régulariser.
      </div>
    );
  }
  if (dueAt) {
    const daysLeft = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= DUE_SOON_DAYS) {
      const label = new Date(dueAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
      return (
        <div className="cm-sub-banner cm-sub-banner--warn" role="status">
          Abonnement Moubarat à renouveler avant le {label}.
        </div>
      );
    }
  }
  return null;
}
