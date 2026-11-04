import sprite from '../../../../design/sprite-icons.svg?raw';

/** Injecte les 37 symboles gelés (design/sprite-icons.svg) une seule fois — même patron que apps/crm. */
export function IconSprite() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
      <defs dangerouslySetInnerHTML={{ __html: sprite }} />
    </svg>
  );
}
