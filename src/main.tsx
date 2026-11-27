import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { DesktopWidget } from './components/desktop_widget';
import './styles/global.css';

const isWidgetMode =
  new URLSearchParams(window.location.search).get('widget') === '1';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isWidgetMode ? <DesktopWidget /> : <App />}
  </React.StrictMode>
);