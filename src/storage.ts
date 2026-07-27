import type { AppSettings, UserRequest } from "./types";

const SETTINGS_KEY = "viewer.settings.v1";
const REQUESTS_KEY = "viewer.requests.v1";

export const defaultSettings: AppSettings = {
  agentId: 2,
  userId: "doctor-local"
};

function hasStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadSettings(): AppSettings {
  if (!hasStorage()) return defaultSettings;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      agentId:
        Number.isInteger(Number(stored.agentId)) && Number(stored.agentId) > 0
          ? Number(stored.agentId)
          : defaultSettings.agentId,
      userId:
        typeof stored.userId === "string" && stored.userId.trim()
          ? stored.userId.trim()
          : defaultSettings.userId
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadRequests(): UserRequest[] {
  if (!hasStorage()) return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(REQUESTS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function saveRequests(requests: UserRequest[]): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(
    REQUESTS_KEY,
    JSON.stringify(requests.slice(0, 40))
  );
}
