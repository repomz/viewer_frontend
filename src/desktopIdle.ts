export const DESKTOP_IDLE_MS = 30 * 60 * 1000;
const KEY = "viewer.desktop-activity.v1";
export function desktopIdleExpired(token: string, now = Date.now()): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return value?.token === token && Number.isFinite(value.at) && now - value.at >= DESKTOP_IDLE_MS;
  } catch { return false; }
}
export function rememberDesktopActivity(token: string, now = Date.now()) {
  try { localStorage.setItem(KEY, JSON.stringify({ token, at: now })); } catch { /* unavailable storage */ }
}

// A resumed/suspended tab checks expiration BEFORE recording new activity.
export function watchDesktopIdle(token: string, expire: () => void): () => void {
  let ended = false;
  let lastWrite = 0;
  const check = () => {
    if (!ended && desktopIdleExpired(token)) { ended = true; expire(); }
    return ended;
  };
  const activity = () => {
    if (check() || document.visibilityState === "hidden") return;
    if (Date.now() - lastWrite > 1000) { rememberDesktopActivity(token); lastWrite = Date.now(); }
  };
  if (!check()) rememberDesktopActivity(token);
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
  events.forEach(event => window.addEventListener(event, activity, { passive: true }));
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  const timer = setInterval(check, 1000);
  return () => {
    clearInterval(timer);
    events.forEach(event => window.removeEventListener(event, activity));
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", check);
  };
}
