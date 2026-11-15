import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../design/moubarat-ds.css';
import './styles/fonts.css';
import './styles/crm.css';
import { App } from './App.js';
import { applyLang, loadLang } from './lib/lang.js';

// CRM en arabe (P1-15) : la langue du poste s'applique AVANT le premier rendu — jamais un éclair dans le mauvais sens de lecture.
applyLang(loadLang());

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
