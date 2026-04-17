import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const configuredApiBaseUrl = ((import.meta as any).env?.VITE_API_BASE_URL || '')
  .toString()
  .trim()
  .replace(/\/+$/, '');
const isGitHubPages = typeof window !== 'undefined' && window.location.hostname === 'yethish2010.github.io';
const apiBaseUrl = configuredApiBaseUrl;

const STATIC_SESSION_STORAGE_KEY = 'smart-campus-static-session';
const staticAdminUser = {
  id: 1,
  email: 'admin@smartcampus.ai',
  role: 'Administrator',
  name: 'Master Admin',
  department: 'Administration',
  designation: 'System Administrator',
  responsibilities: '',
  access_limits: '',
  access_paths: '',
  force_password_change: false,
};

const createJsonResponse = (payload: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

const getStoredStaticSession = () => {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(STATIC_SESSION_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
};

const persistStaticSession = (user: typeof staticAdminUser | null) => {
  if (typeof window === 'undefined') return;

  try {
    if (user) {
      window.localStorage.setItem(STATIC_SESSION_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(STATIC_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in static demo mode.
  }
};

const getRequestMethod = (input: RequestInfo | URL, init?: RequestInit) =>
  (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

const getRequestPath = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;

  const requestUrl = new URL(input.url);
  return `${requestUrl.pathname}${requestUrl.search}`;
};

const readRequestJsonBody = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    if (init?.body && typeof init.body === 'string') {
      return JSON.parse(init.body);
    }

    if (input instanceof Request) {
      return JSON.parse(await input.clone().text());
    }
  } catch {
    return null;
  }

  return null;
};

const handleStaticApiRequest = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = getRequestMethod(input, init);
  const path = getRequestPath(input);
  const pathname = path.split('?')[0];

  if (pathname === '/api/auth/login' && method === 'POST') {
    const requestBody = await readRequestJsonBody(input, init);
    const email = requestBody?.email?.toString().trim().toLowerCase();
    const password = requestBody?.password?.toString();

    if (email === staticAdminUser.email && password === 'admin123') {
      persistStaticSession(staticAdminUser);
      return createJsonResponse({ user: staticAdminUser });
    }

    return createJsonResponse({ error: 'Invalid credentials' }, { status: 401 });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getStoredStaticSession();
    return user
      ? createJsonResponse({ user })
      : createJsonResponse({ error: 'Not logged in' }, { status: 401 });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    persistStaticSession(null);
    return createJsonResponse({ success: true });
  }

  if (pathname === '/api/auth/change-password' && method === 'POST') {
    const user = getStoredStaticSession();
    if (!user) {
      return createJsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    return createJsonResponse({ user });
  }

  if (pathname === '/api/dashboard/stats' && method === 'GET') {
    return createJsonResponse({
      totalBuildings: 0,
      availableNow: 0,
      scheduledRooms: 0,
      equipmentIssues: 0,
      pendingBookings: 0,
      recentAlerts: [],
    });
  }

  if (pathname === '/api/analytics/utilization-trends' && method === 'GET') {
    return createJsonResponse([]);
  }

  if (pathname === '/api/reports/utilization' && method === 'GET') {
    return createJsonResponse({
      schoolReports: [],
      roomReports: [],
      overallUtilization: 0,
    });
  }

  if (pathname === '/api/notifications' && method === 'GET') {
    return createJsonResponse([]);
  }

  if (pathname === '/api/notifications/read-all' && method === 'POST') {
    return createJsonResponse({ success: true });
  }

  if (pathname.startsWith('/api/')) {
    return method === 'GET'
      ? createJsonResponse([])
      : createJsonResponse({ success: true });
  }

  return null;
};

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
} else if (isGitHubPages && typeof window !== 'undefined') {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestPath = getRequestPath(input);
    if (requestPath.startsWith('/api/')) {
      const mockResponse = await handleStaticApiRequest(input, init);
      if (mockResponse) return mockResponse;
    }

    return nativeFetch(input, init);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
