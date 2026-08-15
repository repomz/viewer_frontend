import type {
  AppSettings,
  DutySchedule,
  HistoricalStatistics,
  OperationStatistics,
  OperationPlan,
  ReportDocument,
  Study,
  UserRequest
} from "./types";

const SETTINGS_KEY = "viewer.settings.v1";
const REQUESTS_KEY = "viewer.requests.v1";
const REPORTS_KEY_PREFIX = "viewer.reports.v1";
const PLAN_KEY_PREFIX = "viewer.operation-plan.v1";
const STUDIES_KEY = "viewer.studies.v1";
const XA_STUDIES_KEY = "viewer.xa-studies.v1";
const PINNED_PROTOCOLS_KEY = "viewer.pinned-protocols.v1";
const OPERATION_STATISTICS_KEY = "viewer.operation-statistics.v1";
const HISTORICAL_STATISTICS_KEY = "viewer.historical-statistics.v1";
const DUTY_SCHEDULE_KEY_PREFIX = "viewer.duty-schedule.v1";
const DRESSING_CHECKS_KEY_PREFIX = "viewer.dressing-checks.v1";

type PinnedProtocol = { study: Study; expiresAt: string };

function nextClinicalCleanup(): Date {
  const date = new Date();
  const daysUntilMonday = ((8 - date.getDay()) % 7) || 7;
  date.setDate(date.getDate() + daysUntilMonday);
  date.setHours(9, 0, 0, 0);
  return date;
}

export const defaultSettings: AppSettings = {
  agentId: 2,
  agentIds: [2],
  selectedAgentIds: [2],
  userId: "doctor-local",
  autoDownloadAngiography: true
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
      autoDownloadAngiography: true
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

export function loadReportsCache(agentId: number): ReportDocument[] {
  if (!hasStorage()) return [];
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(`${REPORTS_KEY_PREFIX}.${agentId}`) ?? "[]"
    );
    return Array.isArray(stored) ? stored.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function saveReportsCache(
  agentId: number,
  reports: ReportDocument[]
): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(
    `${REPORTS_KEY_PREFIX}.${agentId}`,
    JSON.stringify(reports.slice(0, 30))
  );
}

export function loadDressingChecks(roundID: string): string[] {
  if (!hasStorage() || !roundID) return [];
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(`${DRESSING_CHECKS_KEY_PREFIX}.${roundID}`) ?? "[]"
    );
    return Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveDressingChecks(roundID: string, patientIDs: string[]): void {
  if (!hasStorage() || !roundID) return;
  window.localStorage.setItem(
    `${DRESSING_CHECKS_KEY_PREFIX}.${roundID}`,
    JSON.stringify([...new Set(patientIDs)])
  );
}

export function loadOperationPlanCache(
  weekStart: string
): OperationPlan | null {
  if (!hasStorage()) return null;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(`${PLAN_KEY_PREFIX}.${weekStart}`) ?? "null"
    ) as OperationPlan | null;
    return stored && Array.isArray(stored.days) ? stored : null;
  } catch {
    return null;
  }
}

export function saveOperationPlanCache(plan: OperationPlan): void {
  if (!hasStorage() || !plan.week_start) return;
  window.localStorage.setItem(
    `${PLAN_KEY_PREFIX}.${plan.week_start}`,
    JSON.stringify(plan)
  );
}

export function loadOperationStatisticsCache(): OperationStatistics | null {
  if (!hasStorage()) return null;
  try {
    return JSON.parse(window.localStorage.getItem(OPERATION_STATISTICS_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function saveOperationStatisticsCache(value: OperationStatistics): void {
  if (hasStorage()) window.localStorage.setItem(OPERATION_STATISTICS_KEY, JSON.stringify(value));
}

export function loadHistoricalStatisticsCache(): HistoricalStatistics | null {
  if (!hasStorage()) return null;
  try {
    return JSON.parse(window.localStorage.getItem(HISTORICAL_STATISTICS_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function saveHistoricalStatisticsCache(value: HistoricalStatistics): void {
  if (hasStorage()) window.localStorage.setItem(HISTORICAL_STATISTICS_KEY, JSON.stringify(value));
}

export function loadDutyScheduleCache(month: string): DutySchedule | null {
  if (!hasStorage()) return null;
  try {
    return JSON.parse(window.localStorage.getItem(`${DUTY_SCHEDULE_KEY_PREFIX}.${month}`) ?? "null");
  } catch {
    return null;
  }
}

export function saveDutyScheduleCache(value: DutySchedule): void {
  if (hasStorage()) {
    window.localStorage.setItem(`${DUTY_SCHEDULE_KEY_PREFIX}.${value.month}`, JSON.stringify(value));
  }
}

export function loadStudiesCache(): Study[] {
  if (!hasStorage()) return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(STUDIES_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.slice(0, 500) : [];
  } catch {
    return [];
  }
}

export function saveStudiesCache(studies: Study[]): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(STUDIES_KEY, JSON.stringify(studies.slice(0, 500)));
}

export function loadPinnedProtocols(): Study[] {
  if (!hasStorage()) return [];
  try {
    const now = Date.now();
    const stored = JSON.parse(window.localStorage.getItem(PINNED_PROTOCOLS_KEY) ?? "[]") as PinnedProtocol[];
    const current = stored.filter((item) => item?.study && new Date(item.expiresAt).getTime() > now);
    window.localStorage.setItem(PINNED_PROTOCOLS_KEY, JSON.stringify(current));
    return current.map((item) => item.study);
  } catch {
    return [];
  }
}

export function pinProtocol(study: Study): void {
  if (!hasStorage()) return;
  const current = loadPinnedProtocols().filter((item) => item.id !== study.id);
  const entries: PinnedProtocol[] = [study, ...current].slice(0, 30).map((item) => ({
    study: item,
    expiresAt: nextClinicalCleanup().toISOString()
  }));
  window.localStorage.setItem(PINNED_PROTOCOLS_KEY, JSON.stringify(entries));
}

export function loadXAStudiesCache(): Study[] {
  if (!hasStorage()) return [];
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(XA_STUDIES_KEY) ?? "[]"
    );
    return Array.isArray(stored) ? stored.slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function saveXAStudiesCache(studies: Study[]): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(
    XA_STUDIES_KEY,
    JSON.stringify(studies.slice(0, 200))
  );
}
