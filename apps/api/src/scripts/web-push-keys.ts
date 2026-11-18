import webpush from 'web-push';

/* Lot B, phase 3 — génère UNE fois la paire de clés VAPID des alertes web. À coller dans les variables d'environnement du serveur
   (WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY) avec WEB_PUSH_SUBJECT (mailto:contact@… ou https://…). La clé privée ne va JAMAIS dans
   le code ni sur GitHub ; la changer plus tard oblige chaque téléphone à réactiver ses alertes (PASSATION §4.23). */
const keys = webpush.generateVAPIDKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${keys.privateKey}`);
