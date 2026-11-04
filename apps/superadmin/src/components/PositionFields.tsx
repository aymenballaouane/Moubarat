import { outsideAlgeria, parseCoordinates } from '../lib/coords.js';

/* Position d'un centre : un champ où l'on colle « latitude, longitude » depuis Google Maps (remplit les
   deux nombres), puis latitude et longitude éditables. Partagé par la création d'un centre et la
   modification de sa fiche — une seule logique de collage et d'avertissement. À poser DANS une grille
   `.sa-form-grid` (fragment, pas de conteneur propre). Un texte non reconnu ne touche à rien : jamais un
   remplissage silencieux avec une valeur devinée. */

export interface PositionValue { position: string; lat: string; lng: string }

export function PositionFields({ value, onChange }: { value: PositionValue; onChange: (next: PositionValue) => void }) {
  const parsed = value.position.trim() ? parseCoordinates(value.position) : null;
  const latN = Number(value.lat), lngN = Number(value.lng);
  const outside = value.lat !== '' && value.lng !== '' && Number.isFinite(latN) && Number.isFinite(lngN)
    && outsideAlgeria({ lat: latN, lng: lngN });

  function onPositionChange(text: string) {
    const c = text.trim() ? parseCoordinates(text) : null;
    onChange({ ...value, position: text, ...(c ? { lat: String(c.lat), lng: String(c.lng) } : {}) });
  }

  return (
    <>
      <label className="mb-field" style={{ gridColumn: '1 / -1' }}>
        <span className="mb-field__label">Position — colle « latitude, longitude » depuis Google Maps</span>
        <input className="mb-field__control" placeholder="36.7538, 3.0588" autoComplete="off" value={value.position}
          onChange={(e) => onPositionChange(e.target.value)} data-testid="centre-position" />
        {value.position.trim() ? (
          parsed
            ? <span className="sa-view-note" role="status">Latitude {parsed.lat} · Longitude {parsed.lng}</span>
            : <span className="mb-field__error">Format non reconnu — colle deux nombres « latitude, longitude » (ou un lien Google Maps).</span>
        ) : null}
      </label>
      <label className="mb-field">
        <span className="mb-field__label">Latitude</span>
        <input className="mb-field__control" required type="number" step="any" value={value.lat}
          onChange={(e) => onChange({ ...value, lat: e.target.value })} />
      </label>
      <label className="mb-field">
        <span className="mb-field__label">Longitude</span>
        <input className="mb-field__control" required type="number" step="any" value={value.lng}
          onChange={(e) => onChange({ ...value, lng: e.target.value })} />
      </label>
      {outside ? (
        <p className="sa-view-note" style={{ gridColumn: '1 / -1', color: 'var(--gold)' }} role="status">
          Ces coordonnées ne sont pas en Algérie — vérifie que la latitude (environ 36 pour Alger) et la longitude (environ 3) ne sont pas inversées.
        </p>
      ) : null}
    </>
  );
}
