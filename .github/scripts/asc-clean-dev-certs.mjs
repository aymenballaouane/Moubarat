// Supprime les certificats de DÉVELOPPEMENT « Created via API » du compte Apple (10/11/2026).
// Pourquoi : la signature automatique sur un Mac GitHub jetable crée un certificat de développement dont la clé privée disparaît avec la machine ;
// à l'exécution suivante Xcode refuse (« private key is not installed in your keychain ») tant que l'ancien certificat existe.
// Périmètre volontairement étroit : uniquement les types DEVELOPMENT / IOS_DEVELOPMENT dont le nom contient « Created via API » — jamais un certificat de
// distribution, jamais le certificat d'un développeur (nommé d'après la personne).
// Usage : node asc-clean-dev-certs.mjs <chemin du .p8>   (variables d'environnement ASC_KEY_ID et ASC_ISSUER_ID)
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [, , keyPath] = process.argv;
const keyId = process.env.ASC_KEY_ID;
const issuer = process.env.ASC_ISSUER_ID;
if (!keyPath || !keyId || !issuer) { console.error('Usage : ASC_KEY_ID, ASC_ISSUER_ID et le chemin du .p8 sont requis.'); process.exit(1); }

const b64 = (b) => Buffer.from(b).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = b64(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: createPrivateKey(readFileSync(keyPath)), dsaEncoding: 'ieee-p1363' });
const jwt = `${header}.${payload}.${b64(signature)}`;
const headers = { Authorization: `Bearer ${jwt}` };

const list = await fetch('https://api.appstoreconnect.apple.com/v1/certificates?limit=200', { headers });
// Erreurs écrites en commandes GitHub (::error:: / ::warning::) : elles deviennent des annotations lisibles SANS compte (12/11/2026,
// build 7 en échec ici sans aucun message visible).
if (!list.ok) { console.log(`::error::App Store Connect refuse la liste des certificats : HTTP ${list.status} — ${(await list.text()).slice(0, 300).replace(/\s+/g, ' ')}`); process.exit(1); }
const { data = [] } = await list.json();
console.log(`${data.length} certificat(s) dans le compte :`);
for (const c of data) console.log(` - ${c.id} | ${c.attributes.certificateType} | ${c.attributes.name} | expire ${c.attributes.expirationDate}`);

const targets = data.filter((c) => ['DEVELOPMENT', 'IOS_DEVELOPMENT'].includes(c.attributes.certificateType) && /Created via API/i.test(c.attributes.name ?? ''));
console.log(`${targets.length} certificat(s) de développement « Created via API » à supprimer.`);
for (const c of targets) {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/certificates/${c.id}`, { method: 'DELETE', headers });
  console.log(` suppression ${c.id} : ${r.status}`);
  // Un refus ici n'arrête plus tout : si l'ancien certificat gêne vraiment, l'archivage le dira (annotation de l'étape suivante).
  if (!r.ok && r.status !== 404) console.log(`::warning::Suppression du certificat ${c.id} refusée : HTTP ${r.status} — ${(await r.text()).slice(0, 300).replace(/\s+/g, ' ')}`);
}
