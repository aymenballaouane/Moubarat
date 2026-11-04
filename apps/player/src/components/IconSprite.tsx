import sprite from '../../../../design/sprite-icons.svg?raw';

export function IconSprite() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
      <defs dangerouslySetInnerHTML={{ __html: sprite }} />
    </svg>
  );
}
