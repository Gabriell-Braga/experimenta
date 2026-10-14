import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { ToastProvider } from './ui';

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
