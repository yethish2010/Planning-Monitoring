import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const configuredApiBaseUrl = ((import.meta as any).env?.VITE_API_BASE_URL || '')
  .toString()
  .trim()
  .replace(/\/+$/, '');
const defaultApiBaseUrl = typeof window !== 'undefined' && window.location.hostname === 'yethish2010.github.io'
  ? 'https://mbu-planning.vercel.app'
  : '';
const apiBaseUrl = configuredApiBaseUrl || defaultApiBaseUrl;

if (apiBaseUrl && typeof window !== 'undefined') {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(`${apiBaseUrl}${input}`, {
        ...init,
        credentials: init?.credentials ?? 'include',
      });
    }

    if (input instanceof Request) {
      const currentOrigin = window.location.origin;
      if (input.url.startsWith(`${currentOrigin}/api/`)) {
        const rewrittenUrl = `${apiBaseUrl}${input.url.slice(currentOrigin.length)}`;
        const rewrittenRequest = new Request(rewrittenUrl, input);
        return nativeFetch(rewrittenRequest, {
          ...init,
          credentials: init?.credentials ?? input.credentials ?? 'include',
        });
      }
    }

    return nativeFetch(input, init);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
