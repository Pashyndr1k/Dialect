import React from 'react';
import ReactDOM from 'react-dom/client';
import { Shell } from './Shell.tsx';
import { refuseWebMenu } from './nomenu.ts';
import './styles.css';
import './graph/graph.css';

refuseWebMenu();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
);
