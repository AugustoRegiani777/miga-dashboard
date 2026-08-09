const SUPABASE_URL = "https://iknytfgqkdddtqpykgab.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrbnl0Zmdxa2RkZHRxcHlrZ2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjY1OTQsImV4cCI6MjA5ODI0MjU5NH0.1qAJ71w1DaZu1i0G5an6AOuLwyu4_OU-uMvms4AjM0w";

const BASE = `${SUPABASE_URL}/rest/v1`;
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;
const SESSION_KEY = "miga_dashboard_session";
const LOGIN_DOMAIN = "migapos.local";

// --- Sesion (mismo mecanismo de Supabase Auth que ya usa la app principal,
// pero copiado aca: este proyecto es independiente, no comparte sesion con
// miga-pos-v2 aunque hablen con el mismo Supabase). ---

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  catch { /* localStorage lleno o no disponible */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignorar */ }
}

function sessionFromAuthResponse(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
}

async function authFetch(path, body) {
  let res;
  try {
    res = await fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    const networkError = new Error("Sin conexion con el servidor de autenticacion.");
    networkError.isNetworkError = true;
    throw networkError;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error_description || data?.msg || `Error de autenticacion (${res.status})`);
  }
  return data;
}

function normalizeLogin(usuario) {
  const clean = usuario.trim().toLowerCase();
  return clean.includes("@") ? clean : `${clean}@${LOGIN_DOMAIN}`;
}

export async function signIn(usuario, password) {
  const data = await authFetch("/token?grant_type=password", { email: normalizeLogin(usuario), password });
  const session = sessionFromAuthResponse(data);
  saveSession(session);
  return session;
}

export function signOut() {
  clearSession();
}

async function refreshSession(session) {
  const data = await authFetch("/token?grant_type=refresh_token", { refresh_token: session.refreshToken });
  const newSession = sessionFromAuthResponse(data);
  saveSession(newSession);
  return newSession;
}

export async function restoreSession() {
  const session = loadSession();
  if (!session) return null;
  try {
    return await refreshSession(session);
  } catch (error) {
    if (error.isNetworkError) return session;
    clearSession();
    return null;
  }
}

function authHeaders(accessToken) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

// Consulta de solo lectura, con renovacion automatica del token si vencio.
export async function sbGet(path) {
  let session = loadSession();
  const doFetch = (accessToken) => fetch(`${BASE}${path}`, { headers: authHeaders(accessToken) });

  let res = await doFetch(session?.accessToken);
  if (res.status === 401 && session?.refreshToken) {
    try {
      session = await refreshSession(session);
      res = await doFetch(session.accessToken);
    } catch {
      clearSession();
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase GET ${path} -> ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}
