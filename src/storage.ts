import type { AppSettings, UserRequest } from "./types";

const SETTINGS_KEY = "viewer.settings.v1";
const REQUESTS_KEY = "viewer.requests.v1";

export const defaultSettings: AppSettings = {
  agentId: 2,
  agentIds: [2],
  selectedAgentIds: [2],
  userId: "doctor-local",
  autoDownloadAngiography: false
};

function hasStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadSettings(): AppSettings {
  if (!hasStorage()) return defaultSettings;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}");
    const legacyAgentId =
      Number.isInteger(Number(stored.agentId)) && Number(stored.agentId) > 0
        ? Number(stored.agentId)
        : defaultSettings.agentId;
    const agentIds: number[] = Array.isArray(stored.agentIds)
      ? [...new Set<number>(stored.agentIds.map(Number).filter(
          (value: number) => Number.isInteger(value) && value > 0
        ))]
      : [legacyAgentId];
    const selectedAgentIds: number[] = Array.isArray(stored.selectedAgentIds)
      ? [...new Set<number>(stored.selectedAgentIds.map(Number).filter(
          (value: number) => agentIds.includes(value)
        ))]
      : [legacyAgentId];
    const normalizedSelected = selectedAgentIds.length
      ? selectedAgentIds.slice(0, 2)
      : [agentIds[0] ?? legacyAgentId];
    return {
      agentId: normalizedSelected[0] ?? legacyAgentId,
      agentIds: agentIds.length ? agentIds : [legacyAgentId],
      selectedAgentIds: normalizedSelected,
      userId:
        typeof stored.userId === "string" && stored.userId.trim()
          ? stored.userId.trim()
          : defaultSettings.userId,
      autoDownloadAngiography: stored.autoDownloadAngiography === true
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
