interface IconProps { id: string; className?: string }

export function Icon({ id, className }: IconProps) {
  return (
    <svg className={`mb-ic${className ? ` ${className}` : ''}`} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}
