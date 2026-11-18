-- Lot B, phase 3 (18/11/2026, GO d'Aymen : « commence par le web et Android ») — les alertes sur le téléphone par le WEB (norme Web Push,
-- gratuite, clés VAPID) : l'app web et l'app Android du Play Store (qui affiche le site) reçoivent les alertes déjà écrites dans la cloche.
-- Un appareil web = son adresse d'abonnement (`token`, l'« endpoint » du navigateur) et ses deux clés de chiffrement (`web_keys`).
-- Additive : les appareils iPhone (APNs) ne changent pas. Retour arrière à la main : migrations/retour/0053_web_push.sql.

ALTER TABLE push_devices DROP CONSTRAINT push_devices_platform_check;
ALTER TABLE push_devices ADD CONSTRAINT push_devices_platform_check CHECK (platform IN ('ios', 'android', 'web'));
ALTER TABLE push_devices ADD COLUMN web_keys jsonb;
ALTER TABLE push_devices ADD CONSTRAINT push_devices_web_keys CHECK ((platform = 'web') = (web_keys IS NOT NULL));
