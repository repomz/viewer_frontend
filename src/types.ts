export type Study = {
  id: string;
  created_at: string;
  updated_at: string;
  study_id: string;
  patient: string;
  age: number;
  department: string;
  name_operation: string;
  study_type: string;
  descr_operation: string;
  recommendation?: string;
  time_beginning: string;
  time_duration: number;
  surgeon: string;
  dicom_link: string;
};

export type RequestStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "error"
  | string;

export type UserRequest = {
  id: string;
  created_at: string;
  updated_at: string;
  available_at: string;
  lease_expires_at?: string;
  completed_at?: string;
  status: RequestStatus;
  user_id: string;
  agent_id: number;
  request_type: string;
  command: AgentCommand;
  payload: Record<string, unknown> | string | null;
  result: Record<string, unknown> | string | null;
  errors?: string;
  attempt_count: number;
  max_attempts: number;
};

export type AgentCommand =
  | "sync_studies"
  | "find_study"
  | "import_study"
  | "find_xa"
  | "find_ct"
  | "get_xa"
  | "get_ct"
  | "send_xa_to_pacs"
  | "send_ct_to_pacs"
  | "xa_polling_on"
  | "xa_polling_off"
  | "ct_polling_on"
  | "ct_polling_off";

export type ReportDocument = {
  filename?: string;
  agent_id?: number;
  generated_at?: string;
  report?: unknown;
  [key: string]: unknown;
};

export type ReportOperation = {
  patient?: string;
  age?: string | number;
  department?: string;
  operation?: string;
  time_beginning?: string;
  time_duration?: string | number;
  surgeon?: string;
  previous_operations?: {
    date?: string;
    operation?: string;
    description?: string;
    recommendation?: string;
    surgeon?: string;
  }[];
};

export type OperationsReport = {
  date?: string;
  period_days?: number;
  period_start?: string;
  period_end?: string;
  planned_count?: number;
  emergency_total?: number;
  today_planned_count?: number;
  planned_operations?: ReportOperation[];
  emergency_operations?: ReportOperation[];
  today_planned_operations?: ReportOperation[];
};

export type AgentHealth = {
  online: boolean;
  status: "well" | "with_errors" | "offline" | "unknown";
  lastSeen?: Date;
  ageMs?: number;
};

export type ApiHealth = {
  ok: boolean;
  checkedAt: Date;
  message: string;
};

export type AppSettings = {
  agentId: number;
  agentIds: number[];
  selectedAgentIds: number[];
  userId: string;
  autoDownloadAngiography: boolean;
};

export type PlanEntry = {
  patient: string;
  department: string;
  operation: string;
  additions: string;
  previous_operations?: Study[];
  completed_operation?: Study;
};

export type PlanDay = {
  date: string;
  entries: PlanEntry[];
};

export type OperationPlan = {
  week_start: string;
  days: PlanDay[];
};

export type StatisticsOperationType = {
  id: string;
  label: string;
  total: number;
};

export type SurgeonStatistics = {
  surgeon: string;
  counts: Record<string, number>;
  vmp: number;
  total: number;
};

export type VMPPatient = {
  study_id: string;
  patient: string;
  operation: string;
  operation_type: string;
  surgeon: string;
  date: string;
  source: "type" | "patient";
};

export type OperationStatistics = {
  operation_types: StatisticsOperationType[];
  surgeons: SurgeonStatistics[];
  vmp_operation_types: string[];
  vmp_patients: VMPPatient[];
  included_study_ids: string[];
  excluded_study_ids: string[];
};

export type VMPStatisticsConfig = {
  operationTypes: string[];
  includedStudyIds: string[];
  excludedStudyIds: string[];
};

export type HistoricalStatisticsYear = {
  year: number;
  counts: Record<string, number>;
  total: number;
};

export type HistoricalStatistics = {
  source: string;
  start_year: number;
  end_year: number;
  generated_at: string;
  operation_types: string[];
  years: HistoricalStatisticsYear[];
};
