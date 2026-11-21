import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register Workbox PWA service worker for offline thumbnail caching & installability
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
