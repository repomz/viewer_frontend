import type {
  AgentCommand,
  AgentLogEntry,
  HistoricalStatistics,
  OperationStatistics,
  OperationPlan,
  PlanDay,
  PlanEntry,
  DutySchedule,
  ReportDocument,
  Study,
  UserRequest,
  VMPStatisticsConfig,
  DriveListing,
  PlatformMetrics
} from "./types";
import { authToken, type AuthUser, type StoredAuth } from "./authStorage";

const API_ROOT = "/api";
export const recordAppOpen = (eventId: string) => request<void>("/auth/app-open", {
  method: "POST", body: JSON.stringify({ event_id: eventId })
});
export type AgentConfiguration = {
  agent_id: number;
  received_at: string;
  configuration: {
    version: string;
    description: string;
    log_dir: string;
    state_file: string;
    pacs_config_path: string;
    heartbeat_interval_min: number;
    study_polling: { state: boolean; interval_min: number; operations_dir?: string[] };
    xa_polling: { state: boolean; interval_min: number };
    ct_polling: { state: boolean; interval_min: number };
    user_requests_polling: { state: boolean; interval_min: number };
  };
};
export const getAgentConfigurations = () => request<AgentConfiguration[]>("/agent_configurations");
const DEFAULT_TIMEOUT = 15_000;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function normalizePayload<T>(value: T): T {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: T }).data;
  }
  return value;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeout = DEFAULT_TIMEOUT
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
        ...init.headers
      },
      signal: controller.signal
    });

    const raw = await response.text();
    const body = raw ? parseJSON(raw) : null;
    if (!response.ok) {
      const serverMessage =
        body && typeof body === "object"
          ? String(
              (body as Record<string, unknown>).message ??
                (body as Record<string, unknown>).error ??
                ""
            )
          : "";
      throw new ApiError(
        serverMessage || `Сервер вернул ошибку ${response.status}`,
        response.status
      );
    }
    return normalizePayload(body as T);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("Сервер не ответил вовремя");
    }
    throw new ApiError("Не удалось связаться с сервером");
  } finally {
    clearTimeout(timer);
  }
}

export async function login(loginValue: string, password: string): Promise<StoredAuth> {
  return request<StoredAuth>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ login: loginValue, password })
  });
}

export async function getCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me");
}

export async function changeCredentials(input: {
  currentPassword: string;
  newLogin?: string;
  newPassword?: string;
}): Promise<StoredAuth> {
  return request<StoredAuth>("/auth/change-credentials", {
    method: "POST",
    body: JSON.stringify({
      current_password: input.currentPassword,
      new_login: input.newLogin ?? "",
      new_password: input.newPassword ?? ""
    })
  });
}

export async function logout(): Promise<void> {
  await request<void>("/auth/logout", { method: "POST" });
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  return request<PlatformMetrics>("/admin/metrics");
}

export async function getDriveFiles(): Promise<DriveListing> {
  return request<DriveListing>("/drive");
}

export async function uploadDriveFile(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await request("/drive", { method: "POST", body: form }, 30 * 60_000);
}

export async function deleteDriveFile(id: string): Promise<void> {
  await request(`/drive/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function downloadDriveFile(id: string, filename: string): Promise<void> {
  const controller = new AbortController();
  const response = await fetch(`${API_ROOT}/drive/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${authToken()}` },
    signal: controller.signal
  });
  if (!response.ok) throw new ApiError("Не удалось скачать файл", response.status);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function checkHealth(): Promise<string> {
  return request<string>("/", { headers: { Accept: "text/plain" } }, 5_000);
}

export async function getBackendVersion(): Promise<{
  version: string;
  revision: string;
}> {
  return request<{ version: string; revision: string }>("/version", {}, 5_000);
}

export async function getStudies(): Promise<Study[]> {
  const response = await request<Study[]>("/studies?page=1&page_size=100");
  return Array.isArray(response) ? response : [];
}

export async function suggestProtocolStudies(
  patient: string,
  scope: "year" | "archive" = "year"
): Promise<Study[]> {
  const params = new URLSearchParams({ patient, scope, limit: "20" });
  const response = await request<Study[]>(`/studies/suggest?${params.toString()}`);
  return Array.isArray(response) ? response : [];
}

export async function linkStudyAngiography(
  studyID: string,
  xaStudyUID: string
): Promise<Study> {
  return request<Study>(`/studies/${encodeURIComponent(studyID)}/dicom-link`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dicom_link: `xa://study/${xaStudyUID}` })
  });
}

export async function searchStudies(filters: {
  studyType?: string;
  surgeon?: string;
  studyDate?: string;
}): Promise<Study[]> {
  const params = new URLSearchParams();
  if (filters.studyType) params.set("study_type", filters.studyType);
  if (filters.surgeon) params.set("surgeon", filters.surgeon);
  if (filters.studyDate) params.set("study_date", filters.studyDate);
  const response = await request<Study[]>(`/studies/search?${params.toString()}`);
  return Array.isArray(response) ? response : [];
}

export async function createUserRequest(input: {
  userId: string;
  agentId: number;
  command: AgentCommand;
  payload?: Record<string, unknown>;
}): Promise<UserRequest> {
  return request<UserRequest>("/user_requests", {
    method: "POST",
    body: JSON.stringify({
      user_id: input.userId,
      agent_id: input.agentId,
      request_type: "execute_command",
      command: input.command,
      payload: input.payload ?? {},
      max_attempts: 3
    })
  });
}

