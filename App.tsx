import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets
} from "react-native-safe-area-context";

import {
  ApiError,
  checkHealth,
  createUserRequest,
  deleteReport,
  deleteUserRequest,
  getAgentHeartbeatTimes,
  getAgents,
  generateReport,
  getHistoricalStatistics,
  getDutySchedule,
  getOperationStatistics,
  getOperationPlan,
  getReports,
  getStudies,
  linkStudyAngiography,
  getUserRequests,
  getUserRequest,
  saveOperationPlanDay,
  saveDutySchedule,
  searchStudies,
  suggestProtocolStudies
} from "./src/api";
import { MobileDicomViewer } from "./src/MobileDicomViewer";
import { isPacsImagingStudy } from "./src/studyClassification";
import { findProtocolAngiography } from "./src/patientMatching";
import {
  defaultSettings,
  loadOperationPlanCache,
  loadOperationStatisticsCache,
  loadHistoricalStatisticsCache,
  loadDutyScheduleCache,
  loadRequests,
  loadReportsCache,
  loadSettings,
  loadStudiesCache,
  loadPinnedProtocols,
  loadXAStudiesCache,
  saveOperationPlanCache,
  saveOperationStatisticsCache,
  saveHistoricalStatisticsCache,
  saveDutyScheduleCache,
  saveRequests,
  saveReportsCache,
  saveStudiesCache,
  pinProtocol,
  saveXAStudiesCache,
  saveSettings
} from "./src/storage";
import {
  cancelDicomDownloads,
  clearDicomCache,
  pruneDicomCache,
  pruneExpiredDicomFrames,
  deleteStudyFromDevice,
  downloadStudyFirstSeriesForOffline,
  downloadStudyForOffline,
  formatStorageSize,
  getCachedPreparedXAManifest,
  getDicomCacheSnapshot,
  subscribeDicomCache,
  type DicomCacheSnapshot
} from "./src/dicomOfflineCache";
import {
  colors,
  darkColors,
  layout,
  radii,
  shadow,
  typography
} from "./src/theme";
import type {
  AgentCommand,
  AgentHealth,
  ApiHealth,
  AppSettings,
  DutySchedule,
  HistoricalStatistics,
  OperationStatistics,
  OperationPlan,
  OperationsReport,
  PlanEntry,
  ReportDocument,
  ReportOperation,
  Study,
  UserRequest
} from "./src/types";
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  Field,
  Icon,
  IconButton,
  InlineError,
  LoadingState,
  SearchField,
  Sheet,
  Toast,
  type IconName
} from "./src/ui";

if (Platform.OS !== "web") {
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

type Tab = "studies" | "plan" | "angiography" | "reports" | "schedule" | "statistics" | "logs" | "settings";
type ToastState = { message: string; tone: "success" | "danger" } | null;
type DayFilter = "1" | "2" | "3" | "4" | "5" | "6" | "7" | null;
type StudySort = "time" | "operation";
type StudySearchScope = "week" | "year" | "archive";
type StudyCategory =
  | "all"
  | "КАГ"
  | "ЦАГ"
  | "СТЕНТ КОР"
  | "СТЕНТ ВСА"
  | "СТЕНТ НОГИ"
  | "БАП НОГИ"
  | "ЭМА"
  | "ДРУГИЕ";

const tabs: { id: Tab; label: string; shortLabel: string; icon: IconName }[] = [
  {
    id: "studies",
    label: "Исследования",
    shortLabel: "Исслед.",
    icon: "reader-outline"
  },
  {
    id: "plan",
    label: "План",
    shortLabel: "План",
    icon: "calendar-outline"
  },
  {
    id: "angiography",
    label: "Ангиографии",
    shortLabel: "Ангио",
    icon: "scan-outline"
  },
  {
    id: "reports",
    label: "Отчёты",
    shortLabel: "Отчёты",
    icon: "document-text-outline"
  },
  {
    id: "schedule",
    label: "График",
    shortLabel: "График",
    icon: "time-outline"
  }
];

const desktopTabs = [
  ...tabs,
  {
    id: "statistics" as const,
    label: "Статистика",
    shortLabel: "Статистика",
    icon: "stats-chart-outline" as IconName
  },
  {
    id: "logs" as const,
    label: "Логи",
    shortLabel: "Логи",
    icon: "warning-outline" as IconName
  }
];

const dayFilters: { id: NonNullable<DayFilter>; label: string }[] = [
  { id: "1", label: "Пн" },
  { id: "2", label: "Вт" },
  { id: "3", label: "Ср" },
  { id: "4", label: "Чт" },
  { id: "5", label: "Пт" },
  { id: "6", label: "Сб" },
  { id: "7", label: "Вс" }
];

const studyCategories: StudyCategory[] = [
  "all",
  "КАГ",
  "ЦАГ",
  "СТЕНТ КОР",
  "СТЕНТ ВСА",
  "СТЕНТ НОГИ",
  "БАП НОГИ",
  "ЭМА",
  "ДРУГИЕ"
];

const commandLabels: Record<AgentCommand, string> = {
  sync_studies: "Проверить новые протоколы",
  find_study: "Найти протокол",
  import_study: "Загрузить выбранный протокол",
  find_xa: "Найти XA",
  find_ct: "Найти CT",
  get_xa: "Загрузить XA",
  get_ct: "Загрузить CT",
  send_xa_to_pacs: "Отправить XA в удалённый PACS",
  send_ct_to_pacs: "Отправить CT в удалённый PACS",
  xa_polling_on: "Включить XA-мониторинг",
  xa_polling_off: "Выключить XA-мониторинг",
  ct_polling_on: "Включить CT-мониторинг",
  ct_polling_off: "Выключить CT-мониторинг"
};

export const agentCommandOptions: AgentCommand[] = [
  "find_xa",
  "find_ct"
];

const terminalStatuses = new Set(["completed", "error"]);
const AGENT_ONLINE_WINDOW_MS = 150_000;

function parseObject(value: UserRequest["payload"]): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object"
      )
    : [];
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Произошла неизвестная ошибка";
}

function formatDate(value?: string, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function operationPlanWeekStart(offsetWeeks = 0): string {
  const date = new Date();
  const dayFromMonday = (date.getDay() + 6) % 7;
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - dayFromMonday + offsetWeeks * 7);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isInActiveClinicalWindow(value: string): boolean {
  const studyDate = new Date(value);
  if (Number.isNaN(studyDate.getTime())) return false;
  const windowStart = new Date(`${operationPlanWeekStart(0)}T00:00:00`);
  windowStart.setDate(windowStart.getDate() - 2);
  return studyDate >= windowStart;
}

function formatDuration(minutes: number): string {
  if (!minutes) return "не указана";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function relativeTime(date?: Date): string {
  if (!date) return "нет данных";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  return formatDate(date.toISOString(), true);
}

function statusMeta(status: string): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  switch (status) {
    case "completed":
      return { label: "Выполнено", tone: "success" };
    case "in_progress":
      return { label: "В работе", tone: "warning" };
    case "error":
      return { label: "Ошибка", tone: "danger" };
    case "pending":
      return { label: "В очереди", tone: "neutral" };
    default:
      return { label: status || "Неизвестно", tone: "neutral" };
  }
}

function reportData(document: ReportDocument): OperationsReport {
  return document.report && typeof document.report === "object"
    ? (document.report as OperationsReport)
    : {};
}

function normalizeOperationStatistics(value: unknown): OperationStatistics {
	const source = value && typeof value === "object" ? value as Partial<OperationStatistics> : {};
	return {
		operation_types: Array.isArray(source.operation_types) ? source.operation_types : [],
		surgeons: Array.isArray(source.surgeons) ? source.surgeons : [],
		vmp_operation_types: Array.isArray(source.vmp_operation_types) ? source.vmp_operation_types : [],
		vmp_patients: Array.isArray(source.vmp_patients) ? source.vmp_patients : [],
		included_study_ids: Array.isArray(source.included_study_ids) ? source.included_study_ids : [],
		excluded_study_ids: Array.isArray(source.excluded_study_ids) ? source.excluded_study_ids : []
	};
}

function shortPatientName(value: string): string {
	const parts = value.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2) return value.trim();
	return `${parts[0]} ${parts.slice(1, 3).map((part) => `${part[0]?.toLocaleUpperCase("ru") ?? ""}.`).join("")}`;
}

function studyCategory(study: Study): Exclude<StudyCategory, "all"> {
  const source = `${study.study_type} ${study.name_operation}`
    .toLocaleUpperCase("ru")
    .replace(/_/g, " ");
  if (source.includes("КАГ")) return "КАГ";
  if (source.includes("ЦАГ")) return "ЦАГ";
  if (source.includes("ЭМА")) return "ЭМА";
  if (source.includes("СТЕНТ") && /(ВСА|СОНН)/.test(source)) return "СТЕНТ ВСА";
  if (source.includes("СТЕНТ") && /(НОГ|ПЕРИФЕР)/.test(source)) return "СТЕНТ НОГИ";
  if (source.includes("СТЕНТ")) return "СТЕНТ КОР";
  if (source.includes("БАП") && /(НОГ|ПЕРИФЕР)/.test(source)) return "БАП НОГИ";
  return "ДРУГИЕ";
}

function reportShareText(report: ReportDocument): string {
  const data = reportData(report);
  const groups: [string, ReportOperation[]][] = [
    ["Экстренные", data.emergency_operations ?? []],
    ["Плановые", data.planned_operations ?? []],
    ["План сегодня", data.today_planned_operations ?? []]
  ];
  const lines = [
    `Отчёт дежурства · ${data.date ?? formatDate(report.generated_at)}`,
    `${data.period_start ?? "—"} — ${data.period_end ?? "—"}`
  ];
  groups.forEach(([title, operations]) => {
    if (!operations.length) return;
    lines.push("", `${title} (${operations.length})`);
    operations.forEach((operation, index) => {
      lines.push(
        `${index + 1}. ${operation.patient || "ФИО не указано"} — ${
          operation.operation || "Операция не указана"
        }`
      );
    });
  });
  return lines.join("\n");
}

async function shareReport(report: ReportDocument): Promise<void> {
  const message = reportShareText(report);
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    "share" in navigator
  ) {
    try {
      await navigator.share({
        title: `Отчёт ${reportData(report).date ?? ""}`,
        text: message
      });
      return;
    } catch {
      // The user may close the native share sheet; use Telegram only as fallback.
    }
  }
  if (Platform.OS === "web") {
    const url = `https://t.me/share/url?url=&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Share.share({
    title: `Отчёт ${reportData(report).date ?? ""}`,
    message
  });
}

async function shareStudyProtocol(study: Study): Promise<void> {
  const message = [
    `${study.patient}${study.age ? ` ${study.age}` : ""}`,
    cleanClinicalText(study.name_operation, true),
    formatDate(study.time_beginning, true),
    study.surgeon ? `Хирург: ${study.surgeon}` : "",
    "",
    cleanClinicalText(study.descr_operation || "")
  ].filter(Boolean).join("\n");
  const title = `Протокол операции — ${study.patient}`;
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text: message });
        return;
      } catch {
        // Closing the native share dialog falls back to a messenger link.
      }
    }
    window.open(
      `https://t.me/share/url?url=&text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    );
    return;
  }
  await Share.share({ title, message });
}

function confirmDeleteAll(message: string, action: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm(message)) action();
    return;
  }
  Alert.alert("Подтвердите удаление", message, [
    { text: "Отмена", style: "cancel" },
    { text: "Удалить", style: "destructive", onPress: action }
  ]);
}

