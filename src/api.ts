import type {
  AgentCommand,
  OperationPlan,
  PlanDay,
  PlanEntry,
  ReportDocument,
  Study,
  UserRequest
} from "./types";

const API_ROOT = "/api";
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
        ...(init.body ? { "Content-Type": "application/json" } : {}),
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

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function checkHealth(): Promise<string> {
  const response = await fetch(`${API_ROOT}/`, {
    headers: { Accept: "text/plain" }
  });
  if (!response.ok) {
    throw new ApiError(`Сервер вернул ошибку ${response.status}`, response.status);
  }
  return response.text();
}

export async function getStudies(): Promise<Study[]> {
  const response = await request<Study[]>("/studies?page=1&page_size=100");
  return Array.isArray(response) ? response : [];
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

export async function getReports(): Promise<ReportDocument[]> {
  const response = await request<ReportDocument[]>("/reports?limit=30");
  return Array.isArray(response) ? response : [];
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
          entries: Array.isArray(day.entries) ? day.entries : []
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
    body: JSON.stringify({ entries })
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