export async function getUserRequest(id: string): Promise<UserRequest> {
  return request<UserRequest>(`/user_requests/${encodeURIComponent(id)}`);
}

export async function getUserRequests(
  userId: string,
  agentId: number
): Promise<UserRequest[]> {
  const params = new URLSearchParams({
    user_id: userId,
    agent_id: String(agentId),
    limit: "100"
  });
  const response = await request<UserRequest[]>(
    `/user_requests/history?${params.toString()}`
  );
  return Array.isArray(response) ? response : [];
}

export async function deleteUserRequest(id: string, userId: string): Promise<void> {
  await request(`/user_requests/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

export async function deleteAllUserRequests(
  userId: string,
  agentId: number
): Promise<void> {
  const params = new URLSearchParams({
    user_id: userId,
    agent_id: String(agentId)
  });
  await request(`/user_requests/history?${params.toString()}`, {
    method: "DELETE"
  });
}

export async function deleteStudy(id: string): Promise<void> {
  await request(`/studies/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteAllStudies(): Promise<void> {
  await request("/studies", { method: "DELETE" });
}

export async function getReports(agentId?: number): Promise<ReportDocument[]> {
  const params = new URLSearchParams({ limit: "30" });
  if (agentId) params.set("agent_id", String(agentId));
  const response = await request<ReportDocument[]>(`/reports?${params.toString()}`);
  return Array.isArray(response)
    ? response.filter(
        (report) => !agentId || Number(report.agent_id) === agentId
      )
    : [];
}

export async function generateReport(input: {
  agentId: number;
  days?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<ReportDocument> {
  return request<ReportDocument>("/reports/generate", {
    method: "POST",
    body: JSON.stringify({
      agent_id: input.agentId,
      ...(input.days ? { days: input.days } : {}),
      ...(input.dateFrom ? { date_from: input.dateFrom } : {}),
      ...(input.dateTo ? { date_to: input.dateTo } : {})
    })
  }, 30_000);
}

export async function getOperationPlan(
  weekStart?: string
): Promise<OperationPlan> {
  const query = weekStart
    ? `?week_start=${encodeURIComponent(weekStart)}`
    : "";
  const response = await request<OperationPlan>(`/operation-plan${query}`);
  return {
    week_start:
      typeof response?.week_start === "string" ? response.week_start : "",
    days: Array.isArray(response?.days)
      ? response.days.map((day) => ({
          ...day,
          entries: Array.isArray(day.entries)
            ? day.entries.map((entry) => ({
                ...entry,
                additions:
                  typeof entry.additions === "string" ? entry.additions : ""
              }))
            : []
        }))
      : []
  };
}

export async function saveOperationPlanDay(
  date: string,
  entries: PlanEntry[]
): Promise<PlanDay> {
  return request<PlanDay>(`/operation-plan/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify({
      entries: entries.map(({ patient, department, operation, additions }) => ({
        patient,
        department,
        operation,
        additions
      }))
    })
  });
}

export async function getDutySchedule(month: string): Promise<DutySchedule> {
  return request<DutySchedule>(`/duty-schedule/${encodeURIComponent(month)}`);
}

export async function saveDutySchedule(
  month: string,
  schedule: DutySchedule
): Promise<DutySchedule> {
  return request<DutySchedule>(`/duty-schedule/${encodeURIComponent(month)}`, {
    method: "PUT",
    body: JSON.stringify(schedule)
  });
}

export async function getOperationStatistics(): Promise<OperationStatistics> {
  return request<OperationStatistics>("/statistics/operations");
}

export async function getHistoricalStatistics(): Promise<HistoricalStatistics> {
  return request<HistoricalStatistics>("/statistics/history");
}

export async function saveVMPStatisticsConfig(
  config: VMPStatisticsConfig
): Promise<OperationStatistics> {
  return request<OperationStatistics>("/statistics/vmp", {
    method: "PUT",
    body: JSON.stringify({
      operation_types: config.operationTypes,
      included_study_ids: config.includedStudyIds,
      excluded_study_ids: config.excludedStudyIds
    })
  });
}

export async function getReport(filename: string): Promise<ReportDocument> {
  return request<ReportDocument>(`/reports/${encodeURIComponent(filename)}`);
}

export async function deleteReport(filename: string): Promise<void> {
  await request(`/reports/${encodeURIComponent(filename)}`, {
    method: "DELETE"
  });
}

export async function getAgentHeartbeatTimes(
  agentId: number,
  status?: "well" | "with_errors"
): Promise<string[]> {
  const params = new URLSearchParams({ agent_id: String(agentId) });
  params.set("limit", "1");
  if (status) params.set("status", status);
  const endpoint = status
    ? "/agent_status/searchby_status"
    : "/agent_status/searchby_id";
  const response = await request<string[]>(
    `${endpoint}?${params.toString()}`
  );
  return Array.isArray(response) ? response : [];
}

export async function getAgents(): Promise<number[]> {
  const response = await request<number[]>("/agents");
  return Array.isArray(response)
    ? response.filter((value) => Number.isInteger(value) && value > 0)
    : [];
}

export async function getAgentLogs(
  agentId: number,
  date: string
): Promise<AgentLogEntry[]> {
  const params = new URLSearchParams({
    agent_id: String(agentId),
    date
  });
  const response = await request<AgentLogEntry[]>(
    `/agent_logs?${params.toString()}`
  );
  return Array.isArray(response) ? response : [];
}
