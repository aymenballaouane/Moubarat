import { createElement, Fragment, type ReactNode } from 'react';

/* Comme `fillTemplate`, mais chaque valeur peut être un élément React — pour isoler un nom latin, une heure ou un numéro dans une
   phrase arabe (dossier §9 : « isolés du texte arabe qui les entoure ») sans que la ponctuation saute de l'autre côté
   (« Karim B. · organisateur » s'affichait « .Karim B »). */
export function fillNodes(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{[a-zA-Z]+\})/g);
  return createElement(Fragment, null, ...parts.map((p, i) => {
    const m = /^\{([a-zA-Z]+)\}$/.exec(p);
    return m && m[1] !== undefined && m[1] in vars ? createElement(Fragment, { key: i }, vars[m[1]]) : p;
  }));
}