export default function App() {
  const { width } = useWindowDimensions();
  const compact = width < layout.mobileBreakpoint;
  const [authenticated, setAuthenticated] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [launchDelayElapsed, setLaunchDelayElapsed] = useState(false);
  const [autoDownloadStartAllowed, setAutoDownloadStartAllowed] = useState(false);
  const [enterRequested, setEnterRequested] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("studies");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [studies, setStudies] = useState<Study[]>(loadStudiesCache);
  const [studiesLoading, setStudiesLoading] = useState(() => loadStudiesCache().length === 0);
  const [studiesError, setStudiesError] = useState("");
  const [search, setSearch] = useState("");
  const [studySearchScope, setStudySearchScope] = useState<StudySearchScope>("week");
  const [archiveSuggestions, setArchiveSuggestions] = useState<Study[]>([]);
  const [archiveSearchLoading, setArchiveSearchLoading] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>(null);
  const [category, setCategory] = useState<StudyCategory>("all");
  const [studySort, setStudySort] = useState<StudySort>("time");
  const [surgeonFilter, setSurgeonFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [xaStudies, setXaStudies] = useState<Study[]>(loadXAStudiesCache);
  const [xaLoading, setXaLoading] = useState(false);
  const [xaError, setXaError] = useState("");
  const [requests, setRequests] = useState<UserRequest[]>(loadRequests);
  const [reports, setReports] = useState<ReportDocument[]>(() =>
    loadReportsCache(loadSettings().agentId)
  );
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportGenerating, setReportGenerating] = useState(false);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [agentHealthById, setAgentHealthById] = useState<
    Record<number, AgentHealth>
  >({});
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandModality, setCommandModality] = useState<"find_xa" | "find_ct">("find_xa");
  const [menuOpen, setMenuOpen] = useState(false);
  const [plan, setPlan] = useState<OperationPlan | null>(() =>
    loadOperationPlanCache(operationPlanWeekStart(0))
  );
  const [planWeekOffset, setPlanWeekOffset] = useState<0 | 1>(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [statistics, setStatistics] = useState<OperationStatistics | null>(() => {
    const cached = loadOperationStatisticsCache();
    return cached ? normalizeOperationStatistics(cached) : null;
  });
  const [historicalStatistics, setHistoricalStatistics] = useState<HistoricalStatistics | null>(loadHistoricalStatisticsCache);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsError, setStatisticsError] = useState("");
  const [dutySchedule, setDutySchedule] = useState<DutySchedule | null>(() =>
    loadDutyScheduleCache(new Date().toISOString().slice(0, 7))
  );
  const [dutyScheduleLoading, setDutyScheduleLoading] = useState(false);
  const [dutyScheduleError, setDutyScheduleError] = useState("");
  const [requestedXAStudyUID, setRequestedXAStudyUID] = useState<string | null>(null);
  const processedCompletions = useRef(
    new Set(
      requests
        .filter((request) => terminalStatuses.has(request.status))
        .map((request) => request.id)
    )
  );
  const linkingAngiographies = useRef(new Set<string>());
  const automaticImportSources = useRef(new Set<string>());
  const automaticImportUIDs = useRef(new Set(
    requests
      .filter((request) => ["get_xa", "get_ct"].includes(request.command))
      .map((request) => String(parseObject(request.payload).study_uid ?? ""))
      .filter(Boolean)
  ));
  const preloadStarted = useRef(false);
  const autoDownloadRunning = useRef(false);
  const autoDownloadAllowedRef = useRef(false);
  const autoDownloadRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [autoDownloadAttempt, setAutoDownloadAttempt] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [dicomCache, setDicomCache] = useState<DicomCacheSnapshot>(
    getDicomCacheSnapshot
  );
  const autoDownloadAllowed =
    authenticated && compact && autoDownloadStartAllowed;
  autoDownloadAllowedRef.current = autoDownloadAllowed;

  const loadStudies = useCallback(async () => {
	const cached = loadStudiesCache();
    setStudiesError("");
    setStudiesLoading(cached.length === 0);
    try {
      const response = await getStudies();
      const pinned = loadPinnedProtocols();
      const responseIDs = new Set(response.map((study) => study.id));
      const nextStudies = [...response, ...pinned.filter((study) => !responseIDs.has(study.id))];
      setStudies(nextStudies);
	  saveStudiesCache(nextStudies);
      const protocols = nextStudies.filter((study) => !isPacsImagingStudy(study));
      setSelectedStudy((current) => {
        if (!current) return protocols[0] ?? null;
        return (
          protocols.find((study) => study.id === current.id) ??
          protocols[0] ??
          null
        );
      });
    } catch (error) {
      setStudiesError(errorMessage(error));
    } finally {
      setStudiesLoading(false);
    }
  }, []);

  const loadXAStudies = useCallback(async () => {
    setXaError("");
    setXaLoading(loadXAStudiesCache().length === 0);
    try {
      const [xa, ct] = await Promise.all([
        searchStudies({ studyType: "xa" }),
        searchStudies({ studyType: "ct" })
      ]);
      const next = [...xa, ...ct]
          .filter(isPacsImagingStudy)
          .sort(
            (left, right) =>
              new Date(right.time_beginning).getTime() -
              new Date(left.time_beginning).getTime()
          );
      setXaStudies(next);
      saveXAStudiesCache(next);
    } catch (error) {
      setXaError(errorMessage(error));
    } finally {
      setXaLoading(false);
    }
  }, []);

  const loadRequestHistory = useCallback(async () => {
    try {
      const response = await getUserRequests(settings.userId, settings.agentId);
      response.forEach((request) => {
        if (terminalStatuses.has(request.status)) {
          processedCompletions.current.add(request.id);
        }
      });
      setRequests(response);
      saveRequests(response);
    } catch {
      // Offline/mobile fallback remains the local request cache.
    }
  }, [settings.agentId, settings.userId]);

  const loadReports = useCallback(async () => {
    const cached = loadReportsCache(settings.agentId);
    if (cached.length) setReports(cached);
    setReportsError("");
    setReportsLoading(cached.length === 0);
    try {
      const response = await getReports(settings.agentId);
      setReports(response);
      saveReportsCache(settings.agentId, response);
    } catch (error) {
      if (!cached.length) setReportsError(errorMessage(error));
    } finally {
      setReportsLoading(false);
    }
  }, [settings.agentId]);

  const loadPlan = useCallback(async (weekOffset: 0 | 1) => {
    const weekStart = operationPlanWeekStart(weekOffset);
    const cached = loadOperationPlanCache(weekStart);
    if (cached) setPlan(cached);
    setPlanError("");
    setPlanLoading(!cached);
    try {
      const response = await getOperationPlan(weekStart);
      setPlan(response);
      saveOperationPlanCache(response);
    } catch (error) {
      if (!cached) setPlanError(errorMessage(error));
    } finally {
      setPlanLoading(false);
    }
  }, []);

  const loadStatistics = useCallback(async () => {
    const cachedCurrent = loadOperationStatisticsCache();
    const cachedHistorical = loadHistoricalStatisticsCache();
    if (cachedCurrent) setStatistics(normalizeOperationStatistics(cachedCurrent));
    if (cachedHistorical) setHistoricalStatistics(cachedHistorical);
    setStatisticsError("");
    setStatisticsLoading(!cachedCurrent && !cachedHistorical);
    try {
      const [current, historical] = await Promise.all([
        getOperationStatistics(),
        getHistoricalStatistics()
      ]);
      const normalized = normalizeOperationStatistics(current);
	  setStatistics(normalized);
      setHistoricalStatistics(historical);
      saveOperationStatisticsCache(normalized);
      saveHistoricalStatisticsCache(historical);
    } catch (error) {
      setStatisticsError(errorMessage(error));
    } finally {
      setStatisticsLoading(false);
    }
  }, []);

  const loadDutySchedule = useCallback(async () => {
    const month = new Date().toISOString().slice(0, 7);
    const cached = loadDutyScheduleCache(month);
    if (cached) setDutySchedule(cached);
    setDutyScheduleLoading(!cached);
    setDutyScheduleError("");
    try {
      const response = await getDutySchedule(month);
      setDutySchedule(response);
      saveDutyScheduleCache(response);
    } catch (error) {
      setDutyScheduleError(errorMessage(error));
    } finally {
      setDutyScheduleLoading(false);
    }
  }, []);

  const updateServerHealth = useCallback(async () => {
    try {
      const message = await checkHealth();
      setHealth({ ok: true, checkedAt: new Date(), message });
    } catch (error) {
      setHealth({
        ok: false,
        checkedAt: new Date(),
        message: errorMessage(error)
      });
    }
  }, []);

  const updateAgentHealth = useCallback(async () => {
    const entries = await Promise.all(
      settings.selectedAgentIds.map(async (agentId) => {
        try {
          const [wellTimes, errorTimes] = await Promise.all([
            getAgentHeartbeatTimes(agentId, "well"),
            getAgentHeartbeatTimes(agentId, "with_errors")
          ]);
          const latestWell = wellTimes[0] ? new Date(wellTimes[0]) : undefined;
          const latestError = errorTimes[0] ? new Date(errorTimes[0]) : undefined;
          const candidates = [latestWell, latestError].filter(
            (value): value is Date =>
              Boolean(value) && !Number.isNaN(value?.getTime())
          );
          const lastSeen = candidates.sort(
            (left, right) => right.getTime() - left.getTime()
          )[0];
          const ageMs = lastSeen ? Date.now() - lastSeen.getTime() : undefined;
          const online = ageMs !== undefined && ageMs <= AGENT_ONLINE_WINDOW_MS;
          const status: AgentHealth["status"] =
            !online
              ? "offline"
              : latestError &&
                  (!latestWell || latestError.getTime() > latestWell.getTime())
                ? "with_errors"
                : "well";
          return [agentId, { online, status, lastSeen, ageMs }] as const;
        } catch {
          return [
            agentId,
            { online: false, status: "unknown" } satisfies AgentHealth
          ] as const;
        }
      })
    );
    setAgentHealthById(Object.fromEntries(entries));
  }, [settings.selectedAgentIds]);

  const refreshConnectivity = useCallback(() => {
    void updateServerHealth();
    void updateAgentHealth();
  }, [updateAgentHealth, updateServerHealth]);

  useEffect(() => {
    if (authenticated && compact) void pruneExpiredDicomFrames();
  }, [authenticated, compact]);

  useEffect(() => {
    if (!authenticated || !compact || !studies.length) return;
    const protocols = studies.filter((study) => !isPacsImagingStudy(study));
    const activeXA = xaStudies
      .filter(
        (angiography) =>
          angiography.study_type.toLowerCase() === "xa" &&
          (isInActiveClinicalWindow(angiography.time_beginning) ||
            protocols.some(
              (protocol) => findProtocolAngiography(protocol, xaStudies)?.id === angiography.id
            ))
      )
      .map((angiography) => angiography.study_id);
    void pruneDicomCache(activeXA);
  }, [authenticated, compact, studies, xaStudies]);

  useEffect(() => {
    if (!authenticated || !xaStudies.length) return;
    studies
      .filter((study) => !isPacsImagingStudy(study) && !study.dicom_link.trim())
      .forEach((protocol) => {
        const angiography = findProtocolAngiography(protocol, xaStudies);
        if (!angiography || linkingAngiographies.current.has(protocol.id)) return;
        linkingAngiographies.current.add(protocol.id);
        void linkStudyAngiography(protocol.id, angiography.study_id)
          .then((updated) => {
            setStudies((current) => {
              const next = current.map((item) =>
                item.id === updated.id ? updated : item
              );
              saveStudiesCache(next);
              return next;
            });
          })
          .finally(() => linkingAngiographies.current.delete(protocol.id));
      });
  }, [authenticated, studies, xaStudies]);

  useEffect(() => {
    const timer = setTimeout(() => setLaunchDelayElapsed(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (preloadStarted.current) return;
    preloadStarted.current = true;
    const readyTimer = setTimeout(() => setAppReady(true), 250);
    void Promise.allSettled([
      loadStudies(),
      updateServerHealth(),
      updateAgentHealth(),
      loadPlan(0),
      loadReports(),
      loadStatistics(),
      loadDutySchedule()
    ]);
    return () => clearTimeout(readyTimer);
  }, [
    loadStudies,
    loadPlan,
    loadReports,
    loadStatistics,
    loadDutySchedule,
    updateAgentHealth,
    updateServerHealth
  ]);

  useEffect(() => {
    if (appReady && enterRequested) setAuthenticated(true);
  }, [appReady, enterRequested]);

  useEffect(() => {
    void getAgents()
      .then((ids) => {
        if (!ids.length) return;
        setSettings((current) => {
          const agentIds = [...new Set([...current.agentIds, ...ids])].sort(
            (left, right) => left - right
          );
          if (agentIds.length === current.agentIds.length) return current;
          const next = { ...current, agentIds };
          saveSettings(next);
          return next;
        });
      })
      .catch(() => {
        // Older backend deployments do not expose the agent directory yet.
      });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!compact) {
      setAutoDownloadStartAllowed(false);
    }
    const canStartFromCache = compact && loadXAStudiesCache().length > 0;
    if (canStartFromCache) {
      timer = setTimeout(() => setAutoDownloadStartAllowed(true), 100);
    }
    void loadXAStudies().finally(() => {
      if (cancelled || !compact || canStartFromCache) return;
      timer = setTimeout(() => setAutoDownloadStartAllowed(true), 100);
    });
    void Promise.allSettled([
      loadRequestHistory(),
      loadReports(),
      loadPlan(0)
    ]);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    authenticated,
    compact,
    loadPlan,
    loadReports,
    loadRequestHistory,
    loadXAStudies
  ]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = setInterval(refreshConnectivity, 30_000);
    return () => clearInterval(timer);
  }, [authenticated, refreshConnectivity]);

  useEffect(() => {
    if (!authenticated) return;
    if (activeTab === "reports") {
      void loadReports();
    }
    if (activeTab === "angiography") {
      void loadXAStudies();
    }
    if (activeTab === "plan") {
      void loadPlan(planWeekOffset);
    }
    if (activeTab === "statistics") {
      void loadStatistics();
    }
    if (activeTab === "schedule") {
      void loadDutySchedule();
    }
  }, [
    activeTab,
    authenticated,
    loadPlan,
    loadReports,
    loadStatistics,
    loadDutySchedule,
    loadXAStudies,
    planWeekOffset,
    compact
  ]);

  useEffect(() => {
    if (!authenticated || activeTab !== "reports") return;
    const timer = setInterval(() => void loadReports(), 30_000);
    return () => clearInterval(timer);
  }, [activeTab, authenticated, loadReports]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const viewport = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]'
    );
    if (viewport) {
      viewport.content =
        "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    }
    const root = document.getElementById("root");
    Object.assign(document.documentElement.style, {
      width: "100%",
      height: "100%",
      overflow: "hidden",
      overscrollBehavior: "none"
    });
    Object.assign(document.body.style, {
      width: "100%",
      height: "100%",
      margin: "0",
      overflow: "hidden",
      position: "fixed",
      inset: "0",
      overscrollBehavior: "none",
      touchAction: "pan-y",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    });
    if (root) {
      root.style.width = "100%";
      root.style.height = "100%";
      root.style.overflow = "hidden";
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      const background =
        !authenticated || activeTab === "angiography"
          ? darkColors.canvas
          : colors.canvas;
      document.documentElement.style.backgroundColor = background;
      document.body.style.backgroundColor = background;
      const theme = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
      );
      if (theme) theme.content = background;
      return;
    }
  }, [activeTab, authenticated]);

  useEffect(() => {
    if (!launchDelayElapsed) return;
    if (Platform.OS === "web") {
      const preboot = document.getElementById("viewer-preboot");
      if (preboot) {
        preboot.style.transition = "opacity 240ms ease";
        preboot.style.opacity = "0";
        window.setTimeout(() => preboot.remove(), 260);
      }
      return;
    }
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [launchDelayElapsed]);

  useEffect(() => {
    if (!authenticated) return;
    const pending = requests.filter(
      (request) => !terminalStatuses.has(request.status)
    );
    if (!pending.length) return;
    const poll = async () => {
      const refreshed = await Promise.all(
        pending.map(async (item) => {
          try {
            return await getUserRequest(item.id);
          } catch {
            return item;
          }
        })
      );
      setRequests((current) => {
        const byId = new Map(refreshed.map((item) => [item.id, item]));
        const next = current.map((item) => byId.get(item.id) ?? item);
        saveRequests(next);
        return next;
      });
    };
    const timer = setInterval(() => void poll(), 4_000);
    return () => clearInterval(timer);
  }, [authenticated, requests]);

  useEffect(() => {
    if (!authenticated) return;
    const newlyCompleted = requests.filter(
      (request) =>
        request.status === "completed" &&
        !processedCompletions.current.has(request.id)
    );
    newlyCompleted.forEach((request) => processedCompletions.current.add(request.id));
    if (newlyCompleted.some((request) =>
      ["sync_studies", "import_study", "get_xa", "get_ct", "send_xa_to_pacs", "send_ct_to_pacs"]
        .includes(request.command)
    )) {
      void loadStudies();
      void loadXAStudies();
    }
  }, [authenticated, loadStudies, loadXAStudies, requests]);

  useEffect(
    () =>
      subscribeDicomCache(() => {
        setDicomCache(getDicomCacheSnapshot());
      }),
    []
  );

  useEffect(() => {
    if (!autoDownloadAllowed) {
      cancelDicomDownloads();
      if (autoDownloadRetryTimer.current) {
        clearTimeout(autoDownloadRetryTimer.current);
        autoDownloadRetryTimer.current = null;
      }
    }
  }, [autoDownloadAllowed]);

  useEffect(
    () => () => {
      if (autoDownloadRetryTimer.current) {
        clearTimeout(autoDownloadRetryTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    if (
      !autoDownloadAllowed ||
      autoDownloadRunning.current
    ) {
      return;
    }
    const cachedStudies = getDicomCacheSnapshot().studies;
    const studiesToDownload = xaStudies.filter(
      (study) =>
        study.study_type.toLocaleLowerCase() === "xa" &&
        isInActiveClinicalWindow(study.time_beginning) &&
        (!cachedStudies[study.study_id]?.complete ||
          !getCachedPreparedXAManifest(study.study_id))
    );
    if (!studiesToDownload.length) return;
    autoDownloadRunning.current = true;
    void (async () => {
      let retryNeeded = false;
      try {
        for (const study of studiesToDownload) {
          if (!autoDownloadAllowedRef.current) break;
          const firstSeriesReady = await downloadStudyFirstSeriesForOffline(
            study.study_id
          );
          retryNeeded ||= !firstSeriesReady;
        }
        for (const study of studiesToDownload) {
          if (!autoDownloadAllowedRef.current) break;
          const complete = await downloadStudyForOffline(study.study_id);
          retryNeeded ||= !complete;
        }
      } finally {
        autoDownloadRunning.current = false;
        if (retryNeeded && autoDownloadAllowedRef.current) {
          autoDownloadRetryTimer.current = setTimeout(() => {
            autoDownloadRetryTimer.current = null;
            setAutoDownloadAttempt((attempt) => attempt + 1);
          }, 15_000);
        }
      }
    })();
  }, [
    autoDownloadAllowed,
    autoDownloadAttempt,
    xaStudies
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const protocolStudies = useMemo(
    () => studies.filter((study) => !isPacsImagingStudy(study)),
    [studies]
  );

  const studySurgeons = useMemo(
    () =>
      [...new Set(
        protocolStudies
          .map((study) => study.surgeon.trim().toLocaleLowerCase("ru"))
          .filter((surgeon) => surgeon && surgeon !== "не указано")
      )].sort((left, right) => left.localeCompare(right, "ru")),
    [protocolStudies]
  );

  const filteredStudies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    return protocolStudies.filter((study) => {
      const date = new Date(study.time_beginning);
      const weekday = Number.isNaN(date.getTime()) ? 0 : date.getDay();
      const isoWeekday = weekday === 0 ? 7 : weekday;
      if (dayFilter && isoWeekday !== Number(dayFilter)) return false;
      if (category !== "all" && studyCategory(study) !== category) return false;
      if (
        surgeonFilter &&
        study.surgeon.trim().toLocaleLowerCase("ru") !== surgeonFilter
      ) return false;
      if (!query) return true;
      return [
        study.patient,
        study.name_operation,
        study.surgeon,
        study.department,
        study.study_id
      ].some((value) => value.toLocaleLowerCase("ru").includes(query));
    }).sort((left, right) => {
      const time =
        new Date(right.time_beginning).getTime() -
        new Date(left.time_beginning).getTime();
      if (studySort === "time") return time;
      const operation = shortOperationName(left.name_operation).localeCompare(
        shortOperationName(right.name_operation),
        "ru"
      );
      return operation || time;
    });
  }, [category, dayFilter, protocolStudies, search, studySort, surgeonFilter]);

  useEffect(() => {
    const query = search.trim();
    if (studySearchScope !== "year" || query.length < 2) {
      setArchiveSuggestions([]);
      setArchiveSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setArchiveSearchLoading(true);
      void suggestProtocolStudies(query)
        .then((items) => {
          if (!cancelled) {
            setArchiveSuggestions(items);
          }
        })
        .catch(() => {
          if (!cancelled) setArchiveSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setArchiveSearchLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, studySearchScope]);

  const recordRequest = useCallback((request: UserRequest) => {
    setRequests((current) => {
      const next = [request, ...current.filter((item) => item.id !== request.id)];
      saveRequests(next);
      return next;
    });
  }, []);

  const submitCommand = useCallback(
    async (command: AgentCommand, payload: Record<string, unknown>) => {
      try {
        const created = await createUserRequest({
          userId: settings.userId,
          agentId: settings.agentId,
          command,
          payload
        });
        recordRequest(created);
        setToast({
          message: "Запрос отправлен",
          tone: "success"
        });
        return true;
      } catch {
        setToast({ message: "Запрос не отправлен", tone: "danger" });
        return false;
      }
    },
    [recordRequest, settings]
  );

  useEffect(() => {
    const completedSearches = requests.filter(
      (request) =>
        request.status === "completed" &&
        ["find_xa", "find_ct"].includes(request.command) &&
        !automaticImportSources.current.has(request.id)
    );
    completedSearches.forEach((request) => {
      const pacsStudies = objectArray(parseObject(request.result).studies);
      if (pacsStudies.length !== 1) return;
      automaticImportSources.current.add(request.id);
      const onlyStudy = pacsStudies[0]!;
      const uid = String(
        onlyStudy.uid ?? onlyStudy.study_uid ?? onlyStudy.StudyInstanceUID ?? ""
      );
      if (
        !uid ||
        automaticImportUIDs.current.has(uid) ||
        studies.some((study) => study.study_id === uid)
      ) return;
      automaticImportUIDs.current.add(uid);
      void submitCommand(request.command === "find_ct" ? "get_ct" : "get_xa", {
        study_uid: uid
      });
    });
  }, [requests, studies, submitCommand]);

  const saveAppSettings = useCallback(
    (next: AppSettings) => {
      const agentIds = [...new Set(next.agentIds)]
        .filter((value) => Number.isInteger(value) && value > 0);
      const selectedAgentIds = [...new Set(next.selectedAgentIds)]
        .filter((value) => agentIds.includes(value))
        .slice(0, 2);
      const fallbackAgent = agentIds[0] ?? defaultSettings.agentId;
      const normalized = {
        agentId: selectedAgentIds[0] ?? fallbackAgent,
        agentIds: agentIds.length ? agentIds : [fallbackAgent],
        selectedAgentIds: selectedAgentIds.length
          ? selectedAgentIds
          : [fallbackAgent],
        userId: next.userId.trim() || defaultSettings.userId,
        autoDownloadAngiography: true
      };
      setSettings(normalized);
      saveSettings(normalized);
      setToast({
        message: "Настройки сохранены на этом устройстве",
        tone: "success"
      });
    },
    []
  );

  const removeLocalAngiography = useCallback(async (study: Study) => {
    try {
      await deleteStudyFromDevice(study.study_id);
      setDicomCache(getDicomCacheSnapshot());
      setToast({ message: "XA удалена с устройства", tone: "success" });
    } catch (error) {
      setToast({ message: errorMessage(error), tone: "danger" });
    }
  }, []);

  const removeRequest = useCallback(async (request: UserRequest) => {
    try {
      await deleteUserRequest(request.id, settings.userId);
      setRequests((current) => {
        const next = current.filter((item) => item.id !== request.id);
        saveRequests(next);
        return next;
      });
    } catch (error) {
      setToast({ message: errorMessage(error), tone: "danger" });
    }
  }, [settings.userId]);

  const removeReport = useCallback(async (report: ReportDocument) => {
    if (!report.filename) {
      setToast({ message: "У отчёта отсутствует имя файла", tone: "danger" });
      return;
    }
    try {
      await deleteReport(report.filename);
      setReports((current) =>
        current.filter((item) => item.filename !== report.filename)
      );
      setToast({ message: "Отчёт удалён", tone: "success" });
    } catch (error) {
      setToast({ message: errorMessage(error), tone: "danger" });
    }
  }, []);

  const openStudyAngiography = useCallback((protocol: Study) => {
    const angiography = findProtocolAngiography(protocol, xaStudies);
    if (!angiography) return;
    setRequestedXAStudyUID(angiography.study_id);
    setActiveTab("angiography");
  }, [xaStudies]);

  const createReport = useCallback(async (period: {
    days?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<boolean> => {
    setReportGenerating(true);
    try {
      await generateReport({ agentId: settings.agentId, ...period });
      await loadReports();
      setToast({ message: "Отчёт сформирован", tone: "success" });
      return true;
    } catch (error) {
      setToast({ message: errorMessage(error), tone: "danger" });
      return false;
    } finally {
      setReportGenerating(false);
    }
  }, [loadReports, settings.agentId]);

  const primaryAgentHealth =
    agentHealthById[settings.agentId] ??
    ({ online: false, status: "unknown" } satisfies AgentHealth);
  const isAngiography = activeTab === "angiography";

  if (!authenticated) {
    return (
      <SafeAreaProvider>
        <LoginScreen
          compact={compact}
          ready={appReady}
          entering={enterRequested && !appReady}
          revealForm={launchDelayElapsed}
          onEnter={() => {
            if (appReady) setAuthenticated(true);
            else setEnterRequested(true);
          }}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.safeArea, isAngiography && styles.safeAreaDark]}
        edges={compact ? ["top"] : []}
      >
        <StatusBar
          style={isAngiography ? "light" : "dark"}
          backgroundColor={
            isAngiography ? darkColors.canvas : colors.canvas
          }
        />
        <View style={[styles.app, isAngiography && styles.appDark]}>
          <View style={[styles.main, isAngiography && styles.mainDark]}>
            <TopBar
              compact={compact}
              activeTab={activeTab}
              health={health}
              selectedAgentIds={settings.selectedAgentIds}
              agentHealthById={agentHealthById}
              onMenu={() => setMenuOpen(true)}
              onTabChange={setActiveTab}
            />

            <View
              style={[
                styles.content,
                compact && styles.contentCompact,
                isAngiography && styles.contentDark
              ]}
            >
              {activeTab === "studies" ? (
                <StudiesScreen
                  compact={compact}
                  inlineDetail={!compact && width >= layout.tabletBreakpoint}
                  studies={filteredStudies}
                  total={protocolStudies.length}
                  loading={studiesLoading}
                  error={studiesError}
                  search={search}
                  searchScope={studySearchScope}
                  archiveSuggestions={archiveSuggestions}
                  archiveSearchLoading={archiveSearchLoading}
                  dayFilter={dayFilter}
                  category={category}
                  sort={studySort}
                  surgeonFilter={surgeonFilter}
                  selected={selectedStudy}
                  onSearch={setSearch}
                  onSearchScope={(scope) => {
                    setStudySearchScope(scope);
                    setArchiveSuggestions([]);
                  }}
                  onDayFilter={(value) =>
                    setDayFilter((current) => current === value ? null : value)
                  }
                  onFilter={() => setFilterOpen(true)}
                  onSelect={(study) => {
                    setSelectedStudy(study);
                    if (study && !studies.some((item) => item.id === study.id)) {
                      pinProtocol(study);
                      setStudies((current) => {
                        const next = [study, ...current];
                        saveStudiesCache(next);
                        return next;
                      });
                    }
                  }}
                  onRetry={() => void loadStudies()}
                  onRefresh={() => void loadStudies()}
                  angiographies={xaStudies}
                  dicomCache={dicomCache}
                  onOpenXA={openStudyAngiography}
                />
              ) : null}
              {activeTab === "angiography" ? (
                <AngiographyScreen
                  compact={compact}
                  studies={xaStudies}
                  loading={xaLoading}
                  error={xaError}
                  persistentCacheEnabled
                  dicomCache={dicomCache}
                  onRetry={() => void loadXAStudies()}
                  onDeleteLocal={removeLocalAngiography}
                  initialStudyUID={requestedXAStudyUID}
                  onInitialStudyHandled={() => setRequestedXAStudyUID(null)}
                  onSearch={(modality) => {
                    setCommandModality(modality === "ct" ? "find_ct" : "find_xa");
                    setCommandOpen(true);
                  }}
                />
              ) : null}
              {activeTab === "reports" ? (
                <ReportsScreen
                  compact={compact}
                  reports={reports}
                  loading={reportsLoading}
                  error={reportsError}
                  onRetry={() => void loadReports()}
                  onRefresh={() => void loadReports()}
                  onGenerate={createReport}
                  generating={reportGenerating}
                  onDelete={(report) => void removeReport(report)}
                  onForward={(report) => void shareReport(report)}
                />
              ) : null}
              {activeTab === "logs" && !compact ? (
                <LogsScreen
                  requests={requests.filter(
                    (request) =>
                      request.status === "error" || Boolean(request.errors)
                  )}
                  onDelete={(request) => void removeRequest(request)}
                />
              ) : null}
              {activeTab === "statistics" ? (
                <StatisticsScreen
				  compact={compact}
                  statistics={statistics}
                  historicalStatistics={historicalStatistics}
                  loading={statisticsLoading}
                  error={statisticsError}
                  onRetry={() => void loadStatistics()}
                />
              ) : null}
              {activeTab === "schedule" ? (
                <DutyScheduleScreen
                  compact={compact}
                  schedule={dutySchedule}
                  loading={dutyScheduleLoading}
                  error={dutyScheduleError}
                  onRetry={loadDutySchedule}
                  onSave={async (next) => {
                    const saved = await saveDutySchedule(next.month, next);
                    setDutySchedule(saved);
                    saveDutyScheduleCache(saved);
                  }}
                />
              ) : null}
              {activeTab === "settings" ? (
                <SettingsScreen
                  compact={compact}
                  settings={settings}
                  health={health}
                  agentHealthById={agentHealthById}
                  dicomCache={dicomCache}
                  onSave={saveAppSettings}
                  onCheck={refreshConnectivity}
                  onClearCache={() => {
                    void clearDicomCache().then(() =>
                      setToast({
                        message: "Сохранённые XA-кадры удалены с устройства",
                        tone: "success"
                      })
                    );
                  }}
                />
              ) : null}
              {activeTab === "plan" ? (
                <PlanScreen
                  compact={compact}
                  plan={plan}
                  loading={planLoading}
                  error={planError}
                  weekOffset={planWeekOffset}
                  onWeekChange={(weekOffset) => {
                    setPlan(null);
                    setPlanWeekOffset(weekOffset);
                  }}
                  onRetry={() => void loadPlan(planWeekOffset)}
                  onSave={async (date, entries) => {
                    await saveOperationPlanDay(date, entries);
                    await loadPlan(planWeekOffset);
                  }}
                />
              ) : null}
            </View>

            {compact ? (
              <MobileNavigation
                activeTab={activeTab}
                onTabChange={setActiveTab}
                dark={isAngiography}
              />
            ) : null}
          </View>
        </View>

        <CommandSheet
          visible={commandOpen}
          settings={settings}
          initialCommand={commandModality}
          requests={requests}
          studies={studies}
          onClose={() => setCommandOpen(false)}
          onSubmit={submitCommand}
        />
        <MobileMenu
          visible={menuOpen}
          settings={settings}
          health={health}
          agentHealth={primaryAgentHealth}
          onClose={() => setMenuOpen(false)}
          onSettings={() => {
            setMenuOpen(false);
            setActiveTab("settings");
          }}
		  onStatistics={() => {
			setMenuOpen(false);
			setActiveTab("statistics");
		  }}
        />
        <StudyFilterSheet
          visible={filterOpen}
          selected={category}
          sort={studySort}
          surgeon={surgeonFilter}
          surgeons={studySurgeons}
          onClose={() => setFilterOpen(false)}
          onSelect={setCategory}
          onSort={setStudySort}
          onSurgeon={setSurgeonFilter}
        />
        {toast ? (
          <Toast
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => setToast(null)}
          />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function LoginScreen({
  compact,
  ready,
  entering,
  revealForm,
  onEnter
}: {
  compact: boolean;
  ready: boolean;
  entering: boolean;
  revealForm: boolean;
  onEnter: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [backgroundReady, setBackgroundReady] = useState(false);
  const panelOpacity = useRef(new Animated.Value(0)).current;
  const panelOffset = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    if (!revealForm || !backgroundReady) return;
    Animated.parallel([
      Animated.timing(panelOpacity, {
        toValue: 1,
        duration: 420,
        useNativeDriver: Platform.OS !== "web"
      }),
      Animated.timing(panelOffset, {
        toValue: 0,
        duration: 420,
        useNativeDriver: Platform.OS !== "web"
      })
    ]).start();
  }, [backgroundReady, panelOffset, panelOpacity, revealForm]);

  return (
    <View style={styles.loginSafe}>
      <StatusBar style="light" backgroundColor="#050C15" />
      <View style={[styles.loginLayout, compact && styles.loginLayoutCompact]}>
        <Image
          source={
            Platform.OS === "web"
              ? { uri: "/angiography-splash.webp" }
              : require("./assets/angiography-splash.png")
          }
          resizeMode="cover"
          onLoadEnd={() => setBackgroundReady(true)}
          style={[
            styles.loginBackgroundImage,
            compact && styles.loginBackgroundImageCompact
          ]}
        />
        <View style={styles.loginBackgroundShade} />
        {!backgroundReady ? (
          <View style={styles.loginLaunchLoader}>
            <ActivityIndicator size="small" color={darkColors.primary} />
          </View>
        ) : null}
        <Animated.View
          pointerEvents={revealForm && backgroundReady ? "auto" : "none"}
          style={[
            styles.loginPanel,
            compact && styles.loginPanelCompact,
            compact && {
              paddingTop: Math.max(18, insets.top + 10),
              paddingBottom: Math.max(18, insets.bottom + 10)
            },
            {
              opacity: panelOpacity,
              transform: [{ translateY: panelOffset }]
            }
          ]}
        >
          <View style={styles.loginBrand}>
            <View style={styles.loginBrandIcon}>
              <Icon name="scan" size={21} color={darkColors.primary} />
            </View>
            <View>
              <Text style={styles.loginBrandName}>VIEWER</Text>
              <Text style={styles.loginBrandCaption}>CLINICAL WORKSPACE</Text>
            </View>
          </View>
          <View style={styles.loginForm}>
            <View style={styles.loginHeadingRow}>
              <Text style={styles.loginTitle}>Вход</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Регистрация пока недоступна"
                accessibilityState={{ disabled: true }}
                disabled
                style={styles.loginRegistration}
              >
                <Text style={styles.loginRegistrationText}>Регистрация</Text>
              </Pressable>
            </View>
            <View style={styles.loginFields}>
              <View style={styles.loginField}>
                <Icon name="person-outline" size={18} color={darkColors.textDim} />
                <TextInput
                  value={login}
                  onChangeText={setLogin}
                  placeholder="Логин"
                  placeholderTextColor={darkColors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.loginInput}
                />
              </View>
              <View style={styles.loginField}>
                <Icon name="lock-closed-outline" size={18} color={darkColors.textDim} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Пароль"
                  placeholderTextColor={darkColors.textDim}
                  secureTextEntry
                  returnKeyType="go"
                  blurOnSubmit
                  onSubmitEditing={() => {
                    Keyboard.dismiss();
                    onEnter();
                  }}
                  style={styles.loginInput}
                />
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Войти"
              onPress={() => {
                Keyboard.dismiss();
                onEnter();
              }}
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.loginButtonPressed
              ]}
            >
              {entering ? (
                <ActivityIndicator size="small" color="#04111A" />
              ) : (
                <>
                  <Text style={styles.loginButtonText}>Войти</Text>
                  <Icon name="arrow-forward" size={19} color="#04111A" />
                </>
              )}
            </Pressable>
            {!ready ? (
              <View style={styles.loginPreparing}>
                <View style={styles.loginPreparingDot} />
                <Text style={styles.loginPreparingText}>
                  Подготавливаем рабочее пространство
                </Text>
              </View>
            ) : null}
            <Text style={styles.loginTemporary}>
              Авторизация будет подключена позднее. Сейчас вход выполняется без
              проверки данных.
            </Text>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function StatusLine({
  icon,
  label,
  meta,
  online,
  warning = false,
  dark = false
}: {
  icon: IconName;
  label: string;
  meta: string;
  online: boolean;
  warning?: boolean;
  dark?: boolean;
}) {
  const color = online
    ? colors.success
    : warning
      ? colors.warning
      : colors.danger;
  return (
    <View style={[styles.statusLine, dark && styles.statusLineDark]}>
      <Icon
        name={icon}
        size={17}
        color={dark ? darkColors.textMuted : colors.textMuted}
      />
      <View style={styles.statusLineCopy}>
        <Text
          style={[
            styles.statusLineTitle,
            dark && styles.statusLineTitleDark
          ]}
        >
          {label}
        </Text>
        <Text
          style={[styles.statusLineMeta, dark && styles.statusLineMetaDark]}
        >
          {meta}
        </Text>
      </View>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
    </View>
  );
}

function TopBar({
  compact,
  activeTab,
  health,
  selectedAgentIds,
  agentHealthById,
  onMenu,
  onTabChange
}: {
  compact: boolean;
  activeTab: Tab;
  health: ApiHealth | null;
  selectedAgentIds: number[];
  agentHealthById: Record<number, AgentHealth>;
  onMenu: () => void;
  onTabChange: (tab: Tab) => void;
}) {
  const active = desktopTabs.find((item) => item.id === activeTab) ?? tabs[0]!;
  const dark = activeTab === "angiography";
  const statusColor = (agentId: number) => {
    const agent = agentHealthById[agentId];
    if (agent?.online && agent.status === "well") return colors.success;
    if (agent?.status === "with_errors") return colors.warning;
    return colors.danger;
  };
  if (compact) {
    return (
      <View style={[styles.mobileHeaderFloat, dark && styles.topBarDark]}>
        <View style={styles.mobileHeaderEdge}>
          <IconButton
            icon="menu"
            label="Меню"
            onPress={onMenu}
            dark={dark}
          />
        </View>
        <View
          style={[
            styles.mobileTitlePill,
            dark && styles.mobileTitlePillDark
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.mobileTopTitle, dark && styles.textDark]}
          >
            {active.label}
          </Text>
        </View>
        <View style={styles.mobileStatusPair}>
          <View
            accessibilityLabel={health?.ok ? "Сервер доступен" : "Сервер недоступен"}
            style={[styles.mobileStatusIcon, dark && styles.healthPillDark]}
          >
            <Icon name="server-outline" size={16}
              color={health?.ok ? colors.success : colors.danger} />
          </View>
          {selectedAgentIds.map((agentId) => (
            <View
              key={agentId}
              accessibilityLabel={`Агент ${agentId}`}
              style={[styles.mobileStatusIcon, dark && styles.healthPillDark]}
            >
              <Icon
                name="hardware-chip-outline"
                size={15}
                color={statusColor(agentId)}
              />
              <Text style={[styles.agentStatusNumber, dark && styles.textDark]}>
                {agentId}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.desktopHeaderFloat, dark && styles.topBarDark]}>
      <View style={styles.headerBrandGroup}>
        <IconButton
          icon="menu"
          label="Меню"
          onPress={onMenu}
          dark={dark}
        />
        <View style={styles.headerBrandMark}>
          <Icon name="scan" size={18} color={darkColors.primary} />
        </View>
        <Text style={[styles.headerBrandText, dark && styles.textDark]}>
          VIEWER
        </Text>
      </View>
      <View style={styles.desktopTabBar}>
        {desktopTabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onTabChange(tab.id)}
              style={[
                styles.desktopTabButton,
                dark && styles.desktopTabButtonDark,
                selected && styles.desktopTabButtonActive,
                selected && dark && styles.desktopTabButtonActiveDark
              ]}
            >
              <Icon
                name={
                  selected
                    ? (tab.icon.replace("-outline", "") as IconName)
                    : tab.icon
                }
                size={17}
                color={
                  selected
                    ? dark
                      ? darkColors.primary
                      : colors.primary
                    : dark
                      ? darkColors.textMuted
                      : colors.textMuted
                }
              />
              <Text
                style={[
                  styles.desktopTabText,
                  dark && styles.textMutedDark,
                  selected && styles.desktopTabTextActive,
                  selected && dark && styles.desktopTabTextActiveDark
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.topActions}>
        <View style={[styles.healthPill, dark && styles.healthPillDark]}>
          <View
            style={[
              styles.healthDot,
              { backgroundColor: health?.ok ? colors.success : colors.danger }
            ]}
          />
          <Text style={[styles.healthText, dark && styles.textMutedDark]}>
            Сервер
          </Text>
        </View>
        {selectedAgentIds.map((agentId) => (
          <View
            key={agentId}
            style={[styles.healthPill, dark && styles.healthPillDark]}
          >
            <View
              style={[
                styles.healthDot,
                { backgroundColor: statusColor(agentId) }
              ]}
            />
            <Text style={[styles.healthText, dark && styles.textMutedDark]}>
              Агент {agentId}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MobileNavigation({
  activeTab,
  onTabChange,
  dark = false
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  dark?: boolean;
}) {
  return (
    <View
      nativeID="mobile-navigation"
      style={[
        styles.mobileNavSafe,
        dark && styles.mobileNavSafeDark
      ]}
    >
      <View style={[styles.mobileNav, dark && styles.mobileNavDark]}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onTabChange(tab.id)}
              hitSlop={3}
              style={({ pressed }) => [
                styles.mobileNavItem,
                dark && styles.mobileNavItemDark,
                active && styles.mobileNavItemActive,
                active && dark && styles.mobileNavItemActiveDark,
                pressed && styles.mobileNavItemPressed
              ]}
            >
              <Icon
                name={
                  active
                    ? (tab.icon.replace("-outline", "") as IconName)
                    : tab.icon
                }
                size={19}
                color={
                  active
                    ? darkColors.primary
                    : dark
                      ? darkColors.textDim
                      : colors.textDim
                }
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.mobileNavText,
                  dark && styles.mobileNavTextDark,
                  active && styles.mobileNavTextActive
                ]}
              >
                {tab.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StudiesScreen({
  compact,
  inlineDetail,
  studies,
  total,
  loading,
  error,
  search,
  searchScope,
  archiveSuggestions,
  archiveSearchLoading,
  dayFilter,
  category,
  sort,
  surgeonFilter,
  selected,
  onSearch,
  onSearchScope,
  onDayFilter,
  onFilter,
  onSelect,
  onRetry,
  onRefresh,
  angiographies,
  dicomCache,
  onOpenXA
}: {
  compact: boolean;
  inlineDetail: boolean;
  studies: Study[];
  total: number;
  loading: boolean;
  error: string;
  search: string;
  searchScope: StudySearchScope;
  archiveSuggestions: Study[];
  archiveSearchLoading: boolean;
  dayFilter: DayFilter;
  category: StudyCategory;
  sort: StudySort;
  surgeonFilter: string | null;
  selected: Study | null;
  onSearch: (value: string) => void;
  onSearchScope: (value: StudySearchScope) => void;
  onDayFilter: (value: NonNullable<DayFilter>) => void;
  onFilter: () => void;
  onSelect: (study: Study | null) => void;
  onRetry: () => void;
  onRefresh: () => void;
  angiographies: Study[];
  dicomCache: DicomCacheSnapshot;
  onOpenXA: (study: Study) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [databaseSelected, setDatabaseSelected] = useState<Study | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patientXA = (study: Study) => findProtocolAngiography(study, angiographies);
  const hasAvailableXA = (study: Study) => {
    const angiography = patientXA(study);
	return Boolean(angiography);
  };
  const xaIsCached = (study: Study) => {
    const angiography = patientXA(study);
    return Boolean(angiography && dicomCache.studies[angiography.study_id]?.complete);
  };
  const choose = (study: Study) => {
    onSelect(study);
    if (!inlineDetail) setDetailOpen(true);
  };
  const chooseDatabaseStudy = (study: Study) => {
    setDatabaseSelected(study);
    onSelect(study);
    if (!inlineDetail) setDetailOpen(true);
  };

  useEffect(() => {
    if (searchScope === "week") setDatabaseSelected(null);
  }, [searchScope]);

  useEffect(() => () => {
    if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
  }, []);

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View style={[styles.studyToolbar, compact && styles.studyToolbarCompact]}>
        <SearchField
          value={search}
          onChangeText={onSearch}
          placeholder={compact ? "Поиск пациента" : "Пациент, хирург, операция или ID"}
          filterActive={category !== "all" || sort !== "time" || Boolean(surgeonFilter)}
          onFilter={onFilter}
          onFocus={() => {
            if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
            setSearchFocused(true);
          }}
          onBlur={() => {
            searchBlurTimer.current = setTimeout(() => setSearchFocused(false), 160);
          }}
        />
        {(!compact || searchFocused) ? (
        <View style={styles.studySearchScopes}>
          <Chip label="Текущая неделя" selected={searchScope === "week"} onPress={() => onSearchScope("week")} />
          <Chip label="Текущий год" selected={searchScope === "year"} onPress={() => onSearchScope("year")} />
          <Chip label="Все года" selected={false} disabled onPress={() => undefined} />
        </View>
        ) : null}
        {searchScope === "week" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={
            compact ? styles.mobileChipsScroll : styles.weekdayChipsDesktop
          }
          contentContainerStyle={styles.weekdayChips}
        >
          {dayFilters.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              selected={dayFilter === item.id}
              onPress={() => onDayFilter(item.id)}
            />
          ))}
        </ScrollView>
        ) : null}
      </View>

      {error ? <InlineError message={error} onRetry={onRetry} /> : null}

      {searchScope === "year" ? (
        <View style={styles.studyDatabaseWorkspace}>
          <View style={styles.studyDatabaseResults}>
            <Text style={styles.studySuggestionsTitle}>Поиск по началу фамилии или ФИО</Text>
            {search.trim().length < 2 ? (
              <EmptyState icon="search-outline" title="Введите минимум две буквы" description="Например: Петр или Петров ИВ." />
            ) : archiveSearchLoading ? (
              <LoadingState label="Ищем протоколы в базе…" />
            ) : archiveSuggestions.length ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.studyDatabaseList}>
                {archiveSuggestions.map((study) => (
                  <Pressable
                    key={study.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть протокол ${study.patient}`}
                    onPress={() => chooseDatabaseStudy(study)}
                    style={[styles.studySuggestionRow, databaseSelected?.id === study.id && styles.studyRowSelected]}
                  >
                    <View style={styles.studySuggestionCopy}>
                      <Text numberOfLines={1} style={styles.studySuggestionPatient}>
                        {shortPatientName(study.patient)}{study.age ? ` ${study.age}` : ""}
                      </Text>
                      <Text numberOfLines={1} style={styles.studySuggestionOperation}>
                        {shortOperationName(study.name_operation)}
                      </Text>
                    </View>
                    <Text style={styles.studySuggestionDate}>{formatShortNumericDate(study.time_beginning)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <EmptyState icon="search-outline" title="Совпадений нет" description="Проверьте начало фамилии или ФИО." />
            )}
          </View>
          {inlineDetail ? (
            <ScrollView style={styles.studyDatabaseDetail} contentContainerStyle={styles.detailPaneContent}>
              {databaseSelected ? (
                <StudyDetails
                  study={databaseSelected}
                  hasXA={hasAvailableXA(databaseSelected)}
                  xaCached={xaIsCached(databaseSelected)}
                  onOpenXA={() => onOpenXA(databaseSelected)}
                />
              ) : (
                <EmptyState icon="reader-outline" title="Выберите пациента" description="Протокол из базы откроется здесь." />
              )}
            </ScrollView>
          ) : null}
        </View>
      ) : <View style={styles.studyWorkspace}>
        <View style={styles.studyListPane}>
          {loading && !studies.length ? (
            <LoadingState label="Получаем исследования с сервера…" />
          ) : studies.length ? (
            <ScrollView
              refreshControl={
                <RefreshControl
                  refreshing={loading}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                />
              }
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.studyList}
            >
              {studies.map((study, index) => {
                const hasXA = hasAvailableXA(study);
                return (
                <View key={study.id}>
                  <StudyRow
                    study={study}
                    index={index}
                    compact={compact}
                    selected={selected?.id === study.id}
                    hasXA={hasXA}
                    onOpenXA={() => onOpenXA(study)}
                    onPress={() => choose(study)}
                  />
                </View>
                );
              })}
            </ScrollView>
          ) : (
            <EmptyState
              icon="search-outline"
              title="Исследований не найдено"
              description="Измените поиск, день недели или фильтр операции."
            />
          )}
        </View>

        {inlineDetail ? (
          <ScrollView
            style={styles.detailPane}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.detailPaneContent}
          >
            {selected ? (
              <StudyDetails
                study={selected}
                hasXA={hasAvailableXA(selected)}
                xaCached={xaIsCached(selected)}
                onOpenXA={() => onOpenXA(selected)}
              />
            ) : (
              <EmptyState
                icon="reader-outline"
                title="Выберите пациента"
                description="Полный протокол операции появится здесь."
              />
            )}
          </ScrollView>
        ) : null}
      </View>}

      {!inlineDetail ? (
        <Sheet
          visible={detailOpen && Boolean(selected)}
          title={selected?.patient || "Исследование"}
          onClose={() => setDetailOpen(false)}
          fullScreen={compact}
          wide
        >
          {selected ? (
            <ScrollView contentContainerStyle={styles.sheetScroll}>
              <StudyDetails
                study={selected}
                hasXA={hasAvailableXA(selected)}
                xaCached={xaIsCached(selected)}
                onOpenXA={() => {
                  setDetailOpen(false);
                  onOpenXA(selected);
                }}
              />
            </ScrollView>
          ) : null}
        </Sheet>
      ) : null}
    </View>
  );
}

function StudyRow({
  study,
  index,
  compact,
  selected,
  onPress,
  onOpenXA,
  hasXA
}: {
  study: Study;
  index: number;
  compact: boolean;
  selected: boolean;
  onPress: () => void;
  onOpenXA: () => void;
  hasXA: boolean;
}) {
  const operation = shortOperationName(study.name_operation);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${study.patient}, ${operation}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.studyRow,
        compact && styles.studyRowCompact,
        selected && styles.studyRowSelected,
        pressed && styles.pressed
      ]}
    >
      <Text style={styles.studyIndexText}>
        {String(index + 1).padStart(2, "0")}
      </Text>
      <View style={styles.studyCopy}>
        <View style={styles.studyTitleLine}>
          <Text numberOfLines={1} style={styles.studyPatient}>
			{shortPatientName(study.patient)}
            {study.age ? (
              <Text style={styles.studyAge}> {study.age}</Text>
            ) : null}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.studyOperation}>
          {operation}
        </Text>
      </View>
      <View style={styles.studyTrailing}>
        <Text style={styles.studyDateCompact}>{formatDate(study.time_beginning)}</Text>
        {hasXA ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Открыть XA пациента"
            hitSlop={6}
            onPress={(event) => {
              event.stopPropagation();
              onOpenXA();
            }}
            style={styles.xaState}
          >
            <Text style={styles.xaStateText}>XA</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export function cleanClinicalText(value: string, operation = false): string {
  const withoutRoom = operation
    ? value.replace(
        /^\s*операционная\s*(?:№\s*)?2\s*[.·,:;\-–—]*\s*/i,
        ""
      )
    : value;
  return withoutRoom
    .replace(
      /внутрисосудист(?:ое|ый)\s+(?:ультразвуковое\s+исследование|ультразвук|исследование)/gi,
      "ВСУЗИ"
    )
    .replace(/частичная|отмечается/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function shortOperationName(value: string): string {
  const replacements: [RegExp, string][] = [
    [/коронарошунтограф[А-Яа-яЁёA-Za-z]*/gi, "КАГ+шунтогр"],
    [/коронарограф[А-Яа-яЁёA-Za-z]*/gi, "КАГ"],
    [/церебральн[А-Яа-яЁёA-Za-z]*\s+(?:пан)?ангиограф[А-Яа-яЁёA-Za-z]*/gi, "ЦАГ"],
    [/(?:пан)?ангиограф[А-Яа-яЁёA-Za-z]*/gi, "АГ"],
    [/тромб(?:о)?(?:аспирац|экстракц)[А-Яа-яЁёA-Za-z]*/gi, "ТА"],
    [/(?:механическ[А-Яа-яЁёA-Za-z]*\s+)?реканализац[А-Яа-яЁёA-Za-z]*/gi, "МР"],
    [/стентирован[А-Яа-яЁёA-Za-z]*/gi, "стент"],
    [/анги(?:о|л)?пласт[А-Яа-яЁёA-Za-z]*/gi, "БАП"],
    [/бифуркационн[А-Яа-яЁёA-Za-z]*/gi, "биф"],
    [/(?:внутриаортальн[А-Яа-яЁёA-Za-z]*\s+)?контрпульсатор[А-Яа-яЁёA-Za-z]*/gi, "ВАБК"],
    [/(?:электро)?кардиостимулятор[А-Яа-яЁёA-Za-z]*/gi, "ЭКС"],
    [/ствол[А-Яа-яЁёA-Za-z]*\s+лев[А-Яа-яЁёA-Za-z]*\s+коронарн[А-Яа-яЁёA-Za-z]*(?:\s+артери[А-Яа-яЁёA-Za-z]*)?/gi, "стЛКА"],
    [/передн[А-Яа-яЁёA-Za-z]*\s+нисходящ[А-Яа-яЁёA-Za-z]*(?:\s+артери[А-Яа-яЁёA-Za-z]*)?/gi, "ПНА"],
    [/огибающ[А-Яа-яЁёA-Za-z]*(?:\s+артери[А-Яа-яЁёA-Za-z]*)?/gi, "ОА"],
    [/вет[А-Яа-яЁёA-Za-z]*\s+тупого\s+края/gi, "ВТК"],
    [/прав[А-Яа-яЁёA-Za-z]*\s+коронарн[А-Яа-яЁёA-Za-z]*(?:\s+артери[А-Яа-яЁёA-Za-z]*)?/gi, "ПКА"],
    [/лев[А-Яа-яЁёA-Za-z]*\s+коронарн[А-Яа-яЁёA-Za-z]*(?:\s+артери[А-Яа-яЁёA-Za-z]*)?/gi, "ЛКА"],
    [/диагональн[А-Яа-яЁёA-Za-z]*(?:\s+ветв[А-Яа-яЁёA-Za-z]*)?/gi, "ДА"],
    [/задн[А-Яа-яЁёA-Za-z]*\s+нисходящ[А-Яа-яЁёA-Za-z]*(?:\s+артери[А-Яа-яЁёA-Za-z]*)?/gi, "ЗНА"],
    [/заднебоков[А-Яа-яЁёA-Za-z]*(?:\s+ветв[А-Яа-яЁёA-Za-z]*)?/gi, "ЗБВ"],
    [/базилярн[А-Яа-яЁёA-Za-z]*\s+артери[А-Яа-яЁёA-Za-z]*/gi, "БА"],
    [/средн[А-Яа-яЁёA-Za-z]*\s+мозгов[А-Яа-яЁёA-Za-z]*\s+артери[А-Яа-яЁёA-Za-z]*/gi, "СМА"],
    [/задн[А-Яа-яЁёA-Za-z]*\s+мозгов[А-Яа-яЁёA-Za-z]*\s+артери[А-Яа-яЁёA-Za-z]*/gi, "ЗМА"],
    [/проксимальн[А-Яа-яЁёA-Za-z]*\s+сегмент[А-Яа-яЁёA-Za-z]*/gi, "пр/3"],
    [/средн[А-Яа-яЁёA-Za-z]*\s+сегмент[А-Яа-яЁёA-Za-z]*/gi, "ср/3"],
    [/дистальн[А-Яа-яЁёA-Za-z]*\s+сегмент[А-Яа-яЁёA-Za-z]*/gi, "д/3"]
  ];
  let operation = cleanClinicalText(value, true);
  replacements.forEach(([pattern, replacement]) => {
    operation = operation.replace(pattern, replacement);
  });
  operation = operation
    .replace(/в\s+условиях/gi, "")
    .replace(/бассейн[А-Яа-яЁёA-Za-z]*/gi, "")
    .replace(/попытк[А-Яа-яЁёA-Za-z]*|\btry\b/gi, "поп.")
    .replace(/справа/gi, "прав.")
    .replace(/слева/gi, "лев.")
    .replace(/(?:локальн|эндоваскулярн|трансартериальн|тотальн|селективн|транслюминальн|первичн)[А-Яа-яЁёA-Za-z]*/gi, "")
    .replace(/(?:баллонн|механическ|артери|окклюзи|установк)[А-Яа-яЁёA-Za-z]*/gi, "")
    .replace(/ТА\s*\/\s*ТА/gi, "ТА")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])(?=[^\s\d])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,;\s]+|[,;\s]+$/g, "");
  return operation.length > 100 ? `${operation.slice(0, 97).trim()}...` : operation;
}

export function plannedRecommendation(value: string): string {
  const beforeMaterials = value.replace(/расходные\s+материалы[\s\S]*$/i, "");
  const items = beforeMaterials
    .split(/-\s+|\n+/)
    .map((item) => cleanClinicalText(item).trim())
    .filter((item) => /в\s+плановом\s+порядке/i.test(item));
  if (items.length) return items.join("\n");
  return beforeMaterials
    .split(/(?<=[.!?])\s*/)
    .map((item) => cleanClinicalText(item).trim())
    .filter((item) => /в\s+плановом\s+порядке/i.test(item))
    .join("\n");
}

function protocolSections(description: string): {
  conclusion: string;
  course: string;
  recommendation: string;
} {
  const result = { conclusion: "", course: "", recommendation: "" };
  const normalized = description.trim();
  const labels = [...normalized.matchAll(/(?:^|\n)(ЗАКЛЮЧЕНИЕ|ХОД ОПЕРАЦИИ|РЕКОМЕНДАЦИИ):\s*/gim)];
  if (labels.length) {
    labels.forEach((match, index) => {
      const value = normalized
        .slice((match.index ?? 0) + match[0].length, labels[index + 1]?.index)
        .trim();
      const label = match[1]?.toLocaleLowerCase("ru");
      if (label === "заключение") result.conclusion = value;
      if (label === "ход операции") result.course = value;
      if (label === "рекомендации") result.recommendation = value;
    });
    return result;
  }
  const marker = /(?:в\s+ходе\s+исследования\s+выявлено|заключение)\s*:\s*/i.exec(normalized);
  if (marker?.index !== undefined) {
    result.course = normalized.slice(0, marker.index).trim();
    result.conclusion = normalized.slice(marker.index + marker[0].length).trim();
  } else {
	result.conclusion = normalized;
  }
  return result;
}

function ProtocolDescription({ description, recommendation: directRecommendation = "" }: { description: string; recommendation?: string }) {
  const sections = protocolSections(description);
	const recommendation = plannedRecommendation(directRecommendation || sections.recommendation);
  return (
    <View style={styles.protocolContent}>
      {sections.conclusion ? (
        <View style={styles.protocolConclusion}>
          <Text style={styles.protocolConclusionLabel}>ЗАКЛЮЧЕНИЕ</Text>
          <Text style={styles.protocolConclusionText}>
            {cleanClinicalText(sections.conclusion)}
          </Text>
        </View>
      ) : null}
      {recommendation ? (
        <View style={styles.protocolCourse}>
          <Text style={styles.detailLabel}>РЕКОМЕНДАЦИИ</Text>
          <Text style={styles.detailDescription}>{recommendation}</Text>
        </View>
      ) : null}
      {!sections.conclusion && !recommendation ? (
        <Text style={styles.detailDescription}>Описание пока не добавлено.</Text>
      ) : null}
    </View>
  );
}

function StudyDetails({
  study,
  hasXA,
  xaCached,
  onOpenXA
}: {
  study: Study;
  hasXA: boolean;
  xaCached: boolean;
  onOpenXA: () => void;
}) {
  return (
    <View style={styles.detailsCard}>
      <View style={styles.detailsHero}>
        <View style={styles.detailsIcon}>
          <Icon name="reader-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.detailsHeroCopy}>
          <Text style={styles.detailsPatient}>
			{shortPatientName(study.patient)}
            {study.age ? (
              <Text style={styles.detailsAge}> {study.age}</Text>
            ) : null}
          </Text>
          <Text style={styles.detailsSubtitle}>
            ID {study.study_id}
          </Text>
        </View>
      </View>

      <View style={styles.detailGrid}>
        <DetailItem
          label="Дата и время"
          value={formatDate(study.time_beginning, true)}
        />
        <DetailItem
          label="Продолжительность"
          value={formatDuration(study.time_duration)}
        />
        <DetailItem label="Отделение" value={study.department || "—"} />
        <DetailItem label="Хирург" value={study.surgeon || "—"} />
      </View>

      <View style={styles.detailSection}>
        <Text style={styles.detailLabel}>ОПЕРАЦИЯ</Text>
        <Text style={styles.detailHeading}>
          {cleanClinicalText(study.name_operation, true)}
        </Text>
      </View>

      <View style={styles.protocolSection}>
		<ProtocolDescription description={study.descr_operation || ""} recommendation={study.recommendation} />
      </View>
      <View style={styles.detailsActions}>
        <Button
          label="Отправить"
          icon="share-outline"
          variant="secondary"
          onPress={() => void shareStudyProtocol(study)}
          style={styles.flexButton}
        />
        {hasXA ? (
          <Button
            label={xaCached ? "Открыть XA" : "Загрузить XA"}
            icon={xaCached ? "scan-outline" : "cloud-download-outline"}
            onPress={onOpenXA}
            style={styles.flexButton}
          />
        ) : null}
      </View>
    </View>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailItemLabel}>{label}</Text>
      <Text style={styles.detailItemValue}>{value}</Text>
    </View>
  );
}

function AngiographyScreen({
  compact,
  studies,
  loading,
  error,
  persistentCacheEnabled,
  dicomCache,
  onRetry,
  onDeleteLocal,
  onSearch,
  initialStudyUID,
  onInitialStudyHandled
}: {
  compact: boolean;
  studies: Study[];
  loading: boolean;
  error: string;
  persistentCacheEnabled: boolean;
  dicomCache: DicomCacheSnapshot;
  onRetry: () => void;
  onDeleteLocal: (study: Study) => Promise<void>;
  onSearch: (modality: "xa" | "ct") => void;
  initialStudyUID: string | null;
  onInitialStudyHandled: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Study | null>(studies[0] ?? null);
  const [mobileViewer, setMobileViewer] = useState(false);
  const [studyFilter, setStudyFilter] = useState<"xa" | "ct">("xa");
  const [actionStudy, setActionStudy] = useState<Study | null>(null);
  const [pacsGuideOpen, setPacsGuideOpen] = useState(false);
  useEffect(() => {
    if (!selected && studies[0]) setSelected(studies[0]);
  }, [selected, studies]);

  const choose = (study: Study) => {
    setSelected(study);
    if (compact && study.study_type.toLowerCase() === "xa") {
      setMobileViewer(true);
    }
  };
  const visibleStudies = useMemo(
    () =>
      studies.filter(
        (study) => study.study_type.toLowerCase() === studyFilter
      ),
    [studies, studyFilter]
  );

  useEffect(() => {
    if (!visibleStudies.some((study) => study.id === selected?.id)) {
      setSelected(visibleStudies[0] ?? null);
    }
  }, [selected?.id, visibleStudies]);

  useEffect(() => {
    if (!initialStudyUID) return;
    const study = studies.find(
      (item) =>
        item.study_id === initialStudyUID &&
        item.study_type.toLowerCase() === "xa"
    );
    if (!study) return;
    setStudyFilter("xa");
    setSelected(study);
    if (compact) setMobileViewer(true);
    onInitialStudyHandled();
  }, [compact, initialStudyUID, onInitialStudyHandled, studies]);

  return (
    <View style={styles.angioScreen}>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      <View
        style={[styles.angioFilters, compact && styles.angioFiltersCompact]}
      >
        {(["xa", "ct"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setStudyFilter(value)}
            style={[
              styles.angioFilter,
              studyFilter === value && styles.angioFilterActive
            ]}
          >
            <Text style={[
              styles.angioFilterText,
              studyFilter === value && styles.angioFilterTextActive
            ]}>
              {value.toUpperCase()}
            </Text>
          </Pressable>
        ))}
        <View style={styles.angioHeaderActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Найти ${studyFilter.toUpperCase()}`}
            onPress={() => onSearch(studyFilter)}
            style={styles.angioGuideButton}
          >
            <Icon name="add" size={22} color={darkColors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Как подключить RadiAnt"
            onPress={() => setPacsGuideOpen(true)}
            style={styles.angioGuideButton}
          >
            <Icon name="alert-circle-outline" size={20} color={darkColors.primary} />
          </Pressable>
        </View>
      </View>
      {loading && !studies.length ? (
        <LoadingState label="Проверяем XA-исследования…" />
      ) : studies.length ? (
        <>
          <View
            style={[
              styles.angioWorkspace,
              compact && styles.angioWorkspaceCompact
            ]}
          >
            <ScrollView
              style={[
                styles.angioList,
                compact ? styles.angioListCompact : styles.angioListDesktop
              ]}
              contentContainerStyle={styles.angioListContent}
              showsVerticalScrollIndicator={false}
            >
              {visibleStudies.map((study, index) => {
                const cached = dicomCache.studies[study.study_id];
                const cacheMeta = cached
                  ? cached.complete
                    ? formatStorageSize(cached.bytes)
                    : cached.downloading
                      ? `загрузка ${cached.cachedFrames}/${cached.expectedFrames || "…"} серий`
                      : cached.bytes
                        ? `${formatStorageSize(cached.bytes)} · не полностью`
                        : ""
                  : "";
                return (
                  <Pressable
                    key={study.id}
                    accessibilityRole="button"
                    accessibilityLabel={
                      compact
                        ? `Открыть ангиографию ${study.patient}`
                        : `Исследование ${study.patient} находится в PACS`
                    }
                    onPress={() => choose(study)}
                    style={[
                      styles.angioRow,
                      selected?.id === study.id && styles.angioRowSelected
                    ]}
                  >
                    <Text style={styles.angioIndex}>
                      {String(index + 1).padStart(2, "0")}
                    </Text>
                    <View style={styles.angioRowCopy}>
                      <Text numberOfLines={1} style={styles.angioPatient}>
                        {study.patient}
                      </Text>
                      <Text numberOfLines={1} style={styles.angioMeta}>
                        {formatDate(study.time_beginning)} ·{" "}
                        {study.study_type.toUpperCase()}
                        {cacheMeta ? ` · ${cacheMeta}` : ""}
                      </Text>
                    </View>
                    <View style={styles.angioStored}>
                      <Icon
                        name={
                          cached?.complete
                            ? "phone-portrait-outline"
                            : "cloud-done-outline"
                        }
                        size={15}
                        color={colors.success}
                      />
                    </View>
                    {compact ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Действия с ${study.patient}`}
                        hitSlop={10}
                        onPress={(event) => {
                          event.stopPropagation();
                          setActionStudy(study);
                        }}
                        style={styles.angioRowAction}
                      >
                        <Icon name="ellipsis-horizontal" size={20} color={darkColors.textMuted} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
              {!visibleStudies.length ? (
                <Text style={styles.angioNoFilterResults}>
                  В этом разделе исследований пока нет.
                </Text>
              ) : null}
            </ScrollView>
            {!compact ? (
              <View style={styles.angioDesktopViewer}>
                {studyFilter === "xa" && selected ? (
                  <MobileDicomViewer
                    key={selected.study_id}
                    studyUID={selected.study_id}
                    desktop
                    persistentCacheEnabled={persistentCacheEnabled}
                  />
                ) : selected ? (
                  <View style={styles.angioCTPlaceholder}>
                    <Icon name="server-outline" size={36} color={darkColors.primary} />
                    <Text style={styles.angioCTTitle}>{selected.patient}</Text>
                    <Text style={styles.angioCTText}>
                      CT находится в удалённом PACS и доступно для просмотра через RadiAnt.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.angioCTPlaceholder}>
                    <Text style={styles.angioCTText}>Выберите исследование</Text>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.angioEmpty}>
          <Icon name="scan-outline" size={32} color={darkColors.primary} />
          <Text style={styles.angioEmptyTitle}>XA и CT пока не загружены</Text>
          <Text style={styles.angioEmptyText}>
            Исследования появятся здесь после автоматической доставки агентом
            через Yandex в удалённый PACS.
          </Text>
          <Button
            label="Подключение RadiAnt"
            icon="alert-circle-outline"
            variant="secondary"
            onPress={() => setPacsGuideOpen(true)}
          />
        </View>
      )}

      {compact ? (
        <Modal
          visible={mobileViewer && Boolean(selected)}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setMobileViewer(false)}
        >
          <SafeAreaView style={styles.mobileAngioViewer}>
            {selected ? (
              <>
                <View style={styles.mobileViewerFrame}>
                  <MobileDicomViewer
                    studyUID={selected.study_id}
                    persistentCacheEnabled={persistentCacheEnabled}
                  />
                </View>
                <View
                  style={[
                    styles.mobileViewerTop,
                    { top: insets.top + 8 }
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Закрыть просмотр"
                    onPress={() => setMobileViewer(false)}
                    style={styles.mobileViewerRoundButton}
                  >
                    <Icon
                      name="chevron-back"
                      size={24}
                      color={darkColors.text}
                    />
                  </Pressable>
                  <View style={styles.mobileViewerIdentity}>
                    <Text numberOfLines={1} style={styles.mobileViewerPatient}>
                      {selected.patient}
                    </Text>
                    <Text style={styles.mobileViewerMeta}>
                      {formatDate(selected.time_beginning, true)} ·{" "}
                      {selected.study_type.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}
          </SafeAreaView>
        </Modal>
      ) : null}

      <Sheet
        visible={compact && Boolean(actionStudy)}
        title={actionStudy?.patient || "Ангиография"}
        onClose={() => setActionStudy(null)}
      >
        <View style={styles.angioActionSheet}>
          <Pressable
            onPress={() => {
              const study = actionStudy;
              setActionStudy(null);
              if (!study) return;
              confirmDeleteAll(
                `Удалить сохранённые файлы ${study.patient} с этого устройства?`,
                () => void onDeleteLocal(study)
              );
            }}
            style={[styles.angioActionButton, styles.angioActionDanger]}
          >
            <Icon name="trash-outline" size={21} color={colors.danger} />
            <Text style={[styles.angioActionText, styles.angioActionDangerText]}>
              Удалить
            </Text>
          </Pressable>
        </View>
      </Sheet>
      <Sheet
        visible={pacsGuideOpen}
        title="Просмотр через RadiAnt"
        onClose={() => setPacsGuideOpen(false)}
        wide
      >
        <ScrollView contentContainerStyle={styles.pacsGuideContent}>
          <Text style={styles.pacsGuideIntro}>
            Добавьте удалённый PACS в разделе PACS locations программы RadiAnt.
          </Text>
          <View style={styles.pacsGuideGrid}>
            <DetailItem label="Адрес сервера" value="135.106.130.37" />
            <DetailItem label="DICOM-порт" value="4242" />
            <DetailItem label="AE Title сервера" value="MAPDR" />
            <DetailItem label="AE Title компьютера" value="RADIANT" />
            <DetailItem label="Локальный порт" value="11112" />
          </View>
          <View style={styles.pacsGuideSteps}>
            <Text style={styles.pacsGuideStep}>1. Откройте Configuration → PACS locations → Add.</Text>
            <Text style={styles.pacsGuideStep}>2. Внесите параметры выше и сохраните подключение.</Text>
            <Text style={styles.pacsGuideStep}>3. Выполните Verify/C-ECHO, затем используйте Search and download.</Text>
          </View>
          <Text style={styles.pacsGuideNote}>
            Подключение доступно только с разрешённого компьютера и сети. Входящие DICOM-соединения RadiAnt должны быть разрешены в брандмауэре для порта 11112.
          </Text>
        </ScrollView>
      </Sheet>
    </View>
  );
}

function RequestCard({
  compact,
  request,
  studies,
  onSubmit,
  onRefresh
}: {
  compact: boolean;
  request: UserRequest;
  studies: Study[];
  onSubmit: (
    command: AgentCommand,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const [resultOpen, setResultOpen] = useState(false);
  const meta = statusMeta(request.status);
  const payload = parseObject(request.payload);
  const result = parseObject(request.result);
  const protocols = objectArray(result.protocols);
  const pacsStudies = objectArray(result.studies);
  const resultCount = protocols.length || pacsStudies.length;
  const subject =
    String(payload.patient ?? payload.patient_name ?? payload.study_uid ?? "") ||
    "Без дополнительных параметров";


  return (
    <View style={styles.requestCard}>
      <View style={styles.requestIcon}>
        <Icon
          name={
            request.status === "completed"
              ? "checkmark"
              : request.status === "error"
                ? "alert"
                : "pulse"
          }
          color={
            request.status === "completed"
              ? colors.success
              : request.status === "error"
                ? colors.danger
                : colors.primary
          }
        />
      </View>
      <View style={styles.requestCopy}>
        <View style={styles.requestTitleLine}>
          <Text style={styles.requestTitle}>
            {commandLabels[request.command] ?? request.command}
          </Text>
          <Badge label={meta.label} tone={meta.tone} />
        </View>
        <Text style={styles.requestSubject}>{subject}</Text>
        <View style={styles.requestMeta}>
          <Text style={styles.requestMetaText}>
            {formatDate(request.created_at, true)}
          </Text>
        </View>
        {request.errors ? (
          <Text style={styles.requestError}>{request.errors}</Text>
        ) : null}
        {request.status === "completed" &&
        ["find_study", "find_xa", "find_ct"].includes(request.command) ? (
          <View style={styles.requestResultSummary}>
            <Text style={styles.requestResultText}>
              {resultCount
                ? `Найдено: ${resultCount}`
                : "Совпадений не найдено"}
            </Text>
            {resultCount ? (
              <Button
                label={
                  protocols.length ? "Открыть протоколы" : "Открыть результаты"
                }
                variant="secondary"
                compact
                onPress={() => setResultOpen(true)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      {!compact ? (
        <IconButton icon="refresh" label="Обновить статус" onPress={onRefresh} />
      ) : null}

      <Sheet
        visible={resultOpen}
        title={protocols.length ? "Найденные протоколы" : "Исследования PACS"}
        onClose={() => setResultOpen(false)}
        wide
        fullScreen={compact}
      >
        <ScrollView contentContainerStyle={styles.resultSheet}>
          {protocols.map((protocol, index) => {
            const studyId = String(protocol.study_id ?? "");
            const saved = studies.some(
              (study) =>
                (studyId && study.study_id === studyId) ||
                (study.patient === String(protocol.patient ?? "") &&
                  study.name_operation ===
                    String(protocol.name_operation ?? ""))
            );
            return (
              <View key={`${studyId}-${index}`} style={styles.protocolResult}>
                <View style={styles.resultHeader}>
                  <View style={styles.resultHeaderCopy}>
                    <Text style={styles.resultPatient}>
                      {String(protocol.patient ?? "Пациент не указан")}
                    </Text>
                    <Text style={styles.resultOperation}>
                      {String(protocol.name_operation ?? "Операция не указана")}
                    </Text>
                  </View>
                  <Badge
                    label={saved ? "Есть в Studies" : "Только результат поиска"}
                    tone={saved ? "success" : "warning"}
                  />
                </View>
                <Text style={styles.resultMetaText}>
                  {String(protocol.department ?? "Отделение не указано")} ·{" "}
                  {String(protocol.surgeon ?? "Хирург не указан")}
                </Text>
                <ProtocolDescription
                  description={String(protocol.descr_operation ?? "")}
                />
                {!saved && protocol.protocol_ref ? (
                  <Button
                    label="Загрузить этот протокол"
                    icon="cloud-upload-outline"
                    onPress={() =>
                      void onSubmit("import_study", {
                        protocol_ref: String(protocol.protocol_ref)
                      })
                    }
                  />
                ) : null}
              </View>
            );
          })}
          {pacsStudies.map((study, index) => {
            const uid = String(
              study.uid ?? study.study_uid ?? study.StudyInstanceUID ?? ""
            );
            const modality = String(
              result.modality ?? study.modality ?? "XA"
            ).toUpperCase();
            return (
              <View key={`${uid}-${index}`} style={styles.pacsResult}>
                <View style={styles.resultHeader}>
                  <View style={styles.resultHeaderCopy}>
                    <Text style={styles.resultPatient}>
                      {String(
                        study.patient ?? study.name ?? "Пациент не указан"
                      )}
                    </Text>
                    <Text style={styles.resultOperation}>
                      {String(
                        study.description ?? `${modality}-исследование`
                      )}
                    </Text>
                  </View>
                  <Badge label={modality} />
                </View>
                <Text style={styles.resultMetaText}>
                  {String(study.study_date ?? study.date ?? "Дата не указана")}
                </Text>
                {uid ? (
                  <Button
                    label={`Загрузить ${modality}`}
                    icon="cloud-download-outline"
                    onPress={() =>
                      void onSubmit(
                        modality === "CT" ? "get_ct" : "get_xa",
                        { study_uid: uid }
                      )
                    }
                  />
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function ReportsScreen({
  compact,
  reports,
  loading,
  error,
  onRetry,
  onRefresh,
  onGenerate,
  generating,
  onDelete,
  onForward
}: {
  compact: boolean;
  reports: ReportDocument[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onRefresh: () => void;
  onGenerate: (period: {
    days?: number;
    dateFrom?: string;
    dateTo?: string;
  }) => Promise<boolean>;
  generating: boolean;
  onDelete: (report: ReportDocument) => void;
  onForward: (report: ReportDocument) => void;
}) {
  const [selected, setSelected] = useState<ReportDocument | null>(
    reports[0] ?? null
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);

  useEffect(() => {
    if (!selected && reports[0]) setSelected(reports[0]);
  }, [reports, selected]);

  const choose = (report: ReportDocument) => {
    setSelected(report);
    if (compact) setMobileOpen(true);
  };

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View
        style={[
          styles.compactScreenToolbar,
          compact && styles.compactScreenToolbarMobile
        ]}
      >
        <View style={styles.compactScreenHeading}>
          <Text style={styles.compactScreenTitle}>Отчёты</Text>
          <Text style={styles.compactScreenMeta}>{reports.length} записей</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={generating ? "Отчёт формируется" : "Сформировать отчёт"}
          disabled={generating}
          onPress={() => setPeriodOpen(true)}
          style={[
            styles.reportRequestButton,
            generating && styles.reportRequestButtonPending
          ]}
        >
          {generating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="add" size={22} color={colors.primary} />
          )}
        </Pressable>
      </View>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading && !reports.length ? (
        <LoadingState label="Загружаем отчёты…" />
      ) : reports.length ? (
        <View
          style={[
            styles.reportWorkspace,
            compact && styles.reportWorkspaceCompact
          ]}
        >
          <ScrollView
            style={[styles.reportList, compact && styles.reportListCompact]}
            contentContainerStyle={styles.reportListContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              compact ? (
                <RefreshControl
                  refreshing={false}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                />
              ) : undefined
            }
          >
            {reports.map((report, index) => (
              <View key={report.filename ?? `${report.generated_at}-${index}`}>
                <ReportRow
                  report={report}
                  selected={selected?.filename === report.filename}
                  compact={compact}
                  onPress={() => choose(report)}
                  onDelete={() => onDelete(report)}
                  onForward={() => onForward(report)}
                />
              </View>
            ))}
          </ScrollView>
          {!compact && selected ? (
            <ScrollView
              style={styles.reportDetailPane}
              contentContainerStyle={styles.reportDetailContent}
              showsVerticalScrollIndicator={false}
            >
              <ReportDetail report={selected} />
            </ScrollView>
          ) : null}
        </View>
      ) : (
        <EmptyState
          icon="document-text-outline"
          title="Отчётов пока нет"
          description="Сформируйте отчёт из протоколов операций и операционного плана."
          action={<Button label="Сформировать отчёт" onPress={() => setPeriodOpen(true)} />}
        />
      )}
      {compact ? (
        <Sheet
          visible={mobileOpen && Boolean(selected)}
          title={reportData(selected ?? {}).date ?? "Отчёт дежурства"}
          onClose={() => setMobileOpen(false)}
          fullScreen
        >
          {selected ? (
            <ScrollView contentContainerStyle={styles.reportDetailContent}>
              <ReportDetail report={selected} />
            </ScrollView>
          ) : null}
        </Sheet>
      ) : null}
      <ReportPeriodSheet
        visible={periodOpen}
        compact={compact}
        generating={generating}
        onClose={() => setPeriodOpen(false)}
        onGenerate={async (period) => {
          const created = await onGenerate(period);
          if (created) setPeriodOpen(false);
          return created;
        }}
      />
    </View>
  );
}

function ReportPeriodSheet({
  visible,
  compact,
  generating,
  onClose,
  onGenerate
}: {
  visible: boolean;
  compact: boolean;
  generating: boolean;
  onClose: () => void;
  onGenerate: (period: {
    days?: number;
    dateFrom?: string;
    dateTo?: string;
  }) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"days" | "calendar">("days");
  const [days, setDays] = useState(1);
  const [month, setMonth] = useState(() => {
    const current = new Date();
    return new Date(current.getFullYear(), current.getMonth(), 1, 12);
  });
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(month);
  const firstOffset = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstOffset + 1;
    if (day < 1 || day > daysInMonth) return null;
    return new Date(month.getFullYear(), month.getMonth(), day, 12);
  });
  const chooseDate = (date: Date) => {
    const value = localDateKey(date);
    if (!dateFrom || dateTo || value < dateFrom) {
      setDateFrom(value);
      setDateTo(null);
      return;
    }
    setDateTo(value);
  };
  const submit = () => {
    if (mode === "days") {
      void onGenerate({ days });
      return;
    }
    if (dateFrom && dateTo) {
      void onGenerate({ dateFrom, dateTo });
    }
  };

  return (
    <Sheet
      visible={visible}
      title="Период отчёта"
      onClose={onClose}
      wide
      fullScreen={compact}
    >
      <ScrollView
        contentContainerStyle={styles.reportPeriodContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.reportPeriodModes}>
          <Chip label="1–7 дней" selected={mode === "days"} onPress={() => setMode("days")} />
          <Chip label="По календарю" selected={mode === "calendar"} onPress={() => setMode("calendar")} />
        </View>
        {mode === "days" ? (
          <View>
            <Text style={styles.reportPeriodHint}>Завершённые дежурства до 08:00 сегодня</Text>
            <View style={styles.reportDayChoices}>
              {Array.from({ length: 7 }, (_, index) => index + 1).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: days === value }}
                  onPress={() => setDays(value)}
                  style={[styles.reportDayChoice, days === value && styles.reportDayChoiceActive]}
                >
                  <Text style={[styles.reportDayChoiceText, days === value && styles.reportDayChoiceTextActive]}>
                    {value}
                  </Text>
                  <Text style={[styles.reportDayChoiceUnit, days === value && styles.reportDayChoiceTextActive]}>
                    {value === 1 ? "день" : value < 5 ? "дня" : "дней"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.reportCalendar}>
            <View style={styles.reportCalendarHeader}>
              <IconButton
                icon="chevron-back"
                label="Предыдущий месяц"
                onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))}
              />
              <Text style={styles.reportCalendarTitle}>{monthLabel}</Text>
              <IconButton
                icon="chevron-forward"
                label="Следующий месяц"
                onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))}
              />
            </View>
            <View style={styles.reportCalendarGrid}>
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
                <Text key={label} style={styles.reportCalendarWeekday}>{label}</Text>
              ))}
              {cells.map((date, index) => {
                const value = date ? localDateKey(date) : "";
                const selected = Boolean(value && (value === dateFrom || value === dateTo));
                const inRange = Boolean(value && dateFrom && dateTo && value > dateFrom && value < dateTo);
                return (
                  <View key={index} style={[styles.reportCalendarCell, inRange && styles.reportCalendarCellInRange]}>
                    {date ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={formatDate(value)}
                        onPress={() => chooseDate(date)}
                        style={[styles.reportCalendarDate, selected && styles.reportCalendarDateSelected]}
                      >
                        <Text style={[styles.reportCalendarDateText, selected && styles.reportCalendarDateTextSelected]}>{date.getDate()}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <Text style={styles.reportPeriodHint}>
              {dateFrom
                ? `${formatDate(dateFrom)} — ${dateTo ? formatDate(dateTo) : "выберите дату окончания"}`
                : "Выберите дату начала и окончания"}
            </Text>
          </View>
        )}
        <Button
          label={generating ? "Формируем…" : "Сформировать отчёт"}
          icon={generating ? undefined : "document-text-outline"}
          disabled={generating || (mode === "calendar" && (!dateFrom || !dateTo))}
          onPress={submit}
        />
      </ScrollView>
    </Sheet>
  );
}

function StatisticsScreen({
	compact,
  statistics,
  historicalStatistics,
  loading,
  error,
  onRetry
}: {
	compact: boolean;
  statistics: OperationStatistics | null;
  historicalStatistics: HistoricalStatistics | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
	const [mobileColumn, setMobileColumn] = useState("total");
	const [mobileColumnOpen, setMobileColumnOpen] = useState(false);
	const selectedMobileType = statistics?.operation_types.find(
		(type) => type.id === mobileColumn
	);
	const mobileColumnLabel =
		mobileColumn === "total" ? "Все операции" : selectedMobileType?.label ?? "Все операции";
	const mobileColumnTotal =
		mobileColumn === "total"
			? statistics?.surgeons.reduce((sum, row) => sum + row.total, 0) ?? 0
			: selectedMobileType?.total ?? 0;

	if (compact) {
		return (
			<View style={[styles.statisticsScreen, styles.screenCompact]}>
				<View style={styles.compactScreenToolbar}>
					<View style={styles.compactScreenHeading}>
						<Text style={styles.compactScreenTitle}>Статистика</Text>
						<Text style={styles.compactScreenMeta}>Операции хирургов · {new Date().getFullYear()}</Text>
					</View>
					<IconButton icon="refresh-outline" label="Обновить статистику" onPress={onRetry} />
				</View>
				{error ? <InlineError message={error} onRetry={onRetry} /> : null}
				{loading && !statistics ? <LoadingState label="Считаем операции…" /> : null}
				{statistics ? (
					<ScrollView
						style={styles.mobileStatisticsScroll}
						contentContainerStyle={styles.mobileStatisticsContent}
						showsVerticalScrollIndicator={false}
					>
						<View style={styles.mobileStatisticsSelectorCard}>
							<Text style={styles.mobileStatisticsSelectorLabel}>Показатель</Text>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Выбрать показатель статистики"
								onPress={() => setMobileColumnOpen((current) => !current)}
								style={styles.mobileStatisticsSelector}
							>
								<Text numberOfLines={1} style={styles.mobileStatisticsSelectorValue}>
									{mobileColumnLabel}
								</Text>
								<Icon
									name={mobileColumnOpen ? "chevron-up" : "chevron-down"}
									size={18}
									color={colors.textDim}
								/>
							</Pressable>
							{mobileColumnOpen ? (
								<View style={styles.mobileStatisticsChoices}>
									{[
										{ id: "total", label: "Все операции" },
										...statistics.operation_types
									].map((type) => (
										<Pressable
											key={type.id}
											onPress={() => {
												setMobileColumn(type.id);
												setMobileColumnOpen(false);
											}}
											style={[
												styles.mobileStatisticsChoice,
												mobileColumn === type.id && styles.mobileStatisticsChoiceActive
											]}
										>
											<Text
												style={[
													styles.mobileStatisticsChoiceText,
													mobileColumn === type.id && styles.mobileStatisticsChoiceTextActive
												]}
											>
												{type.label}
											</Text>
										</Pressable>
									))}
								</View>
							) : null}
						</View>
						<View style={styles.mobileStatisticsTable}>
							<View style={styles.mobileStatisticsTableHeader}>
								<Text style={styles.mobileStatisticsHeaderName}>Хирург</Text>
								<Text style={styles.mobileStatisticsHeaderValue}>{mobileColumnLabel}</Text>
							</View>
							{statistics.surgeons.slice(0, 4).map((row) => (
								<View key={row.surgeon} style={styles.mobileStatisticsTableRow}>
									<Text numberOfLines={1} style={styles.mobileStatisticsSurgeon}>{row.surgeon}</Text>
									<Text style={styles.mobileStatisticsValue}>
										{mobileColumn === "total" ? row.total : row.counts[mobileColumn] ?? 0}
									</Text>
								</View>
							))}
							<View style={[styles.mobileStatisticsTableRow, styles.mobileStatisticsSummary]}>
								<Text style={styles.mobileStatisticsSummaryLabel}>Итого операций</Text>
								<Text style={styles.mobileStatisticsSummaryValue}>{mobileColumnTotal}</Text>
							</View>
						</View>
					</ScrollView>
				) : null}
			</View>
		);
	}

  return (
    <View style={styles.statisticsScreen}>
      <ScrollView
        style={styles.statisticsPageScroll}
        contentContainerStyle={styles.statisticsPageContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.compactScreenToolbar}>
        <View style={styles.compactScreenHeading}>
          <Text style={styles.compactScreenTitle}>Статистика операций</Text>
          <Text style={styles.compactScreenMeta}>
            Хирурги — текущий год; архив — по всем импортированным годам
          </Text>
        </View>
        <IconButton icon="refresh-outline" label="Обновить статистику" onPress={onRetry} />
      </View>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading && !statistics ? (
        <LoadingState label="Считаем выполненные операции…" />
      ) : statistics ? (
        <View style={styles.statisticsWorkspace}>
          <View style={styles.statisticsTablesPane}>
          <View style={styles.statisticsTableCard}>
            <View style={styles.statisticsCardHeading}>
              <View style={styles.statisticsCardTitleRow}>
                <View style={styles.statisticsCardIcon}><Icon name="people-outline" size={17} color={colors.primary} /></View>
                <Text style={styles.statisticsCardTitle}>Хирурги · {new Date().getFullYear()}</Text>
              </View>
              <Text style={styles.compactScreenMeta}>Только операции текущего года</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.statisticsHorizontalScroll}>
              <View>
                <View style={styles.statisticsTableHeader}>
                  <Text style={[styles.statisticsHeaderCell, styles.statisticsSurgeonCell]}>Хирург</Text>
                  {statistics.operation_types.map((type) => (
                    <Text key={type.id} numberOfLines={1} style={styles.statisticsHeaderCell}>{type.label}</Text>
                  ))}
                  <Text style={[styles.statisticsHeaderCell, styles.statisticsTotalHeader]}>Всего</Text>
                </View>
                <View>
                  {statistics.surgeons.map((row, index) => (
                    <View key={row.surgeon} style={[styles.statisticsTableRow, index % 2 === 1 && styles.statisticsTableRowAlt]}>
                      <Text numberOfLines={1} style={[styles.statisticsCell, styles.statisticsSurgeonCell]}>{row.surgeon}</Text>
                      {statistics.operation_types.map((type) => (
                        <Text key={type.id} style={styles.statisticsCell}>{row.counts[type.id] ?? 0}</Text>
                      ))}
                      <Text style={[styles.statisticsCell, styles.statisticsTotalCell]}>{row.total}</Text>
                    </View>
                  ))}
                </View>
                <View style={[styles.statisticsTableRow, styles.statisticsSummaryRow]}>
                  <Text style={[styles.statisticsCell, styles.statisticsSurgeonCell]}>Всего</Text>
                  {statistics.operation_types.map((type) => (
                    <Text key={type.id} style={styles.statisticsCell}>{type.total}</Text>
                  ))}
                  <Text style={[styles.statisticsCell, styles.statisticsTotalCell]}>
					{statistics.surgeons.reduce((sum, row) => sum + row.total, 0)}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
          <View style={styles.historicalStatisticsCard}>
            <View style={styles.statisticsCardHeading}>
              <View style={styles.statisticsCardTitleRow}>
                <View style={styles.statisticsCardIcon}><Icon name="analytics-outline" size={17} color={colors.primary} /></View>
                <Text style={styles.statisticsCardTitle}>Операции по годам</Text>
              </View>
              <Text style={styles.compactScreenMeta}>
                {historicalStatistics?.schema_version === 2 && historicalStatistics.years.length
                  ? `${historicalStatistics.start_year}–${historicalStatistics.end_year}`
                  : "Архив ещё не импортирован"}
              </Text>
            </View>
            {historicalStatistics?.schema_version === 2 && historicalStatistics.years.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View>
                  <View style={styles.historyTableRow}>
                    <Text style={[styles.historyHeaderCell, styles.historyYearCell]}>ГОД</Text>
                    {historicalStatistics.operation_types.map((type) => (
                      <Text key={type} numberOfLines={1} style={styles.historyHeaderCell}>{type}</Text>
                    ))}
                    <Text style={styles.historyHeaderCell}>ВСЕГО</Text>
                  </View>
                  <View>
                    {historicalStatistics.years.map((row, index) => (
                      <View key={row.year} style={[styles.historyTableRow, index % 2 === 1 && styles.historyTableRowAlt]}>
                        <Text style={[styles.historyCell, styles.historyYearCell]}>{row.year}</Text>
                        {historicalStatistics.operation_types.map((type) => (
                          <Text key={type} style={styles.historyCell}>{row.counts[type] ?? 0}</Text>
                        ))}
                        <Text style={[styles.historyCell, styles.historyTotalCell]}>{row.total}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.historyEmpty}>
                <Icon name="analytics-outline" color={colors.textDim} />
                <Text style={styles.compactScreenMeta}>Запустите скрипт импорта архива на больничном компьютере.</Text>
              </View>
            )}
          </View>
          </View>
        </View>
      ) : null}
      </ScrollView>
    </View>
  );
}

function LogsScreen({
  requests,
  onDelete
}: {
  requests: UserRequest[];
  onDelete: (request: UserRequest) => void;
}) {
  return (
    <View style={styles.logsScreen}>
      <View style={styles.compactScreenToolbar}>
        <View style={styles.compactScreenHeading}>
          <Text style={styles.compactScreenTitle}>Ошибки агента</Text>
          <Text style={styles.compactScreenMeta}>
            Подробности неудачно завершившихся запросов
          </Text>
        </View>
      </View>
      <ScrollView
        style={styles.flexScroll}
        contentContainerStyle={styles.logsContent}
        showsVerticalScrollIndicator={false}
      >
        {requests.length ? requests.map((request) => {
          const payload = parseObject(request.payload);
          const logText = request.errors ||
            String(parseObject(request.result).error ?? "Агент завершил запрос с ошибкой");
          return (
            <View key={request.id} style={styles.logCard}>
              <View style={styles.logHeader}>
                <View style={styles.logHeaderCopy}>
                  <Text style={styles.logCommand}>
                    {commandLabels[request.command] ?? request.command}
                  </Text>
                  <Text style={styles.logMeta}>
                    {formatDate(request.updated_at, true)} · Агент {request.agent_id}
                  </Text>
                </View>
                <IconButton
                  icon="trash-outline"
                  label="Удалить запись лога"
                  onPress={() => onDelete(request)}
                />
              </View>
              <Text style={styles.logPayloadLabel}>ЗАПРОС</Text>
              <View style={styles.logPayloadBox}>
                <Text selectable style={styles.logCode}>
                  {JSON.stringify(payload, null, 2)}
                </Text>
              </View>
              <Text style={styles.logPayloadLabel}>ЛОГ ОШИБКИ</Text>
              <View style={styles.logErrorBox}>
                <Text selectable style={styles.logCode}>{logText}</Text>
              </View>
            </View>
          );
        }) : (
          <EmptyState
            icon="checkmark-circle-outline"
            title="Ошибок агента нет"
            description="Здесь появятся только запросы, завершившиеся ошибкой."
          />
        )}
      </ScrollView>
    </View>
  );
}

function ReportRow({
  report,
  selected,
  compact,
  onPress,
  onDelete,
  onForward
}: {
  report: ReportDocument;
  selected: boolean;
  compact: boolean;
  onPress: () => void;
  onDelete: () => void;
  onForward: () => void;
}) {
  const data = reportData(report);
  const total = Number(data.emergency_total ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть отчёт за ${data.date ?? "дату"}`}
      onPress={onPress}
      style={[styles.reportRow, selected && styles.reportRowSelected]}
    >
      <View style={styles.reportDateBlock}>
        <Icon name="calendar-outline" size={18} color={colors.primary} />
      </View>
      <View style={styles.reportRowCopy}>
        <Text style={styles.reportRowDate}>
          {data.date ?? formatDate(report.generated_at)}
        </Text>
        <Text style={styles.reportRowMeta}>
          {data.period_days ?? 1} сут. · {total} экстренных операций
        </Text>
      </View>
      {compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Удалить отчёт"
          onPress={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          style={styles.reportTrashButton}
        >
          <Icon name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      ) : (
        <View style={styles.reportRowActions}>
          <IconButton icon="share-outline" label="Переслать отчёт" onPress={onForward} />
          <IconButton icon="trash-outline" label="Удалить отчёт" onPress={onDelete} />
        </View>
      )}
    </Pressable>
  );
}

function ReportDetail({ report }: { report: ReportDocument }) {
  const data = reportData(report);
  const [section, setSection] = useState<"emergency" | "planned" | "today">(
    "emergency"
  );
  return (
    <View style={styles.reportDocument}>
      <View style={styles.reportDocumentHeader}>
        <View>
          <Text style={styles.reportDocumentEyebrow}>ОТЧЁТ ДЕЖУРСТВА</Text>
          <Text style={styles.reportDocumentTitle}>
            {data.date ?? "Дата не указана"}
          </Text>
          <Text style={styles.reportDocumentPeriod}>
            {data.period_start ?? "—"} — {data.period_end ?? "—"}
          </Text>
        </View>
      </View>
      <View style={styles.reportStats}>
        <ReportStat label="Экстренные" value={data.emergency_total ?? 0}
          active={section === "emergency"} onPress={() => setSection("emergency")} />
        <ReportStat label="Плановые" value={data.planned_count ?? 0}
          active={section === "planned"} onPress={() => setSection("planned")} />
        <ReportStat
          label="План сегодня"
          value={data.today_planned_count ?? 0}
          active={section === "today"}
          onPress={() => setSection("today")}
        />
      </View>
      {section === "emergency" ? <ReportSection title="Экстренные операции"
        operations={data.emergency_operations ?? []} /> : null}
      {section === "planned" ? <ReportSection title="Плановые операции"
        operations={data.planned_operations ?? []} /> : null}
      {section === "today" ? <ReportSection title="План сегодня"
        operations={data.today_planned_operations ?? []} /> : null}
    </View>
  );
}

function ReportStat({
  label, value, active, onPress
}: { label: string; value: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}
      style={[styles.reportStat, active && styles.reportStatActive]}>
      <Text style={styles.reportStatValue}>{value}</Text>
      <Text style={styles.reportStatLabel}>{label}</Text>
    </Pressable>
  );
}

function ReportSection({
  title,
  operations
}: {
  title: string;
  operations: ReportOperation[];
}) {
  if (!operations.length) return null;
  const category = (operation: ReportOperation) => {
    const value = `${operation.operation ?? ""}`.toLocaleLowerCase("ru").replace(/ё/g, "е");
    if (/(тромбэкстрак|тромбаспир|\bта\b)/.test(value)) return "Тромбэкстракции";
    if (/(аневризм|эмболизац.*аневр)/.test(value)) return "Аневризма";
    if (/каг/.test(value) && /стент/.test(value)) return "КАГ + стент";
    if (/каг|коронарограф/.test(value)) return "КАГ";
    if (/цаг|церебральн.*ангиограф/.test(value)) return "ЦАГ";
    return "Другие";
  };
  const groups = ["КАГ", "КАГ + стент", "ЦАГ", "Тромбэкстракции", "Аневризма", "Другие"]
    .map((label) => ({ label, operations: operations.filter((operation) => category(operation) === label) }))
    .filter((group) => group.operations.length);
  let absoluteIndex = 0;
  return (
    <View style={styles.reportSection}>
      <Text style={styles.reportSectionTitle}>
        {title} · {operations.length}
      </Text>
      <View style={styles.operationTable}>
        {groups.map((group) => (
          <View key={group.label}>
            <View style={styles.reportOperationGroupHeader}>
              <Text style={styles.reportOperationGroupTitle}>{group.label}</Text>
              <Text style={styles.reportOperationGroupCount}>{group.operations.length}</Text>
            </View>
            {group.operations.map((operation) => {
              const index = absoluteIndex++;
              return <View key={`${operation.patient}-${index}`} style={styles.operationRow}>
            <Text style={styles.operationNumber}>
              {String(index + 1).padStart(2, "0")}
            </Text>
            <View style={styles.operationCopy}>
              <View style={styles.operationTitleLine}>
                <Text style={styles.operationPatient}>
                  {operation.patient || "ФИО не указано"}
                  {operation.age ? (
                    <Text style={styles.operationAge}> {operation.age}</Text>
                  ) : null}
                </Text>
                <Text numberOfLines={1} style={styles.operationDepartment}>
                  {operation.department || "—"}
                </Text>
              </View>
              <View style={styles.operationSummaryLine}>
                <Text numberOfLines={1} style={styles.operationName}>
                  {shortOperationName(operation.operation || "Операция не указана")}
                </Text>
                <Text style={styles.operationTime}>
                  {operation.time_beginning || "—"}
                </Text>
              </View>
            </View>
          </View>;
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const monthKey = (offset = 0) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthTitle = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T12:00:00`)
  );

const daysInMonth = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(year!, value!, 0).getDate();
};

function DutyScheduleScreen({
  compact,
  schedule,
  loading,
  error,
  onRetry,
  onSave
}: {
  compact: boolean;
  schedule: DutySchedule | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSave: (schedule: DutySchedule) => Promise<void>;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [current, setCurrent] = useState<DutySchedule | null>(schedule);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [holidayText, setHolidayText] = useState("");
  const [shiftTool, setShiftTool] = useState("6");
  const timelineRef = useRef<ScrollView>(null);
  const selectedMonth = monthKey(monthOffset);
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentDay = selectedMonth === currentMonthKey ? today.getDate() : null;

  useEffect(() => {
    if (monthOffset === 0 && schedule) setCurrent(schedule);
  }, [monthOffset, schedule]);

  useEffect(() => {
    setHolidayText(current?.holidays.join(", ") ?? "");
  }, [current?.holidays, current?.month]);

  useEffect(() => {
    let cancelled = false;
    if (monthOffset === 0 && schedule?.month === selectedMonth) return;
    void getDutySchedule(selectedMonth).then((value) => {
      if (!cancelled) setCurrent(value);
    }).catch(() => {
      if (!cancelled) setCurrent(null);
    });
    return () => { cancelled = true; };
  }, [monthOffset, schedule, selectedMonth]);

  useEffect(() => {
    if (!compact || !currentDay) return;
    const timer = setTimeout(() => {
      timelineRef.current?.scrollTo({ x: Math.max(0, (currentDay - 1) * 42 - 42), animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, [compact, currentDay, current?.month]);

  const activeGroup = current?.groups.find((group) => group.id === "surgeons")
    ?? current?.groups[0];
  const days = Array.from({ length: daysInMonth(selectedMonth) }, (_, index) => index + 1);
  const workingDays = days.filter((day) => {
    const date = new Date(`${selectedMonth}-${String(day).padStart(2, "0")}T12:00:00`);
    return date.getDay() !== 0 && date.getDay() !== 6 && !current?.holidays.includes(day);
  });
  const monthlyNorm = workingDays.length * 6;
  const shiftKey = (day: number, row: "day" | "duty") => `${day}:${row}`;
  const shiftValue = (staff: DutySchedule["groups"][number]["staff"][number], day: number, row: "day" | "duty") =>
    staff.shifts[shiftKey(day, row)] ?? (row === "day" ? staff.shifts[String(day)] ?? "" : "");
  const rowTotal = (staff: DutySchedule["groups"][number]["staff"][number], row: "day" | "duty") =>
    days.reduce((sum, day) => sum + (Number(shiftValue(staff, day, row)) || 0), 0);

  const changeShift = (staffID: string, day: number, row: "day" | "duty") => {
    if (!current || !editing) return;
    setCurrent({
      ...current,
      groups: current.groups.map((group) => ({
        ...group,
        staff: group.staff.map((staff) => {
          if (staff.id !== staffID) return staff;
          const shifts = { ...staff.shifts };
          const key = shiftKey(day, row);
          if (shifts[key] === shiftTool) delete shifts[key];
          else shifts[key] = shiftTool;
          delete shifts[String(day)];
          return { ...staff, shifts };
        })
      }))
    });
  };

  const applyHolidays = () => {
    if (!current) return;
    const holidays = holidayText.split(/[\s,;]+/).map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= days.length);
    setCurrent({ ...current, holidays: [...new Set(holidays)].sort((a, b) => a - b) });
  };

  const save = async () => {
    if (!current) return;
    setSaving(true);
    try {
      await onSave(current);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const printSchedule = () => {
    if (Platform.OS !== "web" || !current || !activeGroup) return;
    const printWindow = window.open("", "_blank", "width=1200,height=820");
    if (!printWindow) return;
    const header = days.map((day) => `<th>${day}</th>`).join("");
    const rows = activeGroup.staff.flatMap((staff) => (["day", "duty"] as const).map((row, index) => {
      const cells = days.map((day) => `<td>${escapePrintHTML(shiftValue(staff, day, row))}</td>`).join("");
      return `<tr${index === 1 ? ' class="staff-end"' : ""}>${index === 0 ? `<td rowspan="2" class="staff">${escapePrintHTML(staff.name)}</td>` : ""}${cells}</tr>`;
    })).join("");
    printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>График</title><style>@page{size:A4 landscape;margin:7mm}body{font-family:Arial,sans-serif;color:#18313f}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 10px;color:#607482}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #9eabb3;text-align:center;padding:3px;font-size:8px;height:18px}th:first-child{width:108px}.staff{font-weight:700;text-align:left;padding-left:6px}.staff-end td{border-bottom-width:2px;border-bottom-color:#6f9db2}</style></head><body><h1>График хирургов</h1><p>${escapePrintHTML(monthTitle(selectedMonth))}</p><table><thead><tr><th>Хирург</th>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
    printWindow.document.close();
    printWindow.addEventListener("load", () => printWindow.print(), { once: true });
  };

  return (
    <View style={[styles.scheduleScreen, compact && styles.screenCompact]}>
      <View style={styles.scheduleToolbar}>
        <View>
          <Text style={styles.compactScreenTitle}>График смен</Text>
          <Text style={styles.compactScreenMeta}>{monthTitle(selectedMonth)}</Text>
        </View>
        <View style={styles.scheduleMonthButtons}>
          <Button label="Текущий" compact variant={monthOffset === 0 ? "primary" : "ghost"} onPress={() => { setMonthOffset(0); setEditing(false); }} />
          <Button label="Следующий" compact variant={monthOffset === 1 ? "primary" : "ghost"} onPress={() => { setMonthOffset(1); setEditing(false); }} />
          {!compact ? <Button label="Распечатать" compact icon="print-outline" variant="ghost" onPress={printSchedule} /> : null}
        </View>
      </View>
      {error && monthOffset === 0 ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading && !current ? <LoadingState label="Открываем график…" /> : null}
      {current ? (
        <ScrollView style={styles.schedulePage} contentContainerStyle={styles.schedulePageContent}>
          {!compact && !editing ? (
            <View style={styles.scheduleViewActions}>
              <Button label="Заполнить график" icon="create-outline" onPress={() => setEditing(true)} />
            </View>
          ) : null}
          {editing && !compact ? (
            <View style={styles.scheduleEditorPanel}>
              <View style={styles.scheduleEditorTopRow}>
                <View style={styles.scheduleHolidayTools}>
                  <Field label="Праздничные дни" value={holidayText} onChangeText={setHolidayText} placeholder="1, 9, 12" hint="Числа месяца через запятую." />
                  <Button label="Применить" compact variant="secondary" onPress={applyHolidays} />
                </View>
                <View style={styles.scheduleEditorActions}>
                  <View style={styles.scheduleNormBadge}>
                    <Text style={styles.scheduleNormLabel}>Норма месяца</Text>
                    <Text style={styles.scheduleNorm}>{monthlyNorm} ч</Text>
                  </View>
                  <Button label="Внести изменения" icon="checkmark" loading={saving} onPress={() => void save()} />
                </View>
              </View>
              <View style={styles.scheduleShiftTools}>
                <Text style={styles.scheduleToolsTitle}>Значение для ячейки</Text>
                <View style={styles.scheduleToolChips}>
                  {["6", "18", "24", "О", "Б"].map((value) => <Chip key={value} label={value} selected={shiftTool === value} onPress={() => setShiftTool(value)} />)}
                </View>
                <View style={styles.scheduleLegend}>
                  <Text style={styles.scheduleLegendItem}><Text style={styles.scheduleLegendValue}>6</Text> — дневные часы</Text>
                  <Text style={styles.scheduleLegendItem}><Text style={styles.scheduleLegendValue}>18</Text> — ночное дежурство</Text>
                  <Text style={styles.scheduleLegendItem}><Text style={styles.scheduleLegendValue}>24</Text> — суточное дежурство</Text>
                  <Text style={styles.scheduleLegendItem}><Text style={styles.scheduleLegendValue}>О</Text> — отпуск</Text>
                  <Text style={styles.scheduleLegendItem}><Text style={styles.scheduleLegendValue}>Б</Text> — больничный</Text>
                </View>
              </View>
            </View>
          ) : null}
          <View style={styles.scheduleGridShell}>
            <View style={[styles.scheduleNamesColumn, compact && styles.scheduleNamesColumnCompact]}>
              <View testID="schedule-name-header" style={[styles.scheduleCell, styles.scheduleNameHeader]}>
                <Text style={styles.scheduleNameHeaderText}>Хирург</Text>
              </View>
              {activeGroup?.staff.map((staff) => (
                <View key={staff.id} testID={`schedule-name-${staff.id}`} style={styles.scheduleStaffBlock}>
                  <Text numberOfLines={2} style={styles.scheduleStaffName}>{staff.name}</Text>
                </View>
              ))}
            </View>
            <ScrollView ref={timelineRef} horizontal showsHorizontalScrollIndicator style={styles.scheduleTimelineScroll} contentContainerStyle={styles.scheduleTimelineContent}>
              <View style={styles.scheduleTimelineGrid}>
                <View testID="schedule-days-header" style={styles.scheduleGridRow}>
                {days.map((day) => {
                  const date = new Date(`${selectedMonth}-${String(day).padStart(2, "0")}T12:00:00`);
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  const holiday = current.holidays.includes(day);
                  return <Text key={day} style={[styles.scheduleCell, styles.scheduleDayHeader, (weekend || holiday) && styles.scheduleHolidayCell, day === currentDay && styles.scheduleTodayCell]}>{day}</Text>;
                })}
                {editing && !compact ? <Text style={[styles.scheduleCell, styles.scheduleTotalHeader]}>Σ</Text> : null}
              </View>
              {activeGroup?.staff.length ? activeGroup.staff.flatMap((staff) => (["day", "duty"] as const).map((row, rowIndex) => {
                const total = rowTotal(staff, row);
                return <View key={`${staff.id}-${row}`} testID={`schedule-row-${staff.id}-${row}`} style={styles.scheduleGridRow}>
                  {days.map((day) => {
                    const date = new Date(`${selectedMonth}-${String(day).padStart(2, "0")}T12:00:00`);
                    const marked = date.getDay() === 0 || date.getDay() === 6 || current.holidays.includes(day);
                    return <Pressable key={day} onPress={() => changeShift(staff.id, day, row)} style={[styles.scheduleCell, styles.scheduleShiftCell, marked && styles.scheduleHolidayCell, day === currentDay && styles.scheduleTodayCell, rowIndex === 1 && styles.scheduleSurgeonEndCell]}>
                    <Text style={[styles.scheduleShiftText, day === currentDay && styles.scheduleTodayText]}>{shiftValue(staff, day, row)}</Text>
                    </Pressable>;
                  })}
                  {editing && !compact ? <View style={[styles.scheduleCell, styles.scheduleTotalCell, total >= monthlyNorm && styles.scheduleTotalReached, rowIndex === 1 && styles.scheduleSurgeonEndCell]}><Text style={styles.scheduleShiftText}>{total}</Text></View> : null}
                </View>;
              })) : (
                <View style={styles.scheduleEmptyGroup}><Text style={styles.compactScreenMeta}>Список сотрудников будет заполнен при создании графика.</Text></View>
              )}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const planDepartments = [
  "кардио 1",
  "кардио 2",
  "рсц",
  "неврология",
  "нейро/х",
  "сосуды",
  "гинек",
  "урология",
  "гной хир"
] as const;

const defaultPlanOperations: Record<string, string> = {
  "кардио 1": "каг стент",
  "кардио 2": "каг стент",
  рсц: "цаг",
  неврология: "цаг",
  "нейро/х": "цаг",
  сосуды: "ангио вса",
  гинек: "эма",
  урология: "эмб простаты",
  "гной хир": "бап голени"
};

const vascularOperations = [
  "каг",
  "гибрид",
  "ангио вса",
  "стент вса",
  "ангио в/к",
  "ангио н/к",
  "ангио опа/нпа",
  "стент опа/нпа",
  "бап голень"
];

const planOperationsFor = (department: string): string[] => {
  if (department.startsWith("кардио")) {
    return ["каг стент", "каг диагностика", "ЭКС"];
  }
  if (department === "сосуды") return vascularOperations;
  return [defaultPlanOperations[department] ?? ""];
};

const newPlanEntry = (): PlanEntry => ({
  patient: "",
  department: "кардио 2",
  operation: defaultPlanOperations["кардио 2"]!,
  additions: ""
});

const planDepartmentRank = (department: string) => {
  if (department.startsWith("кардио")) return 0;
  if (department === "сосуды") return 1;
  if (["рсц", "неврология", "нейро/х"].includes(department)) return 2;
  return 3;
};

const sortPlanEntries = (entries: PlanEntry[]) =>
  [...entries].sort((left, right) => {
    const operation = left.operation.localeCompare(right.operation, "ru");
    if (operation) return operation;
    const group = planDepartmentRank(left.department) - planDepartmentRank(right.department);
    if (group) return group;
    const department = left.department.localeCompare(right.department, "ru");
    if (department) return department;
    return left.patient.localeCompare(right.patient, "ru");
  });

const shortPlanDepartment = (department: string) => {
  const value = department.toLocaleLowerCase("ru");
  if (value.startsWith("кардио")) return "к/о";
  if (value === "нейро/х") return "н/х";
  if (value === "сосуды") return "с/х";
  if (value.startsWith("гинек")) return "г/о";
  if (value === "неврология") return "н/о";
  if (value.includes("хир")) return "х/о";
  return department;
};

const weekdayTitle = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "2-digit" })
    .format(new Date(`${date}T12:00:00`))
    .replace(".", "");

const formatShortNumericDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(date);
};

async function sharePlanSnapshot(
  plan: OperationPlan,
  target: "MAX" | "Telegram" | "SMS"
): Promise<void> {
  const text = plan.days
    .flatMap((day) =>
      sortPlanEntries(day.entries).map(
        (entry, index) =>
          `${weekdayTitle(day.date)} · ${index + 1}. ${entry.patient}: ` +
          `${entry.department}, ${entry.operation}` +
          (entry.additions ? ` · ${entry.additions}` : "")
      )
    )
    .join("\n");
  if (Platform.OS !== "web") {
    await Share.share({ title: "План операций", message: text || "План пуст" });
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1500;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось создать снимок плана");
  context.fillStyle = "#F3F6F8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#10212E";
  context.font = "700 48px -apple-system, sans-serif";
  context.fillText("План операций", 70, 90);
  context.font = "400 28px -apple-system, sans-serif";
  context.fillStyle = "#607482";
  context.fillText(`Неделя с ${formatDate(plan.week_start)}`, 70, 135);
  let y = 205;
  plan.days.forEach((day) => {
    context.fillStyle = "#DCEAF0";
    context.fillRect(55, y - 38, 1090, 58);
    context.fillStyle = "#0B84B3";
    context.font = "700 27px -apple-system, sans-serif";
    context.fillText(weekdayTitle(day.date).toLocaleUpperCase("ru"), 75, y);
    y += 58;
    const entries = day.entries.length ? sortPlanEntries(day.entries) : [null];
    entries.forEach((entry, index) => {
      context.fillStyle = "#10212E";
      context.font = "700 30px -apple-system, sans-serif";
      context.fillText(entry ? `${index + 1}. ${entry.patient}` : "—", 75, y);
      context.font = "400 25px -apple-system, sans-serif";
      context.fillStyle = "#607482";
      context.fillText(
        entry
          ? `${entry.department} · ${entry.operation}` +
            (entry.additions ? ` · ${entry.additions}` : "")
          : "Операций нет",
        75,
        y + 35
      );
      y += 88;
    });
    y += 12;
  });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Снимок не создан"))),
      "image/png"
    )
  );
  const file = new File([blob], "plan.png", { type: "image/png" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({
      title: `План операций — ${target}`,
      text: text || "План операций",
      files: [file]
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "plan.png";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  if (target === "Telegram") {
    window.open(
      `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  } else if (target === "SMS") {
    window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
  } else {
    window.open(
      `https://max.ru/:share?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }
}

function escapePrintHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printOperationPlan(plan: OperationPlan, selectedDate?: string) {
  if (Platform.OS !== "web") return;
  const printWindow = window.open("", "_blank", "width=1180,height=820");
  if (!printWindow) throw new Error("Браузер заблокировал окно печати");
  printWindow.opener = null;
	const printedDays = selectedDate ? plan.days.filter((day) => day.date === selectedDate) : plan.days;
  const rows = printedDays.flatMap((day) => {
    const entries = day.entries.length ? sortPlanEntries(day.entries) : [null];
    return entries.map(
      (entry, index) => `<tr>
        ${index === 0 ? `<td rowspan="${entries.length}" class="day">${escapePrintHTML(weekdayTitle(day.date))}</td>` : ""}
        <td>${escapePrintHTML(entry ? `${index + 1}. ${entry.patient}` : "—")}</td>
        <td>${escapePrintHTML(entry?.department || "—")}</td>
        <td>${escapePrintHTML(entry?.operation || "—")}</td>
        <td>${escapePrintHTML(entry?.additions || "—")}</td>
        <td>${escapePrintHTML(entry?.previous_operations?.length
			? entry.previous_operations.map((study) => formatShortNumericDate(study.time_beginning)).join("; ")
			: "Первичная")}</td>
      </tr>`
    );
  }).join("");
  printWindow.addEventListener("load", () => printWindow.print(), { once: true });
  printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <title>План операций</title><style>
		@page { size: A4 portrait; margin: 10mm; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17232d; }
      h1 { margin: 0 0 4px; font-size: 24px; }
      p { margin: 0 0 18px; color: #536776; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th { background: #eaf1f5; color: #536776; font-size: 10px; text-transform: uppercase; }
		th, td { border: 1px solid #d4dfe6; padding: 5px; vertical-align: top; font-size: 9px; }
      th:first-child { width: 8%; } th:nth-child(2) { width: 18%; }
      th:nth-child(3) { width: 12%; } th:nth-child(4) { width: 19%; }
      th:nth-child(5) { width: 18%; } th:nth-child(6) { width: 25%; }
      .day { color: #086f98; font-weight: 800; background: #f3f6f8; text-transform: capitalize; }
    </style></head><body><h1>План операций</h1>
	<p>${selectedDate ? escapePrintHTML(formatDate(selectedDate)) : `Неделя с ${escapePrintHTML(formatDate(plan.week_start))}`}</p>
    <table><thead><tr><th>День</th><th>Пациент</th><th>Отделение</th><th>Операция</th><th>Дополнения</th><th>Предыдущая операция</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`);
  printWindow.document.close();
}

function PlanScreen({
  compact,
  plan,
  loading,
  error,
  weekOffset,
  onWeekChange,
  onRetry,
  onSave
}: {
  compact: boolean;
  plan: OperationPlan | null;
  loading: boolean;
  error: string;
  weekOffset: 0 | 1;
  onWeekChange: (weekOffset: 0 | 1) => void;
  onRetry: () => void;
  onSave: (date: string, entries: PlanEntry[]) => Promise<void>;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanEntry[]>([newPlanEntry()]);
  const [picker, setPicker] = useState<{
    index: number;
    type: "department" | "operation" | "additional-operation";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
	const [printOpen, setPrintOpen] = useState(false);
  const [previousProtocol, setPreviousProtocol] = useState<Study | null>(null);
  const planEditorScrollRef = useRef<ScrollView>(null);

  const openDay = (date: string) => {
    const entries = plan?.days.find((day) => day.date === date)?.entries ?? [];
    const existingEntries = sortPlanEntries(entries).map((entry) => ({
      ...entry,
      additions: entry.additions || ""
    }));
    setDraft(
      compact
        ? [newPlanEntry(), ...existingEntries]
        : existingEntries.length
          ? existingEntries
          : [newPlanEntry()]
    );
    setSelectedDate(date);
    setPicker(null);
    setSaveError("");
  };

  const updateEntry = (index: number, patch: Partial<PlanEntry>) =>
    setDraft((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry
      )
    );

  const addPlanEntry = () => {
    setDraft((current) =>
      compact ? [newPlanEntry(), ...current] : [...current, newPlanEntry()]
    );
    if (compact) {
      requestAnimationFrame(() =>
        planEditorScrollRef.current?.scrollTo({ y: 0, animated: true })
      );
    }
  };

  const saveDay = async () => {
    if (!selectedDate) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(
        selectedDate,
        sortPlanEntries(draft
          .map((entry) => ({ ...entry, patient: entry.patient.trim() }))
          .filter((entry) => entry.patient))
      );
      setSelectedDate(null);
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View style={styles.planToolbar}>
        <View style={styles.compactScreenHeading}>
          <Text style={styles.compactScreenTitle}>План операций</Text>
          <Text style={styles.compactScreenMeta}>
            Нажмите строку дня для заполнения
          </Text>
        </View>
        <View style={styles.planToolbarActions}>
          <IconButton
            icon={compact ? "share-outline" : "print-outline"}
            label={compact ? "Отправить снимок" : "Распечатать план"}
            onPress={() => {
              if (!plan) return;
              if (compact) {
                setShareOpen(true);
                return;
              }
              try {
				setPrintOpen(true);
              } catch (reason) {
                Alert.alert("Не удалось распечатать", errorMessage(reason));
              }
            }}
          />
        </View>
      </View>
      <View style={styles.planWeekSelector}>
        {([0, 1] as const).map((offset) => (
          <Pressable
            key={offset}
            accessibilityRole="button"
            accessibilityState={{ selected: weekOffset === offset }}
            onPress={() => onWeekChange(offset)}
            style={[
              styles.planWeekOption,
              weekOffset === offset && styles.planWeekOptionActive
            ]}
          >
            <Text
              style={[
                styles.planWeekOptionText,
                weekOffset === offset && styles.planWeekOptionTextActive
              ]}
            >
              {offset === 0 ? "Текущая неделя" : "Следующая неделя"}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading && !plan ? (
        <LoadingState label="Загружаем план…" />
      ) : plan ? (
        <View style={styles.planTable}>
          <View style={[styles.planTableRow, styles.planTableHeader]}>
			<Text style={[styles.planTableHeaderText, styles.planStatusCell]}>✓</Text>
            <Text style={[styles.planTableHeaderText, compact && styles.planTableHeaderTextCompact, styles.planDayCell, compact && styles.planDayCellCompact]}>День</Text>
            <Text style={[styles.planTableHeaderText, compact && styles.planTableHeaderTextCompact, styles.planPatientCell, compact && styles.planPatientCellCompact]}>Пациент</Text>
            <Text style={[styles.planTableHeaderText, compact && styles.planTableHeaderTextCompact, styles.planDepartmentCell, compact && styles.planDepartmentCellCompact]}>{compact ? "Отд." : "Отделение"}</Text>
            <Text style={[styles.planTableHeaderText, compact && styles.planTableHeaderTextCompact, styles.planOperationCell, compact && styles.planOperationCellCompact]}>{compact ? "Опер." : "Операция"}</Text>
            {!compact ? (
              <Text style={[styles.planTableHeaderText, styles.planAdditionsCell]}>Дополнения</Text>
            ) : null}
            <Text style={[styles.planTableHeaderText, compact && styles.planTableHeaderTextCompact, styles.planPreviousCell, compact && styles.planPreviousCellCompact]}>{compact ? "Ист" : "Предыдущие операции"}</Text>
          </View>
          <ScrollView
            style={styles.planTableBody}
            showsVerticalScrollIndicator={false}
          >
          {plan.days.map((day, dayIndex) => (
              <Pressable
                key={day.date}
                accessibilityRole="button"
                accessibilityLabel={`Заполнить план на ${formatDate(day.date)}`}
                onPress={() => openDay(day.date)}
                style={({ pressed }) => [
                  styles.planTableDayRow,
                  dayIndex % 2 === 1 && styles.planTableDayRowAlternate,
                  pressed && styles.planTableRowPressed
                ]}
              >
                <Text style={[styles.planTableDayText, styles.planDayCell, compact && styles.planDayCellCompact]}>
                  {weekdayTitle(day.date)}
                </Text>
                <View style={[styles.planEntriesColumn, compact && styles.planEntriesColumnCompact]}>
                  {(day.entries.length ? sortPlanEntries(day.entries) : [null]).map(
                    (entry, index) => (
                      <View key={index} style={styles.planEntryRow}>
						<View style={styles.planStatusCell}>
							{entry?.completed_operation ? (
								<Pressable onPress={(event) => { event.stopPropagation?.(); setPreviousProtocol(entry.completed_operation ?? null); }}>
									<Icon name="checkmark-circle" color={colors.primary} size={18} />
								</Pressable>
							) : null}
						</View>
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit={compact}
                          minimumFontScale={0.72}
                          style={[styles.planTableText, styles.planPatientCell, compact && styles.planPatientCellCompact]}
                        >
                          {entry ? `${index + 1}. ${entry.patient}` : "—"}
                        </Text>
                        <Text style={[styles.planTableText, styles.planDepartmentCell, compact && styles.planDepartmentCellCompact]}>
                          {entry
                            ? compact
                              ? shortPlanDepartment(entry.department)
                              : entry.department
                            : "—"}
                        </Text>
                        <Text numberOfLines={2} style={[styles.planTableText, styles.planOperationCell, compact && styles.planOperationCellCompact]}>
                          {entry?.operation || "—"}
                        </Text>
                        {!compact ? (
                          <Text style={[styles.planTableText, styles.planAdditionsCell]}>
                            {entry?.additions || "—"}
                          </Text>
                        ) : null}
                        <View style={[styles.planPreviousCell, compact && styles.planPreviousCellCompact]}>
						  {entry?.previous_operations?.length ? (
							<View style={styles.planHistoryButtons}>
							  {entry.previous_operations.slice(0, 3).map((protocol) => (
								<Pressable key={protocol.id} onPress={(event) => { event.stopPropagation?.(); setPreviousProtocol(protocol); }} style={styles.planPreviousButton}>
								  <Text numberOfLines={1} style={styles.planPreviousButtonText}>{formatShortNumericDate(protocol.time_beginning)}</Text>
								</Pressable>
							  ))}
							</View>
                          ) : (
                            <Text style={styles.planPrimaryText}>
                              {entry
                                ? entry.history_searched === false
                                  ? (compact ? "—" : "Поиск не проведён")
                                  : (compact ? "перв" : "Первичная")
                                : "—"}
                            </Text>
                          )}
                        </View>
                      </View>
                    )
                  )}
                </View>
              </Pressable>
          ))}
          </ScrollView>
        </View>
      ) : null}

	  <Sheet visible={printOpen} title="Печать плана" onClose={() => setPrintOpen(false)}>
		<View style={styles.filterSheetContent}>
			<Button label="Вся неделя" icon="print-outline" onPress={() => { if (plan) printOperationPlan(plan); setPrintOpen(false); }} />
			{plan?.days.map((day) => (
				<Button key={day.date} label={`${weekdayTitle(day.date)} · ${formatDate(day.date)}`} variant="ghost" onPress={() => { printOperationPlan(plan, day.date); setPrintOpen(false); }} />
			))}
		</View>
	  </Sheet>

      <Sheet
        visible={Boolean(selectedDate)}
        title={selectedDate ? `План на ${formatDate(selectedDate)}` : "План дня"}
        onClose={() => setSelectedDate(null)}
        fullScreen={compact}
        extraWide={!compact}
      >
        <View style={styles.planEditorShell}>
        <ScrollView
          ref={planEditorScrollRef}
          style={styles.planEditorScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.planEditorContent,
            !compact && styles.planEditorContentDesktop
          ]}
        >
          {!compact ? (
            <View style={styles.planEditorColumns}>
              <View style={styles.planEditorHeaderDesktop} />
              <Text style={[styles.planFieldLabel, styles.planEditorPatientField]}>Пациент</Text>
              <Text style={[styles.planFieldLabel, styles.planEditorDepartmentField]}>Отделение</Text>
              <Text style={[styles.planFieldLabel, styles.planEditorOperationField]}>Операция</Text>
              <Text style={[styles.planFieldLabel, styles.planEditorAdditionsField]}>Дополнения</Text>
              <Text style={[styles.planFieldLabel, styles.planEditorHistoryField]}>Предыдущая</Text>
            </View>
          ) : null}
          {draft.map((entry, index) => (
            <Fragment key={index}>
            <View
              style={[styles.planEditorRow, !compact && styles.planEditorRowDesktop]}
            >
              <View style={[styles.planEditorHeader, !compact && styles.planEditorHeaderDesktop]}>
                <Text style={[styles.settingsTitle, !compact && styles.planEditorNumber]}>
                  {compact ? `Пациент ${index + 1}` : String(index + 1).padStart(2, "0")}
                </Text>
                {draft.length > 1 ? (
                  <IconButton
                    icon="trash-outline"
                    label="Удалить пациента"
                    onPress={() =>
                      setDraft((current) =>
                        current.filter((_item, itemIndex) => itemIndex !== index)
                      )
                    }
                  />
                ) : null}
              </View>
              <View style={[styles.planEditorField, !compact && styles.planEditorPatientField]}>
                {compact ? <Text style={styles.planFieldLabel}>Пациент</Text> : null}
                <TextInput
                  value={entry.patient}
                  onChangeText={(patient) => updateEntry(index, { patient })}
                  placeholder="Петров ИВ"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="words"
                  style={[styles.planPatientInput, !compact && styles.planDesktopControl]}
                />
                {compact ? (
                  <Text style={styles.planInputHint}>Фамилия и две инициалы без точек — для поиска истории.</Text>
                ) : null}
              </View>
              <View style={[styles.planEditorField, !compact && styles.planEditorDepartmentField]}>
                {compact ? <Text style={styles.planFieldLabel}>Отделение</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Выбрать отделение пациента ${index + 1}`}
                  onPress={() =>
                    setPicker(
                      picker?.index === index && picker.type === "department"
                        ? null
                        : { index, type: "department" }
                    )
                  }
                  style={[styles.planSelect, !compact && styles.planDesktopControl]}
                >
                  <Text style={styles.planSelectText}>{entry.department}</Text>
                  <Icon name="chevron-down" size={17} color={colors.textDim} />
                </Pressable>
                {picker?.index === index && picker.type === "department" ? (
                  <View style={styles.planOptions}>
                    {planDepartments.map((department) => (
                      <Pressable
                        key={department}
                        accessibilityRole="button"
                        accessibilityLabel={`Отделение ${department}`}
                        onPress={() => {
                          updateEntry(index, {
                            department,
                            operation: defaultPlanOperations[department]!
                          });
                          setPicker(null);
                        }}
                        style={styles.planOption}
                      >
                        <Text style={styles.planOptionText}>{department}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={[styles.planEditorField, !compact && styles.planEditorOperationField]}>
                {compact ? <Text style={styles.planFieldLabel}>Операция</Text> : null}
                <View style={styles.planOperationControlRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Выбрать операцию пациента ${index + 1}`}
                    disabled={planOperationsFor(entry.department).length < 2}
                    onPress={() =>
                      setPicker(
                        picker?.index === index && picker.type === "operation"
                          ? null
                          : { index, type: "operation" }
                      )
                    }
                    style={[styles.planSelect, styles.planOperationSelect, !compact && styles.planDesktopControl]}
                  >
                    <Text numberOfLines={2} style={styles.planSelectText}>{entry.operation}</Text>
                    {planOperationsFor(entry.department).length > 1 ? (
                      <Icon name="chevron-down" size={17} color={colors.textDim} />
                    ) : null}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Добавить вторую операцию пациенту ${index + 1}`}
                    onPress={() => setPicker({ index, type: "additional-operation" })}
                    style={styles.planAddOperationButton}
                  >
                    <Icon name="add" size={20} color={colors.primary} />
                  </Pressable>
                </View>
                {picker?.index === index && picker.type === "operation" ? (
                  <View style={styles.planOptions}>
                    {planOperationsFor(entry.department).map((operation) => (
                      <Pressable
                        key={operation}
                        accessibilityRole="button"
                        accessibilityLabel={`Операция ${operation}`}
                        onPress={() => {
                          updateEntry(index, { operation });
                          setPicker(null);
                        }}
                        style={styles.planOption}
                      >
                        <Text style={styles.planOptionText}>{operation}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {picker?.index === index && picker.type === "additional-operation" ? (
                  <View style={styles.planOptions}>
                    {planOperationsFor(entry.department).map((operation) => (
                      <Pressable
                        key={operation}
                        accessibilityRole="button"
                        accessibilityLabel={`Добавить операцию ${operation}`}
                        onPress={() => {
                          const operations = entry.operation.split(" + ").map((value) => value.trim());
                          updateEntry(index, {
                            operation: operations.includes(operation)
                              ? entry.operation
                              : `${entry.operation} + ${operation}`
                          });
                          setPicker(null);
                        }}
                        style={styles.planOption}
                      >
                        <Text style={styles.planOptionText}>{operation}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={[styles.planEditorField, !compact && styles.planEditorAdditionsField]}>
                {compact ? <Text style={styles.planFieldLabel}>Дополнения</Text> : null}
                <TextInput
                  value={entry.additions}
                  onChangeText={(additions) => updateEntry(index, { additions })}
                  placeholder="Дополнения"
                  placeholderTextColor={colors.textDim}
                  multiline
                  style={[
                    styles.planPatientInput,
                    compact ? styles.planAdditionsInput : styles.planDesktopControl
                  ]}
                />
              </View>
              {!compact ? (
                <View style={[styles.planEditorField, styles.planEditorHistoryField]}>
                  <View style={[styles.planEditorHistoryValue, styles.planDesktopControl]}>
                    <Text numberOfLines={2} style={styles.planEditorHistoryText}>
					  {entry.previous_operations?.length
						? entry.previous_operations.slice(0, 3).map((study) => formatShortNumericDate(study.time_beginning)).join(" · ")
                        : entry.history_searched === false ? "Поиск не проведён" : "Первичная"}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
            {compact && index === 0 ? (
              <Button
                label="Добавить ещё пациента"
                icon="add"
                variant="ghost"
                onPress={addPlanEntry}
              />
            ) : null}
            </Fragment>
          ))}
          {!compact ? (
            <Button
              label="Добавить пациента"
              icon="add"
              variant="ghost"
              onPress={addPlanEntry}
            />
          ) : null}
        </ScrollView>
        <View style={[styles.planEditorFooter, !compact && styles.planEditorFooterDesktop]}>
          {saveError ? <InlineError message={saveError} onRetry={saveDay} /> : null}
          <View style={styles.planEditorActions}>
            <Button label="Отмена" variant="ghost" onPress={() => setSelectedDate(null)} />
            <Button label="Сохранить" loading={saving} onPress={() => void saveDay()} />
          </View>
        </View>
        </View>
      </Sheet>

      <Sheet
        visible={Boolean(previousProtocol)}
        title="Предыдущая операция"
        onClose={() => setPreviousProtocol(null)}
        fullScreen={compact}
        wide
      >
        {previousProtocol ? (
          <ScrollView contentContainerStyle={styles.previousProtocolContent}>
            <StudyDetails
              study={previousProtocol}
              hasXA={false}
              xaCached={false}
              onOpenXA={() => undefined}
            />
          </ScrollView>
        ) : null}
      </Sheet>

      <Sheet
        visible={shareOpen}
        title="Отправить снимок плана"
        onClose={() => setShareOpen(false)}
      >
        <View style={styles.planShareOptions}>
          {(["MAX", "Telegram", "SMS"] as const).map((target) => (
            <Button
              key={target}
              label={target}
              icon="share-outline"
              variant="ghost"
              onPress={() => {
                if (!plan) return;
                setShareOpen(false);
                void sharePlanSnapshot(plan, target).catch((reason) =>
                  Alert.alert("Не удалось отправить", errorMessage(reason))
                );
              }}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function MobileMenu({
  visible,
  settings,
  health,
  agentHealth,
  onClose,
	onSettings,
	onStatistics
}: {
  visible: boolean;
  settings: AppSettings;
  health: ApiHealth | null;
  agentHealth: AgentHealth;
  onClose: () => void;
  onSettings: () => void;
	onStatistics: () => void;
}) {
  const translateX = useRef(new Animated.Value(-380)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    translateX.setValue(-380);
    Animated.spring(translateX, {
      toValue: 0,
      damping: 22,
      stiffness: 240,
      mass: 0.9,
      useNativeDriver: Platform.OS !== "web"
    }).start();
  }, [translateX, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.drawerRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть меню"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            styles.drawer,
            {
              paddingTop: Math.max(18, insets.top + 12),
              paddingBottom: Math.max(22, insets.bottom + 14),
              transform: [{ translateX }]
            }
          ]}
        >
          <View style={styles.drawerHeader}>
            <View style={styles.drawerBrand}>
              <View style={styles.headerBrandMark}>
                <Icon name="scan" color={colors.primary} size={21} />
              </View>
              <Text style={styles.headerBrandText}>VIEWER</Text>
            </View>
            <IconButton icon="close" label="Закрыть меню" onPress={onClose} />
          </View>
          <View style={styles.profileCard}>
            <View style={styles.profileAvatar}>
              <Icon name="person" color={colors.primary} size={24} />
            </View>
            <View style={styles.drawerProfileCopy}>
              <Text style={styles.settingsTitle}>Клинический пользователь</Text>
              <Text style={styles.requestMetaText} numberOfLines={1}>
                {settings.userId}
              </Text>
            </View>
          </View>
          <View style={styles.drawerStatuses}>
            <StatusLine
              icon="server-outline"
              label="Viewer Backend"
              online={Boolean(health?.ok)}
              meta={health?.ok ? "Сервер доступен" : "Нет соединения"}
            />
            <StatusLine
              icon="hardware-chip-outline"
              label={`Hospital Agent ${settings.agentId}`}
              online={agentHealth.online && agentHealth.status === "well"}
              warning={agentHealth.status === "with_errors"}
              meta={`Heartbeat ${relativeTime(agentHealth.lastSeen)}`}
            />
          </View>
          <View style={styles.drawerMenu}>
			<Pressable
			  style={({ pressed }) => [styles.drawerItem, pressed && styles.pressed]}
			  onPress={onStatistics}
			>
			  <Icon name="stats-chart-outline" color={colors.textMuted} />
			  <Text style={styles.drawerItemText}>Статистика</Text>
			  <Icon name="chevron-forward" size={17} color={colors.textDim} />
			</Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.drawerItem,
                pressed && styles.pressed
              ]}
              onPress={onSettings}
            >
              <Icon name="options-outline" color={colors.textMuted} />
              <Text style={styles.drawerItemText}>Настройки и агенты</Text>
              <Icon name="chevron-forward" size={17} color={colors.textDim} />
            </Pressable>
          </View>
          <View style={styles.drawerFooter}>
            <Icon name="shield-checkmark-outline" color={colors.textDim} />
            <Text style={styles.privacyNote}>
              Клинические данные. Используйте только на доверенном устройстве.
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function StudyFilterSheet({
  visible,
  selected,
  sort,
  surgeon,
  surgeons,
  onClose,
  onSelect,
  onSort,
  onSurgeon
}: {
  visible: boolean;
  selected: StudyCategory;
  sort: StudySort;
  surgeon: string | null;
  surgeons: string[];
  onClose: () => void;
  onSelect: (value: StudyCategory) => void;
  onSort: (value: StudySort) => void;
  onSurgeon: (value: string | null) => void;
}) {
  return (
    <Sheet visible={visible} title="Фильтр и порядок" onClose={onClose}>
      <View style={styles.filterSheetContent}>
        <Text style={styles.filterSectionTitle}>ПОРЯДОК СПИСКА</Text>
        <View style={styles.filterSortRow}>
          <Chip
            label="По времени"
            selected={sort === "time"}
            onPress={() => onSort("time")}
          />
          <Chip
            label="По типу операции"
            selected={sort === "operation"}
            onPress={() => onSort("operation")}
          />
        </View>
        <Text style={styles.filterSectionTitle}>ХИРУРГ</Text>
        <View style={styles.filterSortRow}>
          <Chip
            label="Все хирурги"
            selected={!surgeon}
            onPress={() => onSurgeon(null)}
          />
          {surgeons.map((value) => (
            <Chip
              key={value}
              label={value.charAt(0).toLocaleUpperCase("ru") + value.slice(1)}
              selected={surgeon === value}
              onPress={() => onSurgeon(surgeon === value ? null : value)}
            />
          ))}
        </View>
        <Text style={styles.filterSectionTitle}>ТИП ОПЕРАЦИИ</Text>
        {studyCategories.map((value) => {
          const active = selected === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => onSelect(value)}
              style={({ pressed }) => [
                styles.filterOption,
                active && styles.filterOptionSelected,
                pressed && styles.pressed
              ]}
            >
              <Text
                style={[
                  styles.filterOptionText,
                  active && styles.filterOptionTextSelected
                ]}
              >
                {value === "all" ? "Все типы" : value}
              </Text>
              {active ? (
                <Icon name="checkmark-circle" color={colors.primary} />
              ) : null}
            </Pressable>
          );
        })}
        <Button label="Готово" onPress={onClose} />
      </View>
    </Sheet>
  );
}

function SettingsScreen({
  compact,
  settings,
  health,
  agentHealthById,
  dicomCache,
  onSave,
  onCheck,
  onClearCache
}: {
  compact: boolean;
  settings: AppSettings;
  health: ApiHealth | null;
  agentHealthById: Record<number, AgentHealth>;
  dicomCache: DicomCacheSnapshot;
  onSave: (settings: AppSettings) => void;
  onCheck: () => void;
  onClearCache: () => void;
}) {
  const [agentIds] = useState(settings.agentIds);
  const [selectedAgentIds, setSelectedAgentIds] = useState(
    settings.selectedAgentIds
  );
  const [userId, setUserId] = useState(settings.userId);

  const toggleAgent = (id: number) => {
    setSelectedAgentIds((current) => {
      if (current.includes(id)) {
        return current.length === 1
          ? current
          : current.filter((value) => value !== id);
      }
      return current.length < 2 ? [...current, id] : [current[1]!, id];
    });
  };

  return (
    <ScrollView
      style={[styles.screen, compact && styles.screenCompact]}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollScreen}
    >
      <View style={styles.settingsGrid}>
        <View style={styles.settingsCard}>
          <View>
            <Text style={styles.settingsTitle}>Больничные агенты</Text>
            <Text style={styles.settingsDescription}>
              Выберите до двух агентов — только их статусы появятся в шапке.
            </Text>
          </View>
          <View style={styles.agentManager}>
            {agentIds.map((id) => {
              const active = selectedAgentIds.includes(id);
              const state =
                agentHealthById[id] ??
                ({ online: false, status: "unknown" } satisfies AgentHealth);
              return (
                <Pressable
                  key={id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  onPress={() => toggleAgent(id)}
                  style={({ pressed }) => [
                    styles.agentRow,
                    active && styles.agentRowSelected,
                    pressed && styles.pressed
                  ]}
                >
                  <View
                    style={[
                      styles.selectionCheck,
                      active && styles.selectionCheckSelected
                    ]}
                  >
                    {active ? (
                      <Icon name="checkmark" size={16} color="#fff" />
                    ) : null}
                  </View>
                  <View style={styles.agentRowCopy}>
                    <Text style={styles.agentRowTitle}>Hospital Agent {id}</Text>
                    <Text style={styles.requestMetaText}>
                      {state.status === "with_errors"
                        ? "Есть ошибки"
                        : state.online
                          ? "На связи"
                          : state.status === "unknown"
                            ? "Статус ещё не проверен"
                            : `Не в сети · ${relativeTime(state.lastSeen)}`}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor:
                          state.status === "with_errors"
                            ? colors.warning
                            : state.online
                              ? colors.success
                              : colors.danger
                      }
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
          <Field
            label="Идентификатор пользователя"
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            hint="Временное поле до подключения авторизации."
          />
          <Button
            label="Сохранить"
            onPress={() =>
              onSave({
                agentId: selectedAgentIds[0] ?? agentIds[0] ?? 2,
                agentIds,
                selectedAgentIds,
                userId,
                autoDownloadAngiography: true
              })
            }
          />
        </View>
        {compact ? (
          <View style={styles.settingsCard}>
          <View>
            <Text style={styles.settingsTitle}>Ангиографии на устройстве</Text>
            <Text style={styles.settingsDescription}>
              Сервер заранее готовит cine каждой XA-серии, а приложение
              автоматически сохраняет их локально. Точные кадры выбранной
              серии подготавливаются в фоне для паузы и ручной прокрутки.
            </Text>
          </View>
          <View style={styles.cacheUsage}>
            <View>
              <Text style={styles.requestMetaText}>Занято на устройстве</Text>
              <Text style={styles.cacheUsageValue}>
                {formatStorageSize(dicomCache.totalBytes)}
              </Text>
            </View>
            <Text style={styles.cacheUsageMeta}>
              {
                Object.values(dicomCache.studies).filter(
                  (study) => study.complete
                ).length
              }{" "}
              полностью
            </Text>
          </View>
          {!dicomCache.supported ? (
            <Text style={styles.settingsDescription}>
              Постоянное хранилище недоступно в этом режиме браузера.
            </Text>
          ) : null}
          {dicomCache.totalBytes > 0 ? (
            <Button
              label="Очистить сохранённые XA и захваты"
              variant="secondary"
              icon="trash-outline"
              onPress={() =>
                confirmDeleteAll(
                  "Удалить сохранённые XA и захваты кадров с этого устройства?",
                  onClearCache
                )
              }
            />
          ) : null}
          </View>
        ) : null}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Состояние контура</Text>
          <StatusLine
            icon="server-outline"
            label="Viewer Backend"
            online={Boolean(health?.ok)}
            meta={health?.message ?? "Проверяем…"}
          />
          {selectedAgentIds.map((id) => {
            const state =
              agentHealthById[id] ??
              ({ online: false, status: "unknown" } satisfies AgentHealth);
            return (
              <StatusLine
                key={id}
                icon="hardware-chip-outline"
                label={`Hospital Agent ${id}`}
                online={state.online && state.status === "well"}
                warning={state.status === "with_errors"}
                meta={`Последний heartbeat: ${relativeTime(state.lastSeen)}`}
              />
            );
          })}
          <Button
            label="Проверить соединение"
            variant="secondary"
            icon="refresh"
            onPress={onCheck}
          />
        </View>
      </View>
      <View style={styles.securityCard}>
        <Icon name="shield-checkmark-outline" size={25} color={colors.warning} />
        <View style={styles.securityCopy}>
          <Text style={styles.securityTitle}>Текущий технический допуск</Text>
          <Text style={styles.securityText}>
            Backend пока работает без авторизации. Не публикуйте frontend в
            открытом интернете до подключения TLS и ролей пользователей.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function CommandSheet({
  visible,
  settings,
  initialCommand,
  requests,
  studies,
  onClose,
  onSubmit
}: {
  visible: boolean;
  settings: AppSettings;
  initialCommand: "find_xa" | "find_ct";
  requests: UserRequest[];
  studies: Study[];
  onClose: () => void;
  onSubmit: (
    command: AgentCommand,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
}) {
  const [command, setCommand] = useState<AgentCommand>(initialCommand);
  const [patient, setPatient] = useState("");
  const [searchPeriod, setSearchPeriod] = useState("today");
  const [submitting, setSubmitting] = useState(false);
  const needsPatient = ["find_study", "find_xa", "find_ct"].includes(command);
  const needsPacsPeriod = ["find_xa", "find_ct"].includes(command);
  const valid = !needsPatient || patient.trim().length >= 2;
  useEffect(() => setCommand(initialCommand), [initialCommand, visible]);
  const relevantRequests = requests
    .filter((request) => request.command === command)
    .slice(0, 5);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    const payload = needsPatient
      ? {
          patient: patient.trim(),
          ...(needsPacsPeriod ? { period: searchPeriod } : {})
        }
      : {};
    const ok = await onSubmit(command, payload);
    setSubmitting(false);
    if (ok) {
      setPatient("");
    }
  };

  return (
    <Sheet
      visible={visible}
      title={`Найти ${command === "find_ct" ? "CT" : "XA"}`}
      onClose={onClose}
      fullScreen
    >
      <ScrollView contentContainerStyle={styles.commandContent}>
        <View style={styles.commandDestination}>
          <Icon name="hardware-chip-outline" color={colors.primary} />
          <Text style={styles.commandDestinationText}>
            Агент {settings.agentId} · пользователь {settings.userId}
          </Text>
        </View>
        {needsPatient ? (
          <Field
            label="Фамилия пациента"
            value={patient}
            onChangeText={setPatient}
            placeholder="Например, Иванов"
            hint="При одном точном совпадении загрузка начнётся автоматически."
          />
        ) : null}
        {needsPacsPeriod ? (
          <View style={styles.commandPeriodSection}>
            <Text style={styles.commandGroupLabel}>ПЕРИОД ИССЛЕДОВАНИЯ</Text>
            <View style={styles.commandPeriodOptions}>
              {(
                [
                  ["today", "Сегодня"],
                  ["yesterday", "Вчера"],
                  ["three_days", "3 дня"],
                  ["week", "Неделя"],
                  ["month", "Месяц"],
                  ["six_months", "Полгода"],
                  ["year", "Год"]
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: searchPeriod === value }}
                  onPress={() => setSearchPeriod(value)}
                  style={[
                    styles.commandPeriodOption,
                    searchPeriod === value && styles.commandPeriodOptionActive
                  ]}
                >
                  <Text
                    style={[
                      styles.commandPeriodOptionText,
                      searchPeriod === value &&
                        styles.commandPeriodOptionTextActive
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View style={styles.commandActions}>
          <Button label="Отмена" variant="ghost" onPress={onClose} />
          <Button
            label="Найти"
            icon="send-outline"
            disabled={!valid}
            loading={submitting}
            onPress={() => void submit()}
          />
        </View>
        {relevantRequests.length ? (
          <View style={styles.requestList}>
            <Text style={styles.commandGroupLabel}>ПОСЛЕДНИЕ РЕЗУЛЬТАТЫ</Text>
            {relevantRequests.map((request) => (
              <RequestCard
                key={request.id}
                compact
                request={request}
                studies={studies}
                onSubmit={onSubmit}
                onRefresh={() => undefined}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  loginSafe: { flex: 1, backgroundColor: "#050C15" },
  loginLayout: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#050C15"
  },
  loginLayoutCompact: { backgroundColor: "#050C15" },
  loginBackgroundImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    width: "100%",
    height: "100%"
  },
  loginBackgroundImageCompact: {
    top: 0,
    left: 0,
    right: 0,
    width: "100%",
    height: "100%"
  },
  loginBackgroundShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,12,21,0.24)"
  },
  loginLaunchLoader: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    alignItems: "center",
    justifyContent: "center"
  },
  loginPanel: {
    width: "44%",
    minWidth: 430,
    height: "100%",
    paddingHorizontal: 54,
    paddingVertical: 42,
    justifyContent: "space-between",
    backgroundColor: "transparent"
  },
  loginPanelCompact: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    minWidth: 0,
    flex: 0,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    gap: 16,
    backgroundColor: "transparent"
  },
  loginBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11
  },
  loginBrandIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(53,194,255,0.24)"
  },
  loginBrandName: {
    color: darkColors.text,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 2
  },
  loginBrandCaption: {
    marginTop: 2,
    color: darkColors.primary,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "700",
    letterSpacing: 1.8
  },
  loginForm: { width: "100%", maxWidth: 430, gap: 18 },
  loginHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14
  },
  loginTitle: {
    color: darkColors.text,
    fontSize: 29,
    lineHeight: 35,
    fontWeight: "700",
    letterSpacing: -0.5
  },
  loginRegistration: {
    minHeight: 34,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "rgba(134,213,247,0.42)",
    backgroundColor: "rgba(5,12,21,0.34)"
  },
  loginRegistrationText: {
    color: darkColors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700"
  },
  loginFields: { gap: 10 },
  loginField: {
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: darkColors.borderSoft,
    backgroundColor: "rgba(30,33,39,0.82)"
  },
  loginInput: {
    flex: 1,
    minWidth: 0,
    height: 48,
    color: darkColors.text,
    fontSize: 15,
    outlineStyle: "none"
  } as never,
  loginButton: {
    minHeight: 52,
    zIndex: 3,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 17,
    backgroundColor: darkColors.primary
  },
  loginButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  loginButtonText: {
    color: "#04111A",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800"
  },
  loginPreparing: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7
  },
  loginPreparingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: darkColors.primary
  },
  loginPreparingText: {
    color: darkColors.textDim,
    fontSize: 10,
    lineHeight: 14
  },
  loginTemporary: {
    color: darkColors.textDim,
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center"
  },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  safeAreaDark: { backgroundColor: darkColors.canvas },
  app: { flex: 1, flexDirection: "row", backgroundColor: colors.canvas },
  appDark: { backgroundColor: darkColors.canvas },
  main: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    backgroundColor: colors.canvas
  },
  mainDark: { backgroundColor: darkColors.canvas },
  content: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  contentCompact: { paddingBottom: 66 },
  contentDark: { backgroundColor: darkColors.canvas },
  mobileHeaderFloat: {
    minHeight: 58,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "transparent"
  },
  mobileHeaderEdge: {
    width: 92,
    alignItems: "flex-start",
    justifyContent: "center"
  },
  mobileTitlePill: {
    flex: 1,
    minWidth: 0,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.surfaceSoft
  },
  mobileTitlePillDark: { backgroundColor: "transparent" },
  agentStatusNumber: {
    position: "absolute",
    right: 3,
    bottom: 1,
    fontSize: 8,
    fontWeight: "800",
    color: colors.text
  },
  desktopHeaderFloat: {
    minHeight: 68,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "transparent"
  },
  headerBrandGroup: {
    width: 190,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  headerBrandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft
  },
  headerBrandText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.6
  },
  desktopTabBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5
  },
  desktopTabButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceSoft
  },
  desktopTabButtonDark: {
    backgroundColor: "transparent",
    borderColor: "transparent"
  },
  desktopTabButtonActive: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.28)"
  },
  desktopTabButtonActiveDark: {
    backgroundColor: darkColors.primarySoft,
    borderColor: "rgba(53,194,255,0.24)"
  },
  desktopTabText: {
    ...typography.meta,
    fontWeight: "700",
    color: colors.textMuted,
    textAlign: "center"
  },
  desktopTabTextActive: { color: colors.primary },
  desktopTabTextActiveDark: { color: darkColors.primary },
  sidebar: {
    width: layout.sidebar,
    backgroundColor: darkColors.canvasRaised,
    borderRightWidth: 1,
    borderRightColor: darkColors.borderSoft,
    paddingHorizontal: 16,
    paddingVertical: 24
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8
  },
  brandMark: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: darkColors.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(53, 194, 255, 0.25)",
    alignItems: "center",
    justifyContent: "center"
  },
  brandName: {
    color: darkColors.text,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 2
  },
  brandSub: {
    color: darkColors.primary,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "700",
    letterSpacing: 2.7
  },
  nav: { marginTop: 42, gap: 5 },
  navLabel: {
    ...typography.meta,
    color: darkColors.textDim,
    fontSize: 9,
    letterSpacing: 1.1,
    marginBottom: 8,
    paddingHorizontal: 10
  },
  navItem: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: radii.md
  },
  navItemActive: { backgroundColor: darkColors.primarySoft },
  navText: { ...typography.label, color: darkColors.textMuted },
  navTextActive: { color: darkColors.text },
  navIndicator: {
    position: "absolute",
    left: -16,
    width: 3,
    height: 22,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: darkColors.primary
  },
  pressed: { opacity: 0.72 },
  sidebarFoot: { marginTop: "auto", gap: 8 },
  privacyNote: {
    color: darkColors.textDim,
    fontSize: 10,
    lineHeight: 15,
    paddingHorizontal: 4,
    marginTop: 8
  },
  statusLine: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  statusLineDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.borderSoft
  },
  statusLineCopy: { flex: 1, minWidth: 0 },
  statusLineTitle: { ...typography.meta, color: colors.text },
  statusLineTitleDark: { color: darkColors.text },
  statusLineMeta: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  statusLineMetaDark: { color: darkColors.textDim },
  statusDot: { width: 8, height: 8, borderRadius: 8 },
  topBar: {
    minHeight: 76,
    paddingHorizontal: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.canvasRaised
  },
  topBarDark: {
    backgroundColor: "transparent"
  },
  topBarCompact: { minHeight: 58, paddingHorizontal: 10 },
  topTitle: { ...typography.title, color: colors.text },
  topSubtitle: { ...typography.meta, color: colors.textDim, marginTop: 2 },
  mobileTopTitle: {
    ...typography.title,
    flex: 1,
    color: colors.text,
    textAlign: "center",
    fontSize: 16
  },
  textDark: { color: darkColors.text },
  textMutedDark: { color: darkColors.textMuted },
  topActions: {
    width: 190,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8
  },
  healthPill: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft
  },
  healthPillDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.borderSoft
  },
  healthDot: { width: 7, height: 7, borderRadius: 7 },
  healthText: { ...typography.meta, color: colors.textMuted },
  mobileStatusPair: {
    width: 92,
    height: 38,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "flex-end"
  },
  mobileStatusIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft
  },
  screen: { flex: 1, paddingHorizontal: 24, paddingTop: 22 },
  screenCompact: { paddingHorizontal: 10, paddingTop: 4 },
  scrollScreen: { paddingBottom: 38, gap: 18 },
  studyToolbar: {
    marginTop: 18,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  studyToolbarCompact: {
    flexDirection: "column",
    alignItems: "stretch",
    marginTop: 4,
    marginBottom: 8
  },
  studySearchScopes: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  studySuggestions: {
    maxHeight: 210,
    marginBottom: 10,
    padding: 8,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    ...shadow
  },
  studySuggestionsTitle: { fontSize: 11, fontWeight: "800", color: colors.textDim, paddingHorizontal: 6, paddingVertical: 3 },
  studySuggestionRow: { minHeight: 46, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSoft },
  studySuggestionCopy: { flex: 1, minWidth: 0 },
  studySuggestionPatient: { fontSize: 14, fontWeight: "800", color: colors.text },
  studySuggestionOperation: { marginTop: 2, fontSize: 11, color: colors.textDim },
  studySuggestionDate: { fontSize: 11, fontWeight: "700", color: colors.primary },
  studyDatabaseWorkspace: { flex: 1, minHeight: 0, flexDirection: "row", gap: 14 },
  studyDatabaseResults: { flex: 1, minWidth: 0, padding: 10, gap: 7, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
  studyDatabaseList: { gap: 5, paddingBottom: 12 },
  studyDatabaseDetail: { flex: 1, minWidth: 0 },
  mobileChipsScroll: { width: "100%", flexGrow: 0 },
  weekdayChipsDesktop: { flexGrow: 0, maxWidth: 440 },
  chips: { gap: 7 },
  weekdayChips: { gap: 6, alignItems: "center", paddingRight: 4 },
  filterChipButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft
  },
  filterChipButtonActive: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.35)"
  },
  studyWorkspace: { flex: 1, minHeight: 0, flexDirection: "row", gap: 14 },
  studyListPane: { flex: 1, minWidth: 0 },
  detailPane: { flex: 1, minWidth: 0 },
  detailPaneContent: { paddingBottom: 28 },
  studyList: { gap: 4, paddingBottom: 28 },
  studyRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface
  },
  studyRowCompact: { minHeight: 58 },
  studyRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11, 132, 179, 0.38)"
  },
  studyIndexText: {
    ...typography.meta,
    color: colors.primary,
    width: 23,
    fontWeight: "700"
  },
  studyCopy: { flex: 1, minWidth: 0, gap: 2 },
  studyTitleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  studyPatient: {
    ...typography.label,
    fontSize: 14,
    color: colors.text,
    flex: 1
  },
  studyAge: { color: colors.text, fontSize: 14, fontWeight: "600" },
  studyOperation: { ...typography.meta, color: colors.textMuted },
  studyDateCompact: {
    color: colors.textDim,
    fontSize: 10,
    maxWidth: 88
  },
  detailsCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20
  },
  detailsHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 17,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  detailsIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  detailsHeroCopy: { flex: 1, minWidth: 0 },
  detailsPatient: { ...typography.title, color: colors.text },
  detailsAge: { color: colors.text, fontSize: typography.title.fontSize, fontWeight: "700" },
  detailsSubtitle: { ...typography.meta, color: colors.textMuted, marginTop: 3 },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
    marginTop: 12
  },
  detailItem: { width: "50%", padding: 6 },
  detailItemLabel: { ...typography.meta, color: colors.textDim },
  detailItemValue: {
    ...typography.label,
    color: colors.text,
    marginTop: 3,
    textTransform: "capitalize"
  },
  detailSection: { marginTop: 17 },
  protocolSection: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft
  },
  protocolContent: { gap: 14 },
  protocolConclusion: {
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(11,132,179,0.24)",
    backgroundColor: colors.primarySoft
  },
  protocolConclusionLabel: {
    color: colors.primary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.1
  },
  protocolConclusionText: {
    marginTop: 6,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600"
  },
  protocolCourse: { gap: 2 },
  detailLabel: {
    color: colors.primary,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 1.1
  },
  detailHeading: {
    ...typography.title,
    color: colors.text,
    marginTop: 5
  },
  detailDescription: {
    ...typography.body,
    color: colors.text,
    marginTop: 8,
    lineHeight: 24
  },
  detailsActions: { flexDirection: "row", gap: 8, marginTop: 22 },
  flexButton: { flex: 1 },
  sheetScroll: { padding: 14 },
  angioScreen: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: darkColors.canvas
  },
  angioFilters: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8
  },
  angioFiltersCompact: { minHeight: 40, marginBottom: 4 },
  angioFilter: {
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: darkColors.borderSoft
  },
  angioFilterActive: {
    borderColor: darkColors.primary,
    backgroundColor: darkColors.primarySoft
  },
  angioFilterText: { ...typography.meta, color: darkColors.textMuted },
  angioFilterTextActive: { color: darkColors.primary, fontWeight: "700" },
  angioHeaderActions: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  angioGuideButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: darkColors.borderSoft,
    backgroundColor: darkColors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  angioAutoStatus: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  angioAutoStatusCompact: {
    width: "100%",
    marginLeft: 0,
    paddingHorizontal: 4
  },
  angioAutoStatusText: { ...typography.meta, color: darkColors.textMuted },
  angioHeading: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16
  },
  angioEyebrow: {
    ...typography.meta,
    color: darkColors.primary,
    letterSpacing: 1.2
  },
  angioTitle: {
    ...typography.display,
    color: darkColors.text,
    marginTop: 3
  },
  angioSubtitle: {
    ...typography.body,
    color: darkColors.textMuted,
    marginTop: 4
  },
  angioWorkspace: { flex: 1, flexDirection: "row", gap: 12, minHeight: 0 },
  angioWorkspaceCompact: { flexDirection: "column" },
  angioList: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "transparent"
  },
  angioListDesktop: {
    width: 290,
    maxWidth: 290,
    flexBasis: 290,
    flexGrow: 0,
    flexShrink: 0
  },
  angioListCompact: { flex: 1, width: "100%", minWidth: 0, maxWidth: "100%" },
  angioListContent: { gap: 6, paddingBottom: 8 },
  angioDesktopViewer: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignSelf: "stretch",
    overflow: "hidden",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: darkColors.borderSoft,
    backgroundColor: "#05080B"
  },
  angioRowAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  angioActionSheet: { gap: 10, paddingBottom: 8 },
  angioActionButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft
  },
  angioActionText: { ...typography.body, fontWeight: "600", color: colors.text },
  angioActionDanger: { backgroundColor: colors.dangerSoft },
  angioActionDangerText: { color: colors.danger },
  pacsGuideContent: { padding: 18, gap: 16 },
  pacsGuideIntro: { ...typography.body, color: colors.textMuted },
  pacsGuideGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border
  },
  pacsGuideSteps: { gap: 9 },
  pacsGuideStep: { ...typography.body, color: colors.text },
  pacsGuideNote: {
    ...typography.meta,
    color: colors.textMuted,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.primarySoft
  },
  angioCTPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 40
  },
  angioCTTitle: {
    ...typography.title,
    color: darkColors.text
  },
  angioCTText: {
    ...typography.body,
    maxWidth: 440,
    color: darkColors.textMuted,
    textAlign: "center"
  },
  angioRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: darkColors.surface
  },
  angioRowSelected: {
    backgroundColor: darkColors.primarySoft,
    borderColor: "rgba(53,194,255,0.35)"
  },
  angioIndex: {
    width: 24,
    color: darkColors.primary,
    fontSize: 12,
    fontWeight: "800"
  },
  angioRowCopy: { flex: 1, minWidth: 0 },
  angioPatient: { ...typography.label, color: darkColors.text },
  angioMeta: { ...typography.meta, color: darkColors.textDim, marginTop: 3 },
  angioStored: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,148,127,0.12)"
  },
  angioNoFilterResults: {
    ...typography.body,
    color: darkColors.textMuted,
    paddingVertical: 24,
    textAlign: "center"
  },
  angioViewer: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: darkColors.border,
    backgroundColor: "#05080B"
  },
  angioViewerOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    zIndex: 4,
    minHeight: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 18,
    backgroundColor: "rgba(30,33,39,0.92)",
    borderWidth: 1,
    borderColor: darkColors.borderSoft
  },
  angioViewerPatient: { ...typography.label, color: darkColors.text },
  angioFrame: { flex: 1, minHeight: 420 },
  angioEmpty: {
    flex: 1,
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: darkColors.canvas
  },
  angioEmptyTitle: {
    ...typography.title,
    color: darkColors.text,
    marginTop: 13
  },
  angioEmptyText: {
    ...typography.body,
    color: darkColors.textMuted,
    textAlign: "center",
    maxWidth: 480,
    marginTop: 6,
    marginBottom: 17
  },
  mobileAngioViewer: {
    flex: 1,
    backgroundColor: darkColors.canvas
  },
  mobileViewerFrame: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#05080B"
  },
  mobileViewerTop: {
    position: "absolute",
    top: 8,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    zIndex: 5
  },
  mobileViewerRoundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(30,33,39,0.92)",
    borderWidth: 1,
    borderColor: darkColors.borderSoft
  },
  mobileViewerIdentity: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 13,
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(30,33,39,0.92)",
    borderWidth: 1,
    borderColor: darkColors.borderSoft
  },
  mobileViewerPatient: { ...typography.label, color: darkColors.text },
  mobileViewerMeta: { fontSize: 10, color: darkColors.textDim, marginTop: 1 },
  infoBanner: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    padding: 13,
    borderRadius: radii.md,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(11,132,179,0.18)"
  },
  infoBannerText: { ...typography.body, color: colors.textMuted, flex: 1 },
  compactScreenToolbar: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 8
  },
  compactScreenToolbarMobile: { minHeight: 48, paddingBottom: 6 },
  reportRequestButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  reportRequestButtonPending: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  reportPeriodContent: {
    padding: 18,
    gap: 20
  },
  reportPeriodModes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  reportPeriodHint: {
    ...typography.meta,
    color: colors.textMuted,
    marginBottom: 12
  },
  reportDayChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  reportDayChoice: {
    width: 66,
    minHeight: 66,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  reportDayChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  reportDayChoiceText: {
    ...typography.title,
    color: colors.text
  },
  reportDayChoiceUnit: {
    ...typography.meta,
    color: colors.textMuted,
    marginTop: 2
  },
  reportDayChoiceTextActive: { color: colors.primary },
  reportCalendar: {
    gap: 10
  },
  reportCalendarHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  reportCalendarTitle: {
    ...typography.title,
    color: colors.text,
    textTransform: "capitalize"
  },
  reportCalendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  reportCalendarWeekday: {
    width: "14.2857%",
    paddingVertical: 7,
    textAlign: "center",
    ...typography.meta,
    color: colors.textDim
  },
  reportCalendarCell: {
    width: "14.2857%",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  reportCalendarCellInRange: { backgroundColor: colors.primarySoft },
  reportCalendarDate: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center"
  },
  reportCalendarDateSelected: { backgroundColor: colors.primary },
  reportCalendarDateText: { ...typography.label, color: colors.text },
  reportCalendarDateTextSelected: { color: "#fff" },
  compactScreenHeading: { flex: 1, minWidth: 0 },
  compactScreenTitle: { ...typography.title, fontSize: 17, color: colors.text },
  compactScreenMeta: { ...typography.meta, color: colors.textDim, marginTop: 2 },
  compactToolbarActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  flexScroll: { flex: 1, minHeight: 0 },
  requestScrollContent: { paddingBottom: 30 },
  requestList: { gap: 8 },
  requestCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  requestIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surfaceHover,
    alignItems: "center",
    justifyContent: "center"
  },
  requestCopy: { flex: 1, minWidth: 0 },
  requestTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  requestTitle: {
    ...typography.title,
    fontSize: 15,
    color: colors.text,
    flex: 1
  },
  requestSubject: { ...typography.body, color: colors.textMuted, marginTop: 2 },
  requestMeta: { flexDirection: "row", gap: 12, marginTop: 6 },
  requestMetaText: { ...typography.meta, color: colors.textDim },
  requestId: { ...typography.meta, color: colors.primary },
  requestError: { ...typography.meta, color: colors.danger, marginTop: 7 },
  requestResultSummary: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  requestResultText: { ...typography.label, color: colors.success },
  resultSheet: { padding: 18, gap: 12 },
  protocolResult: {
    padding: 17,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border
  },
  pacsResult: {
    padding: 16,
    gap: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12
  },
  resultHeaderCopy: { flex: 1, minWidth: 0 },
  resultPatient: { ...typography.title, fontSize: 16, color: colors.text },
  resultOperation: { ...typography.label, color: colors.textMuted, marginTop: 3 },
  resultMetaText: { ...typography.meta, color: colors.textDim, marginTop: 8 },
  resultProtocol: {
    ...typography.body,
    color: colors.text,
    lineHeight: 23,
    marginTop: 13,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft
  },
  reportWorkspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    gap: 14,
    marginTop: 18
  },
  reportWorkspaceCompact: {
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
    flexDirection: "column",
    gap: 8,
    marginTop: 8
  },
  reportList: {
    width: 340,
    flexGrow: 0,
    borderRadius: radii.lg,
    backgroundColor: colors.canvasRaised,
    borderWidth: 1,
    borderColor: colors.border
  },
  reportListCompact: {
    width: "100%",
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    borderRadius: radii.md
  },
  reportListContent: { padding: 8, gap: 5 },
  reportRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "transparent"
  },
  reportRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.3)"
  },
  reportDateBlock: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceHover
  },
  reportRowCopy: { flex: 1, minWidth: 0 },
  reportRowDate: { ...typography.label, color: colors.text },
  reportRowMeta: { ...typography.meta, color: colors.textDim, marginTop: 3 },
  reportRowActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  reportTrashButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dangerSoft
  },
  statisticsScreen: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 18,
    paddingBottom: 12,
    backgroundColor: colors.canvas
  },
  statisticsPageScroll: { flex: 1, minHeight: 0 },
  statisticsPageContent: { paddingBottom: 18 },
  statisticsWorkspace: {
    flexDirection: "row",
    gap: 14,
    marginTop: 10
  },
  statisticsTablesPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    gap: 12
  },
  statisticsTableCard: {
    minWidth: 0,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "rgba(11,132,179,0.22)",
    backgroundColor: colors.surface,
    overflow: "hidden",
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2
  },
  statisticsCardHeading: {
    minHeight: 62,
    paddingHorizontal: 14,
    justifyContent: "center",
    gap: 3,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(11,132,179,0.18)",
    backgroundColor: colors.primarySoft
  },
  statisticsCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  statisticsCardIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.canvasRaised, borderWidth: 1, borderColor: "rgba(11,132,179,0.18)" },
  statisticsCardTitle: { ...typography.label, color: colors.text },
  statisticsHorizontalScroll: { minWidth: 0, flexGrow: 0 },
  statisticsTableHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "rgba(11,132,179,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  statisticsTableRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.surface
  },
  statisticsTableRowAlt: { backgroundColor: colors.surfaceSoft },
  statisticsHeaderCell: {
    width: 92,
    paddingHorizontal: 8,
    textAlign: "center",
    textAlignVertical: "center",
    ...typography.meta,
    fontWeight: "800",
    color: colors.primaryStrong,
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft
  },
  statisticsCell: {
    width: 92,
    paddingHorizontal: 8,
    textAlign: "center",
    textAlignVertical: "center",
    ...typography.label,
    color: colors.text,
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft
  },
  statisticsSurgeonCell: {
    width: 150,
    textAlign: "left",
    textTransform: "capitalize"
  },
  statisticsVMPHeader: { color: colors.primary },
  statisticsTotalHeader: { color: colors.primaryStrong, backgroundColor: "rgba(11,132,179,0.08)" },
  statisticsVMPCell: {
    color: colors.primary,
    backgroundColor: colors.primarySoft
  },
  statisticsTotalCell: { fontWeight: "800", color: colors.primaryStrong, backgroundColor: "rgba(11,132,179,0.06)" },
  statisticsSummaryRow: { backgroundColor: colors.primarySoft, borderTopWidth: 1, borderTopColor: "rgba(11,132,179,0.20)" },
  historicalStatisticsCard: {
    minHeight: 220,
    minWidth: 0,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "rgba(11,132,179,0.22)",
    backgroundColor: colors.surface,
    overflow: "hidden",
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2
  },
  mobileStatisticsScroll: { flex: 1, minHeight: 0 },
  mobileStatisticsContent: { paddingTop: 10, paddingBottom: 24, gap: 12 },
  mobileStatisticsSelectorCard: {
    padding: 12,
    gap: 7,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  mobileStatisticsSelectorLabel: {
    ...typography.meta,
    color: colors.textDim,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  mobileStatisticsSelector: {
    minHeight: 46,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft
  },
  mobileStatisticsSelectorValue: {
    flex: 1,
    ...typography.label,
    color: colors.text
  },
  mobileStatisticsChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingTop: 3
  },
  mobileStatisticsChoice: {
    minHeight: 34,
    maxWidth: "100%",
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceSoft
  },
  mobileStatisticsChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  mobileStatisticsChoiceText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700"
  },
  mobileStatisticsChoiceTextActive: { color: colors.primary },
  mobileStatisticsTable: {
    overflow: "hidden",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  mobileStatisticsTableHeader: {
    minHeight: 44,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.canvasRaised
  },
  mobileStatisticsHeaderName: {
    flex: 1,
    ...typography.meta,
    color: colors.textMuted,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  mobileStatisticsHeaderValue: {
    maxWidth: "48%",
    ...typography.meta,
    color: colors.textMuted,
    fontWeight: "800",
    textAlign: "right",
    textTransform: "uppercase"
  },
  mobileStatisticsTableRow: {
    minHeight: 50,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  mobileStatisticsSurgeon: {
    flex: 1,
    ...typography.label,
    color: colors.text,
    textTransform: "capitalize"
  },
  mobileStatisticsValue: {
    minWidth: 54,
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right"
  },
  mobileStatisticsSummary: {
    borderBottomWidth: 0,
    backgroundColor: colors.primarySoft
  },
  mobileStatisticsSummaryLabel: {
    flex: 1,
    ...typography.label,
    color: colors.primary,
    fontWeight: "800"
  },
  mobileStatisticsSummaryValue: {
    minWidth: 54,
    color: colors.primary,
    fontSize: 19,
    fontWeight: "900",
    textAlign: "right"
  },
  historyTableRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.surface
  },
  historyTableRowAlt: { backgroundColor: colors.surfaceSoft },
  historyHeaderCell: {
    width: 108,
    paddingHorizontal: 7,
    textAlign: "center",
    textAlignVertical: "center",
    fontFamily: Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "monospace" }),
    fontSize: 10,
    fontWeight: "800",
    color: colors.primaryStrong,
    backgroundColor: "rgba(11,132,179,0.08)",
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft
  },
  historyCell: {
    width: 108,
    paddingHorizontal: 7,
    textAlign: "center",
    textAlignVertical: "center",
    fontFamily: Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "monospace" }),
    fontSize: 12,
    color: colors.text,
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft
  },
  historyYearCell: { width: 70, fontWeight: "800" },
  historyTotalCell: { fontWeight: "800", color: colors.primaryStrong, backgroundColor: "rgba(11,132,179,0.06)" },
  historyEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20
  },
  vmpPanel: {
    width: 390,
    minHeight: 0,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  vmpPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  vmpPanelTitle: { ...typography.title, color: colors.text },
  vmpSectionLabel: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.textDim
  },
  vmpTypeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  vmpPatientList: { flex: 1, minHeight: 120 },
  vmpPatientListContent: { gap: 6, paddingBottom: 12 },
  vmpPatientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft
  },
  vmpPatientCopy: { flex: 1, minWidth: 0 },
  vmpPatientName: { ...typography.label, color: colors.text },
  vmpPatientOperation: { ...typography.meta, color: colors.textMuted, marginTop: 2 },
  vmpPatientMeta: { fontSize: 10, color: colors.textDim, marginTop: 4 },
  vmpEmptyText: { ...typography.body, color: colors.textDim, paddingVertical: 18 },
  vmpPickerContent: { padding: 16, gap: 12, minHeight: 420 },
  vmpPickerList: { flex: 1 },
  vmpPickerListContent: { gap: 7, paddingBottom: 12 },
  vmpPickerRow: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft
  },
  logsScreen: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 18,
    paddingBottom: 12
  },
  logsContent: {
    gap: 12,
    paddingBottom: 24
  },
  logCard: {
    gap: 8,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  logHeaderCopy: { flex: 1, minWidth: 0 },
  logCommand: { ...typography.title, color: colors.text },
  logMeta: { ...typography.meta, color: colors.textMuted, marginTop: 3 },
  logPayloadLabel: {
    marginTop: 4,
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1
  },
  logPayloadBox: {
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: "#EEF2F5"
  },
  logErrorBox: {
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(216,64,64,0.2)",
    backgroundColor: colors.dangerSoft
  },
  logCode: {
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18
  },
  reportDetailPane: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  reportDetailContent: { padding: 20, paddingBottom: 34 },
  reportDocument: { gap: 20 },
  reportDocumentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  reportDocumentEyebrow: {
    ...typography.meta,
    color: colors.primary,
    letterSpacing: 1
  },
  reportDocumentTitle: {
    ...typography.display,
    color: colors.text,
    marginTop: 3
  },
  reportDocumentPeriod: { ...typography.meta, color: colors.textDim, marginTop: 4 },
  reportStats: { flexDirection: "row", gap: 8 },
  reportStat: {
    flex: 1,
    padding: 13,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border
  },
  reportStatValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700",
    color: colors.text
  },
  reportStatLabel: { ...typography.meta, color: colors.textMuted, marginTop: 2 },
  reportStatActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  reportSection: { gap: 8 },
  reportSectionTitle: { ...typography.title, fontSize: 16, color: colors.text },
  reportOperationGroupHeader: {
    minHeight: 30,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primarySoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  reportOperationGroupTitle: { ...typography.label, color: colors.primary },
  reportOperationGroupCount: { ...typography.meta, color: colors.primary },
  operationTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden"
  },
  operationRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  operationNumber: {
    ...typography.meta,
    color: colors.primary,
    width: 22,
    fontWeight: "700"
  },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  operationPatient: { ...typography.label, color: colors.text, fontSize: 14, flexShrink: 1 },
  operationAge: { ...typography.label, color: colors.text, fontSize: 14 },
  operationDepartment: {
    ...typography.meta,
    color: colors.textDim,
    maxWidth: "38%",
    textAlign: "right"
  },
  operationSummaryLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2
  },
  operationTime: { ...typography.meta, color: colors.primary, flexShrink: 0 },
  operationName: { ...typography.body, color: colors.text, flex: 1, minWidth: 0 },
  settingsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  settingsCard: {
    width: 430,
    maxWidth: "100%",
    gap: 16,
    padding: 19,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  settingsTitle: { ...typography.title, fontSize: 16, color: colors.text },
  settingsDescription: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 5
  },
  agentManager: { gap: 7 },
  agentRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft
  },
  agentRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.32)"
  },
  agentRowCopy: { flex: 1, minWidth: 0 },
  agentRowTitle: { ...typography.label, color: colors.text },
  cacheToggleRow: {
    minHeight: 64,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft
  },
  cacheToggleCopy: { flex: 1, minWidth: 0 },
  cacheSwitch: {
    width: 46,
    height: 28,
    padding: 3,
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: colors.border
  },
  cacheSwitchActive: { backgroundColor: colors.primary },
  cacheSwitchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff"
  },
  cacheSwitchThumbActive: { alignSelf: "flex-end" },
  cacheUsage: {
    minHeight: 66,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: radii.md,
    backgroundColor: colors.primarySoft
  },
  cacheUsageValue: {
    marginTop: 2,
    color: colors.text,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "700"
  },
  cacheUsageMeta: { ...typography.meta, color: colors.primary },
  securityCard: {
    maxWidth: 874,
    flexDirection: "row",
    gap: 13,
    padding: 17,
    borderRadius: radii.lg,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: "rgba(198,124,0,0.2)"
  },
  securityCopy: { flex: 1 },
  securityTitle: { ...typography.title, fontSize: 16, color: colors.text },
  securityText: { ...typography.body, color: colors.textMuted, marginTop: 4 },
  commandContent: { padding: 20, gap: 17 },
  commandDestination: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.primarySoft
  },
  commandDestinationText: { ...typography.label, color: colors.textMuted },
  commandGroupLabel: { ...typography.meta, color: colors.textDim, letterSpacing: 1 },
  commandOptions: { gap: 6 },
  commandOption: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  commandOptionSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.3)"
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.textDim,
    alignItems: "center",
    justifyContent: "center"
  },
  radioSelected: { borderColor: colors.primary },
  radioCore: {
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.primary
  },
  commandOptionText: { ...typography.label, color: colors.textMuted },
  commandOptionTextSelected: { color: colors.text },
  commandPeriodSection: { gap: 8 },
  commandPeriodOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  commandPeriodOption: {
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvasRaised
  },
  commandPeriodOptionActive: {
    borderColor: "rgba(11,132,179,0.34)",
    backgroundColor: colors.primarySoft
  },
  commandPeriodOptionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600"
  },
  commandPeriodOptionTextActive: { color: colors.primary },
  commandActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4
  },
  bulkActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  listActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingBottom: 10
  },
  studyTrailing: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  xaState: {
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.primary
  },
  xaStateInactive: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border
  },
  xaStateText: {
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    color: "#fff"
  },
  xaStateTextInactive: { color: colors.textDim },
  swipeContainer: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radii.md
  },
  swipeActions: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    justifyContent: "flex-end",
    zIndex: 0
  },
  swipeForeground: { zIndex: 1, backgroundColor: colors.canvasRaised },
  swipeForward: {
    width: 70,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: colors.primary
  },
  swipeDelete: {
    width: 62,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: colors.danger
  },
  swipeActionText: { color: "#fff", fontSize: 9, fontWeight: "700" },
  selectionCheck: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  selectionCheckSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  planToolbar: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  planToolbarActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  planWeekSelector: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft
  },
  planWeekOption: {
    minHeight: 34,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm
  },
  planWeekOptionActive: { backgroundColor: colors.canvasRaised },
  planWeekOptionText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "700"
  },
  planWeekOptionTextActive: { color: colors.primary },
  planTable: {
    flex: 1,
    minHeight: 0,
    marginTop: 8,
    marginBottom: 8,
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvasRaised
  },
  planTableRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.canvasRaised
  },
  planTableBody: { flex: 1, minHeight: 0 },
  planTableDayRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "stretch",
    borderLeftWidth: 4,
    borderLeftColor: "rgba(11,132,179,0.28)",
    borderBottomWidth: 3,
    borderBottomColor: colors.border,
    backgroundColor: colors.canvasRaised
  },
  planTableDayRowAlternate: { backgroundColor: colors.surfaceSoft },
  planEntriesColumn: { flex: 5.15 },
  planEntriesColumnCompact: { flex: 3.9 },
  planEntryRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  planTableRowPressed: { backgroundColor: colors.primarySoft },
  planTableHeader: {
    flexGrow: 0,
    flexBasis: 36,
    minHeight: 36,
    backgroundColor: colors.surfaceSoft
  },
  planTableHeaderText: {
    paddingHorizontal: 5,
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  planTableHeaderTextCompact: {
    paddingHorizontal: 2,
    fontSize: 8,
    textAlign: "center"
  },
  planTableText: {
    paddingHorizontal: 5,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600"
  },
  planTableDayText: {
    paddingHorizontal: 5,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    textTransform: "capitalize",
    paddingTop: 10
  },
  planDayCell: { flex: 0.65, minWidth: 0, flexShrink: 1 },
	planStatusCell: { width: 24, minWidth: 24, alignItems: "center", justifyContent: "center" },
  planPatientCell: { flex: 1.15, minWidth: 0, flexShrink: 1 },
  planDepartmentCell: { flex: 0.8, minWidth: 0, flexShrink: 1 },
  planOperationCell: { flex: 1, minWidth: 0, flexShrink: 1 },
  planAdditionsCell: { flex: 1, minWidth: 0, flexShrink: 1 },
  planPreviousCell: { flex: 1.2, minWidth: 0, flexShrink: 1 },
  planDayCellCompact: { flex: 0.58 },
  planPatientCellCompact: { flex: 1.65 },
  planDepartmentCellCompact: { flex: 0.52, textAlign: "center", paddingHorizontal: 1 },
  planOperationCellCompact: { flex: 1, paddingHorizontal: 2, fontSize: 9, lineHeight: 12 },
	planPreviousCellCompact: { flex: 1.15, minWidth: 64 },
  planPreviousButton: {
    flex: 1,
    minHeight: 32,
    paddingHorizontal: 5,
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.primarySoft
  },
	planHistoryButtons: { flex: 1, gap: 3 },
  planPreviousButtonText: {
    color: colors.primary,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800"
  },
  planPrimaryText: {
    paddingHorizontal: 5,
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "700"
  },
  planEditorShell: { flex: 1, minHeight: 0 },
  planEditorScroll: { flex: 1, minHeight: 0 },
  planEditorContent: {
    padding: 12,
    paddingBottom: 24,
    gap: 8
  },
  planEditorContentDesktop: { padding: 8, gap: 4 },
  planEditorColumns: {
    minHeight: 18,
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  planEditorRow: {
    padding: 14,
    gap: 7,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  planEditorRowDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    padding: 5
  },
  planEditorHeader: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  planEditorHeaderDesktop: {
    width: 58,
    flexShrink: 0,
    minHeight: 34,
    justifyContent: "space-between",
    alignItems: "center"
  },
  planEditorNumber: { color: colors.primary, fontSize: 13 },
  planEditorField: { minWidth: 0, gap: 5 },
  planDesktopControl: { minHeight: 34, height: 34 },
  planEditorPatientField: { flex: 1.55 },
  planEditorDepartmentField: { flex: 0.9 },
  planEditorOperationField: { flex: 1.25 },
  planEditorAdditionsField: { flex: 1.2 },
  planEditorHistoryField: { flex: 1.2 },
  planEditorHistoryValue: {
    minHeight: 42,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceSoft
  },
  planEditorHistoryText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600"
  },
  planPatientInput: {
    minHeight: 42,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    backgroundColor: colors.canvasRaised,
    fontSize: 15
  },
  planInputHint: {
    marginTop: 5,
    ...typography.meta,
    color: colors.textDim
  },
  planAdditionsInput: {
    minHeight: 74,
    paddingTop: 11,
    paddingBottom: 11,
    textAlignVertical: "top"
  },
  planFieldLabel: {
    marginTop: 1,
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  planSelect: {
    minHeight: 42,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvasRaised
  },
  planSelectText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "600"
  },
  planOperationControlRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  planOperationSelect: { flex: 1, minWidth: 0 },
  planAddOperationButton: {
    width: 38,
    minHeight: 38,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  planOptions: {
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvasRaised
  },
  planOption: {
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  planOptionText: { color: colors.textMuted, fontSize: 13 },
  planEditorActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8
  },
  planEditorFooter: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.surface
  },
  planEditorFooterDesktop: {
    minHeight: 54,
    paddingVertical: 5
  },
  previousProtocolContent: { padding: 16, paddingBottom: 32 },
  planShareOptions: { padding: 16, gap: 8 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginBottom: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceSoft
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft
  },
  drawerRoot: {
    flex: 1,
    alignItems: "flex-start",
    backgroundColor: "rgba(3,7,11,0.54)"
  },
  drawer: {
    width: 350,
    maxWidth: "88%",
    height: "100%",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 22,
    backgroundColor: colors.canvasRaised,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    ...shadow
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18
  },
  drawerBrand: { flexDirection: "row", alignItems: "center", gap: 9 },
  drawerProfileCopy: { flex: 1, minWidth: 0 },
  drawerStatuses: { gap: 7 },
  drawerMenu: {
    gap: 6,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft
  },
  drawerItem: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft
  },
  drawerItemText: { ...typography.label, color: colors.text, flex: 1 },
  drawerFooter: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 18
  },
  filterSheetContent: { padding: 14, gap: 6 },
  filterSectionTitle: {
    ...typography.meta,
    color: colors.textDim,
    marginTop: 5,
    marginBottom: 2,
    letterSpacing: 0.7
  },
  filterSortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 7
  },
  filterOption: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceSoft
  },
  filterOptionSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.32)"
  },
  filterOptionText: { ...typography.label, color: colors.textMuted },
  filterOptionTextSelected: { color: colors.primary },
  mobileNavSafe: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 10,
    zIndex: 50,
    elevation: 20,
    backgroundColor: colors.canvas,
    paddingHorizontal: 10,
    paddingTop: 0,
    paddingBottom: 0
  },
  mobileNavSafeDark: { backgroundColor: darkColors.canvas },
  mobileNav: {
    height: 48,
    flexDirection: "row",
    paddingHorizontal: 2,
    paddingVertical: 2,
    backgroundColor: "transparent"
  },
  mobileNavDark: { backgroundColor: "transparent" },
  mobileNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minWidth: 0,
    borderRadius: 17
  },
  mobileNavItemDark: { backgroundColor: "transparent" },
  mobileNavItemActive: {
    marginVertical: 1,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.86)",
    transform: [{ scale: 1.02 }]
  },
  mobileNavItemActiveDark: { backgroundColor: darkColors.primarySoft },
  mobileNavItemPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.92 }]
  },
  mobileNavText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "600",
    color: colors.textDim
  },
  mobileNavTextDark: { color: darkColors.textDim },
  mobileNavTextActive: { color: darkColors.primary },
  scheduleScreen: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  scheduleToolbar: {
    minHeight: 62,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  scheduleMonthButtons: { flexDirection: "row", alignItems: "center", gap: 6 },
  schedulePage: { flex: 1, minHeight: 0 },
  schedulePageContent: { paddingHorizontal: 18, paddingBottom: 30, gap: 14 },
  dutyTodayCard: {
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 8
  },
  dutyTodayTitle: { ...typography.title, color: colors.text, marginBottom: 2 },
  dutyTodayRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  dutyTodayName: { ...typography.label, color: colors.text },
  dutyTodayMeta: { ...typography.meta, color: colors.primary },
  scheduleGroupTabs: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  scheduleViewActions: { flexDirection: "row", justifyContent: "flex-end" },
  scheduleEditorPanel: { gap: 12, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  scheduleEditorTopRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14 },
  scheduleHolidayTools: { flex: 1, maxWidth: 430, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  scheduleEditorActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  scheduleNormBadge: { minWidth: 116, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.primarySoft },
  scheduleNormLabel: { ...typography.meta, color: colors.textDim },
  scheduleNorm: { ...typography.label, color: colors.primary, marginTop: 2 },
  scheduleShiftTools: { gap: 9, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  scheduleToolsTitle: { ...typography.label, color: colors.text },
  scheduleToolChips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  scheduleLegend: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scheduleLegendItem: { ...typography.meta, color: colors.textMuted, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.surfaceSoft },
  scheduleLegendValue: { fontWeight: "800", color: colors.primary },
  scheduleGridShell: { flexDirection: "row", width: "100%", minHeight: 0, paddingBottom: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.surfaceSoft },
  scheduleNamesColumn: { width: 142, flexShrink: 0, borderRightWidth: 2, borderRightColor: "rgba(11,132,179,0.30)" },
  scheduleNamesColumnCompact: { width: 116 },
  scheduleNameHeader: { width: "100%", paddingHorizontal: 10, alignItems: "flex-start", backgroundColor: colors.surfaceSoft },
  scheduleNameHeaderText: { ...typography.meta, fontWeight: "800", color: colors.textMuted },
  scheduleStaffBlock: { height: 84, minHeight: 84, maxHeight: 84, paddingHorizontal: 10, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "rgba(11,132,179,0.24)", backgroundColor: colors.surface },
  scheduleTimelineScroll: { flex: 1, minWidth: 0 },
  scheduleTimelineContent: {},
  scheduleTimelineGrid: { overflow: "hidden" },
  scheduleGridRow: { flexDirection: "row", height: 42, minHeight: 42, maxHeight: 42 },
  scheduleSurgeonEndCell: { borderBottomWidth: 2, borderBottomColor: "rgba(11,132,179,0.24)" },
  scheduleCell: {
    width: 42,
    height: 42,
    minHeight: 42,
    maxHeight: 42,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  scheduleDayHeader: { ...typography.meta, color: colors.textMuted, textAlign: "center", paddingTop: 13 },
  scheduleHolidayCell: { backgroundColor: "rgba(11,132,179,0.12)", color: colors.primary },
  scheduleTodayCell: { backgroundColor: "rgba(83,103,118,0.12)", borderColor: "rgba(83,103,118,0.20)", color: colors.text },
  scheduleTodayText: { color: colors.text },
  scheduleStaffName: { ...typography.label, color: colors.text, maxWidth: "100%", lineHeight: 17 },
  scheduleShiftCell: { backgroundColor: colors.surface },
  scheduleShiftText: { ...typography.label, color: colors.primary },
  scheduleTotalHeader: { width: 54, ...typography.meta, color: colors.textMuted, paddingTop: 13 },
  scheduleTotalCell: { width: 54, backgroundColor: colors.surface },
  scheduleTotalReached: { backgroundColor: "rgba(11,132,179,0.14)" },
  scheduleEmptyGroup: { width: 420, padding: 20 }
});
