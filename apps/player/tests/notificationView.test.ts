import { describe, expect, it } from 'vitest';
import { NOTIFICATION_LABELS, type NotificationType } from '@moubarat/core';
import { GENERIC_NOTIFICATION, isKnownNotificationType, notificationIcon, notificationLabels } from '../src/lib/notificationView.js';

/* L'écran Notifications plantait sur un type inconnu (`NOTIFICATION_LABELS[type]` = undefined, puis `.title`) — une PWA en cache
   plus ancienne que le serveur perdait TOUTES ses notifications dès qu'un nouveau type apparaissait. Bug consigné le 25/09/2026
   (audit, à traiter avec l'invitation d'équipe). */

const KNOWN = Object.keys(NOTIFICATION_LABELS) as NotificationType[];

describe('types connus', () => {
  it('chaque type du core a son libellé et une icône du sprite', () => {
    for (const t of KNOWN) {
      expect(isKnownNotificationType(t)).toBe(true);
      expect(notificationLabels(t)).toBe(NOTIFICATION_LABELS[t]);
      expect(notificationIcon(t)).toMatch(/^i-[a-z0-9-]+$/);
    }
  });

  it('l’invitation d’équipe est connue : libellé du core, icône « équipe »', () => {
    expect(notificationLabels('TEAM_INVITED').title).toBe(NOTIFICATION_LABELS.TEAM_INVITED.title);
    expect(notificationIcon('TEAM_INVITED')).toBe('i-users');
  });
});

describe('types INCONNUS — jamais un écran cassé', () => {
  const UNKNOWN = ['MATCH_TIME_CHANGED', '', 'team_invited', 'constructor', 'toString', '__proto__', 'hasOwnProperty'];

  it('un libellé générique lisible et une icône neutre, sans jamais lever', () => {
    for (const t of UNKNOWN) {
      expect(isKnownNotificationType(t), t).toBe(false);
      expect(notificationLabels(t), t).toEqual(GENERIC_NOTIFICATION);
      expect(notificationIcon(t), t).toBe('i-bell');
    }
  });

  it('le libellé générique n’invente rien : ni nom, ni match, ni chiffre', () => {
    expect(GENERIC_NOTIFICATION.title.length).toBeGreaterThan(3);
    expect(GENERIC_NOTIFICATION.body).not.toMatch(/\d/);
  });
});
