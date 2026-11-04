/** Port fidele de #toast (prototype) : un seul message a la fois, en bas de
    l'ecran, auto-disparait — App.tsx pilote le minuteur (meme discipline que
    la modale, un seul point d'etat partage plutot qu'un par ecran). */
export function Toast({ message }: { message: string | null }) {
  return <div className={`cm-toast${message ? ' on' : ''}`}>{message}</div>;
}
