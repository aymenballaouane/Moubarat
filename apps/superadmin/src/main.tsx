import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../design/moubarat-ds.css';
import './styles/superadmin.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
