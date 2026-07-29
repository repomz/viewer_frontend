import { StatusBar } from "expo-status-bar";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Alert,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import {
  ApiError,
  checkHealth,
  createUserRequest,
  deleteAllUserRequests,
  deleteReport,
  deleteStudy,
  deleteUserRequest,
  getAgentHeartbeatTimes,
  getAgents,
  getReports,
  getStudies,
  getUserRequests,
  getUserRequest,
  searchStudies
} from "./src/api";
import { MobileDicomViewer } from "./src/MobileDicomViewer";
import { isPacsImagingStudy } from "./src/studyClassification";
import {
  defaultSettings,
  loadRequests,
  loadSettings,
  saveRequests,
  saveSettings
} from "./src/storage";
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
  OperationsReport,
  OperationPlan,
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

type Tab = "studies" | "plan" | "angiography" | "requests" | "reports" | "settings";
type ToastState = { message: string; tone: "success" | "danger" } | null;
type DayFilter = "all" | "1" | "2" | "3" | "4" | "5";
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
    id: "requests",
    label: "Задания",
    shortLabel: "Задания",
    icon: "pulse-outline"
  },
  {
    id: "reports",
    label: "Отчёты",
    shortLabel: "Отчёты",
    icon: "document-text-outline"
  }
];

const dayFilters: { id: DayFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "1", label: "Пн" },
  { id: "2", label: "Вт" },
  { id: "3", label: "Ср" },
  { id: "4", label: "Чт" },
  { id: "5", label: "Пт" }
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
  get_report: "Получить отчёт",
  get_plan: "Получить оперативный план",
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
  "find_study",
  "find_xa",
  "find_ct",
  "get_xa",
  "get_ct",
  "get_report",
  "get_plan",
  "xa_polling_on",
  "xa_polling_off",
  "ct_polling_on",
  "ct_polling_off"
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

function patientKey(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").split(/\s+/)[0] ?? "";
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
    ["План на сегодня", data.today_planned_operations ?? []]
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

function SwipeableCard({
  children,
  onDelete,
  onForward
}: {
  children: ReactNode;
  onDelete: () => void;
  onForward: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [cardWidth, setCardWidth] = useState(360);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dx < -12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_event, gesture) => {
          translateX.setValue(Math.max(-cardWidth, Math.min(0, gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -cardWidth * 0.72) {
            Animated.timing(translateX, {
              toValue: -cardWidth,
              duration: 180,
              useNativeDriver: Platform.OS !== "web"
            }).start(onDelete);
            return;
          }
          Animated.spring(translateX, {
            toValue: gesture.dx < -cardWidth * 0.18 ? -132 : 0,
            useNativeDriver: Platform.OS !== "web"
          }).start();
        }
      }),
    [cardWidth, onDelete, translateX]
  );
  const close = () =>
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: Platform.OS !== "web"
    }).start();
  return (
    <View
      onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
      style={styles.swipeContainer}
    >
      <View style={styles.swipeActions}>
        <Pressable style={styles.swipeForward} onPress={() => {
          close();
          onForward();
        }}>
          <Icon name="share-outline" color="#fff" />
          <Text style={styles.swipeActionText}>Переслать</Text>
        </Pressable>
        <Pressable style={styles.swipeDelete} onPress={() => {
          close();
          onDelete();
        }}>
          <Icon name="trash-outline" color="#fff" />
          <Text style={styles.swipeActionText}>Удалить</Text>
        </Pressable>
      </View>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.swipeForeground, { transform: [{ translateX }] }]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const compact = width < layout.mobileBreakpoint;
  const [activeTab, setActiveTab] = useState<Tab>("studies");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [studies, setStudies] = useState<Study[]>([]);
  const [studiesLoading, setStudiesLoading] = useState(true);
  const [studiesError, setStudiesError] = useState("");
  const [search, setSearch] = useState("");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [category, setCategory] = useState<StudyCategory>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [xaStudies, setXaStudies] = useState<Study[]>([]);
  const [xaLoading, setXaLoading] = useState(false);
  const [xaError, setXaError] = useState("");
  const [requests, setRequests] = useState<UserRequest[]>(loadRequests);
  const [reports, setReports] = useState<ReportDocument[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [agentHealthById, setAgentHealthById] = useState<
    Record<number, AgentHealth>
  >({});
  const [commandOpen, setCommandOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [plan, setPlan] = useState<OperationPlan | null>(null);
  const processedCompletions = useRef(new Set<string>());
  const [toast, setToast] = useState<ToastState>(null);

  const loadStudies = useCallback(async () => {
    setStudiesError("");
    setStudiesLoading(true);
    try {
      const response = await getStudies();
      setStudies(response);
      const protocols = response.filter((study) => !isPacsImagingStudy(study));
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
    setXaLoading(true);
    try {
      const [xa, ct] = await Promise.all([
        searchStudies({ studyType: "xa" }),
        searchStudies({ studyType: "ct" })
      ]);
      setXaStudies(
        [...xa, ...ct]
          .filter(isPacsImagingStudy)
          .sort(
            (left, right) =>
              new Date(right.time_beginning).getTime() -
              new Date(left.time_beginning).getTime()
          )
      );
    } catch (error) {
      setXaError(errorMessage(error));
    } finally {
      setXaLoading(false);
    }
  }, []);

  const loadRequestHistory = useCallback(async () => {
    try {
      const response = await getUserRequests(settings.userId, settings.agentId);
      setRequests(response);
      saveRequests(response);
    } catch {
      // Offline/mobile fallback remains the local request cache.
    }
  }, [settings.agentId, settings.userId]);

  const loadReports = useCallback(async () => {
    setReportsError("");
    setReportsLoading(true);
    try {
      setReports(await getReports());
    } catch (error) {
      setReportsError(errorMessage(error));
    } finally {
      setReportsLoading(false);
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
    void loadStudies();
    void loadXAStudies();
    void loadRequestHistory();
    refreshConnectivity();
  }, [loadRequestHistory, loadStudies, loadXAStudies, refreshConnectivity]);

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
    const timer = setInterval(refreshConnectivity, 30_000);
    return () => clearInterval(timer);
  }, [refreshConnectivity]);

  useEffect(() => {
    if (activeTab === "reports") {
      void loadReports();
    }
    if (activeTab === "angiography") {
      void loadXAStudies();
    }
  }, [activeTab, loadReports, loadXAStudies]);

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
      backgroundColor: colors.canvas,
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
  }, [requests]);

  useEffect(() => {
    const newlyCompleted = requests.filter(
      (request) =>
        request.status === "completed" &&
        !processedCompletions.current.has(request.id)
    );
    newlyCompleted.forEach((request) => processedCompletions.current.add(request.id));
    if (newlyCompleted.some((request) =>
      ["import_study", "get_xa", "get_ct", "send_xa_to_pacs", "send_ct_to_pacs"]
        .includes(request.command)
    )) {
      void loadStudies();
      void loadXAStudies();
    }
  }, [loadStudies, loadXAStudies, requests]);

  useEffect(() => {
    const latest = requests.find(
      (request) => request.command === "get_plan" && request.status === "completed"
    );
    if (latest) setPlan(parseObject(latest.result) as OperationPlan);
  }, [requests]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const protocolStudies = useMemo(
    () => studies.filter((study) => !isPacsImagingStudy(study)),
    [studies]
  );

  const filteredStudies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    return protocolStudies.filter((study) => {
      const date = new Date(study.time_beginning);
      const weekday = Number.isNaN(date.getTime()) ? 0 : date.getDay();
      if (dayFilter !== "all" && weekday !== Number(dayFilter)) return false;
      if (category !== "all" && studyCategory(study) !== category) return false;
      if (!query) return true;
      return [
        study.patient,
        study.name_operation,
        study.surgeon,
        study.department,
        study.study_id
      ].some((value) => value.toLocaleLowerCase("ru").includes(query));
    });
  }, [category, dayFilter, protocolStudies, search]);

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
        setCommandOpen(false);
        setToast({
          message: "Задание передано больничному агенту",
          tone: "success"
        });
        return true;
      } catch (error) {
        setToast({ message: errorMessage(error), tone: "danger" });
        return false;
      }
    },
    [recordRequest, settings]
  );

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
        userId: next.userId.trim() || defaultSettings.userId
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

  const removeStudy = useCallback(async (study: Study) => {
    try {
      await deleteStudy(study.id);
      setStudies((current) => current.filter((item) => item.id !== study.id));
      setSelectedStudy(null);
      setToast({ message: "Протокол удалён", tone: "success" });
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

  const primaryAgentHealth =
    agentHealthById[settings.agentId] ??
    ({ online: false, status: "unknown" } satisfies AgentHealth);

  const switchTab = useCallback((direction: -1 | 1) => {
    const current = tabs.findIndex((tab) => tab.id === activeTab);
    const next = current + direction;
    if (next >= 0 && next < tabs.length) setActiveTab(tabs[next]!.id);
  }, [activeTab]);

  const pageSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          compact &&
          Math.abs(gesture.dx) > 24 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -70) switchTab(1);
          if (gesture.dx > 70) switchTab(-1);
        }
      }),
    [compact, switchTab]
  );

  const isAngiography = activeTab === "angiography";

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.safeArea, isAngiography && styles.safeAreaDark]}
        edges={compact ? ["top"] : []}
      >
        <StatusBar style={isAngiography ? "light" : "dark"} />
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
              {...(compact ? pageSwipe.panHandlers : {})}
              style={[styles.content, isAngiography && styles.contentDark]}
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
                  dayFilter={dayFilter}
                  category={category}
                  selected={selectedStudy}
                  onSearch={setSearch}
                  onDayFilter={setDayFilter}
                  onFilter={() => setFilterOpen(true)}
                  onSelect={setSelectedStudy}
                  onRetry={() => void loadStudies()}
                  onRefresh={() => void loadStudies()}
                  onRequestStudy={(study, command) =>
                    void submitCommand(command, { study_uid: study.study_id })
                  }
                  angiographies={xaStudies}
                  onDelete={(study) => void removeStudy(study)}
                />
              ) : null}
              {activeTab === "angiography" ? (
                <AngiographyScreen
                  compact={compact}
                  studies={xaStudies}
                  loading={xaLoading}
                  error={xaError}
                  onRetry={() => void loadXAStudies()}
                />
              ) : null}
              {activeTab === "requests" ? (
                <RequestsScreen
                  compact={compact}
                  requests={requests}
                  studies={studies}
                  onCommand={() => setCommandOpen(true)}
                  onSubmit={submitCommand}
                  onRefresh={async (item) => {
                    try {
                      recordRequest(await getUserRequest(item.id));
                      void loadStudies();
                      void loadXAStudies();
                    } catch (error) {
                      setToast({
                        message: errorMessage(error),
                        tone: "danger"
                      });
                    }
                  }}
                  onDelete={(item) => void removeRequest(item)}
                  onDeleteAll={async () => {
                    try {
                      await deleteAllUserRequests(settings.userId, settings.agentId);
                      setRequests([]);
                      saveRequests([]);
                    } catch (error) {
                      setToast({ message: errorMessage(error), tone: "danger" });
                    }
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
                  onRequest={() =>
                    void submitCommand("get_report", { period: 1 })
                  }
                  onDelete={(report) => void removeReport(report)}
                  onForward={(report) => void shareReport(report)}
                />
              ) : null}
              {activeTab === "settings" ? (
                <SettingsScreen
                  settings={settings}
                  health={health}
                  agentHealthById={agentHealthById}
                  onSave={saveAppSettings}
                  onCheck={refreshConnectivity}
                />
              ) : null}
              {activeTab === "plan" ? (
                <PlanScreen
                  plan={plan}
                  onRequest={(date) =>
                    void submitCommand("get_plan", date ? { date } : {})
                  }
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
        />
        <StudyFilterSheet
          visible={filterOpen}
          selected={category}
          onClose={() => setFilterOpen(false)}
          onSelect={(value) => {
            setCategory(value);
            setFilterOpen(false);
          }}
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
  const active = tabs.find((item) => item.id === activeTab) ?? tabs[0]!;
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
        <IconButton icon="menu" label="Меню" onPress={onMenu} />
        <View style={[styles.mobileTitlePill, dark && styles.healthPillDark]}>
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
        <IconButton icon="menu" label="Меню" onPress={onMenu} />
        <View style={styles.headerBrandMark}>
          <Icon name="scan" size={18} color={darkColors.primary} />
        </View>
        <Text style={[styles.headerBrandText, dark && styles.textDark]}>
          VIEWER
        </Text>
      </View>
      <View style={styles.desktopTabBar}>
        {tabs.map((tab) => {
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
                selected && styles.desktopTabButtonActive
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
                    ? colors.primary
                    : dark
                      ? darkColors.textMuted
                      : colors.textMuted
                }
              />
              <Text
                style={[
                  styles.desktopTabText,
                  dark && styles.textMutedDark,
                  selected && styles.desktopTabTextActive
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
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.mobileNavSafe, dark && styles.mobileNavSafeDark]}
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
    </SafeAreaView>
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
  dayFilter,
  category,
  selected,
  onSearch,
  onDayFilter,
  onFilter,
  onSelect,
  onRetry,
  onRefresh,
  onRequestStudy,
  angiographies,
  onDelete
}: {
  compact: boolean;
  inlineDetail: boolean;
  studies: Study[];
  total: number;
  loading: boolean;
  error: string;
  search: string;
  dayFilter: DayFilter;
  category: StudyCategory;
  selected: Study | null;
  onSearch: (value: string) => void;
  onDayFilter: (value: DayFilter) => void;
  onFilter: () => void;
  onSelect: (study: Study | null) => void;
  onRetry: () => void;
  onRefresh: () => void;
  onRequestStudy: (study: Study, command: "get_ct" | "get_xa") => void;
  angiographies: Study[];
  onDelete: (study: Study) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const choose = (study: Study) => {
    onSelect(study);
    if (!inlineDetail) setDetailOpen(true);
  };

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View style={[styles.studyToolbar, compact && styles.studyToolbarCompact]}>
        <SearchField
          value={search}
          onChangeText={onSearch}
          placeholder={compact ? "Поиск пациента" : "Пациент, хирург, операция или ID"}
          filterActive={category !== "all"}
          onFilter={onFilter}
        />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Фильтр по типу операции"
            onPress={onFilter}
            style={[
              styles.filterChipButton,
              category !== "all" && styles.filterChipButtonActive
            ]}
          >
            <Icon
              name="options-outline"
              size={17}
              color={category !== "all" ? colors.primary : colors.textMuted}
            />
          </Pressable>
        </ScrollView>
      </View>

      {error ? <InlineError message={error} onRetry={onRetry} /> : null}

      <View style={styles.studyWorkspace}>
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
              {studies.map((study, index) => (
                <SwipeableCard key={study.id} onDelete={() => onDelete(study)}
                  onForward={() => void Share.share({
                    title: `Протокол операции — ${study.patient}`,
                    message: `${study.patient}\n${study.name_operation}\n\n${study.descr_operation}`
                  })}>
                  <StudyRow
                    study={study}
                    index={index}
                    compact={compact}
                    selected={selected?.id === study.id}
                    hasXA={angiographies.some((item) =>
                      patientKey(item.patient) === patientKey(study.patient) &&
                      item.study_type.toLowerCase() === "xa"
                    )}
                    onPress={() => choose(study)}
                  />
                </SwipeableCard>
              ))}
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
              <StudyDetails study={selected} onRequest={onRequestStudy} />
            ) : (
              <EmptyState
                icon="reader-outline"
                title="Выберите пациента"
                description="Полный протокол операции появится здесь."
              />
            )}
          </ScrollView>
        ) : null}
      </View>

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
              <StudyDetails study={selected} onRequest={onRequestStudy} />
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
  hasXA
}: {
  study: Study;
  index: number;
  compact: boolean;
  selected: boolean;
  onPress: () => void;
  hasXA: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${study.patient}, ${study.name_operation}`}
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
            {study.patient}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.studyOperation}>
          {study.name_operation}
        </Text>
      </View>
      <View style={styles.studyTrailing}>
        <Text style={styles.studyDateCompact}>{formatDate(study.time_beginning)}</Text>
        <View style={[styles.xaState, !hasXA && styles.xaStateInactive]}>
          <Text style={[styles.xaStateText, !hasXA && styles.xaStateTextInactive]}>XA</Text>
        </View>
      </View>
    </Pressable>
  );
}

function StudyDetails({
  study,
  onRequest
}: {
  study: Study;
  onRequest: (study: Study, command: "get_ct" | "get_xa") => void;
}) {
  const type = study.study_type.toUpperCase();
  const preferredCommand: "get_ct" | "get_xa" =
    type.includes("CT") ? "get_ct" : "get_xa";

  return (
    <View style={styles.detailsCard}>
      <View style={styles.detailsHero}>
        <View style={styles.detailsIcon}>
          <Icon name="reader-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.detailsHeroCopy}>
          <Text style={styles.detailsPatient}>{study.patient}</Text>
          <Text style={styles.detailsSubtitle}>
            {study.age ? `${study.age} лет` : "Возраст не указан"} · ID{" "}
            {study.study_id}
          </Text>
        </View>
        <Badge label={type || "ПРОТОКОЛ"} />
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
        <Text style={styles.detailHeading}>{study.name_operation}</Text>
      </View>

      <View style={styles.protocolSection}>
        <Text style={styles.detailLabel}>ПОЛНЫЙ ПРОТОКОЛ ОПЕРАЦИИ</Text>
        <Text style={styles.detailDescription}>
          {study.descr_operation || "Описание пока не добавлено."}
        </Text>
      </View>

      <View style={styles.detailsActions}>
        {!study.dicom_link ? (
          <Button
            label={`Запросить ${preferredCommand === "get_ct" ? "CT" : "XA"}`}
            icon="cloud-download-outline"
            onPress={() => onRequest(study, preferredCommand)}
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
  onRetry
}: {
  compact: boolean;
  studies: Study[];
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const [selected, setSelected] = useState<Study | null>(studies[0] ?? null);
  const [mobileViewer, setMobileViewer] = useState(false);
  const [studyFilter, setStudyFilter] = useState<"all" | "xa" | "ct" | "week">(
    "all"
  );
  useEffect(() => {
    if (!selected && studies[0]) setSelected(studies[0]);
  }, [selected, studies]);

  const choose = (study: Study) => {
    if (!compact) return;
    setSelected(study);
    setMobileViewer(true);
  };

  const now = new Date();
  const monday = new Date(now);
  const day = (now.getDay() + 6) % 7;
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day);
  const visibleStudies = studies.filter((study) => {
    const modality = study.study_type.toLowerCase();
    if (studyFilter === "xa" || studyFilter === "ct") {
      return modality === studyFilter;
    }
    if (studyFilter === "week") {
      return new Date(study.time_beginning).getTime() >= monday.getTime();
    }
    return true;
  });

  return (
    <View style={styles.angioScreen}>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading ? (
        <LoadingState label="Проверяем XA-исследования…" />
      ) : studies.length ? (
        <>
          <View
            style={[
              styles.angioFilters,
              compact && styles.angioFiltersCompact
            ]}
          >
            {([
              ["all", "Все"],
              ["week", "Неделя"],
              ["xa", "XA"],
              ["ct", "CT"]
            ] as const).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setStudyFilter(value)}
                style={[
                  styles.angioFilter,
                  studyFilter === value && styles.angioFilterActive
                ]}
              >
                <Text
                  style={[
                    styles.angioFilterText,
                    studyFilter === value && styles.angioFilterTextActive
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
            <View
              style={[
                styles.angioAutoStatus,
                compact && styles.angioAutoStatusCompact
              ]}
            >
              <Icon name="cloud-done-outline" size={16} color={colors.success} />
              <Text style={styles.angioAutoStatusText}>
                {compact
                  ? "Автодоставка Yandex → PACS"
                  : "Yandex → PACS автоматически"}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.angioWorkspace,
              compact && styles.angioWorkspaceCompact
            ]}
          >
            <ScrollView
              style={[styles.angioList, compact && styles.angioListCompact]}
              contentContainerStyle={styles.angioListContent}
              showsVerticalScrollIndicator={false}
            >
              {visibleStudies.map((study, index) => (
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
                    compact &&
                      selected?.id === study.id &&
                      styles.angioRowSelected
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
                    </Text>
                  </View>
                  <View style={styles.angioStored}>
                    <Icon
                      name="cloud-done-outline"
                      size={15}
                      color={colors.success}
                    />
                  </View>
                  <Icon
                    name={compact ? "chevron-forward" : "server-outline"}
                    size={17}
                    color={darkColors.textDim}
                  />
                </Pressable>
              ))}
              {!visibleStudies.length ? (
                <Text style={styles.angioNoFilterResults}>
                  В этом разделе исследований пока нет.
                </Text>
              ) : null}
            </ScrollView>
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
                  <MobileDicomViewer studyUID={selected.study_id} />
                </View>
                <View style={styles.mobileViewerTop}>
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
                  <View style={styles.mobileViewerModality}>
                    <Text style={styles.mobileViewerModalityText}>
                      {selected.study_type.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}

function RequestsScreen({
  compact,
  requests,
  studies,
  onCommand,
  onSubmit,
  onRefresh,
  onDelete,
  onDeleteAll
}: {
  compact: boolean;
  requests: UserRequest[];
  studies: Study[];
  onCommand: () => void;
  onSubmit: (
    command: AgentCommand,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  onRefresh: (request: UserRequest) => void;
  onDelete: (request: UserRequest) => void;
  onDeleteAll: () => void;
}) {
  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View style={styles.compactScreenToolbar}>
        <View>
          <Text style={styles.compactScreenTitle}>История заданий</Text>
          <Text style={styles.compactScreenMeta}>{requests.length} записей</Text>
        </View>
        <View style={styles.compactToolbarActions}>
          <IconButton icon="add" label="Новое задание" onPress={onCommand} />
        {requests.length ? (
          <IconButton
            icon="trash-outline"
            label="Очистить историю заданий"
            onPress={() => confirmDeleteAll(
              "Удалить всю историю заданий этого пользователя?",
              onDeleteAll
            )}
          />
        ) : null}
        </View>
      </View>
      <ScrollView
        style={styles.flexScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.requestScrollContent}
      >
        {requests.length ? (
        <View style={styles.requestList}>
          {requests.map((request) => (
            <SwipeableCard key={request.id} onDelete={() => onDelete(request)}
              onForward={() => void Share.share({
                title: commandLabels[request.command] ?? request.command,
                message: JSON.stringify(parseObject(request.result), null, 2)
              })}>
              <RequestCard
                compact={compact}
                request={request}
                studies={studies}
                onSubmit={onSubmit}
                onRefresh={() => onRefresh(request)}
              />
            </SwipeableCard>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="pulse-outline"
          title="Заданий пока нет"
          description="Создайте запрос на поиск протокола, XA/CT или получение отчёта."
          action={<Button label="Создать задание" onPress={onCommand} />}
        />
        )}
      </ScrollView>
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
                <Text style={styles.resultProtocol}>
                  {String(
                    protocol.descr_operation ?? "Описание протокола отсутствует"
                  )}
                </Text>
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
                      {String(study.patient ?? "Пациент не указан")}
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
  onRequest,
  onDelete,
  onForward
}: {
  compact: boolean;
  reports: ReportDocument[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onRequest: () => void;
  onDelete: (report: ReportDocument) => void;
  onForward: (report: ReportDocument) => void;
}) {
  const [selected, setSelected] = useState<ReportDocument | null>(
    reports[0] ?? null
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!selected && reports[0]) setSelected(reports[0]);
  }, [reports, selected]);

  const choose = (report: ReportDocument) => {
    setSelected(report);
    if (compact) setMobileOpen(true);
  };

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View style={styles.compactScreenToolbar}>
        <View>
          <Text style={styles.compactScreenTitle}>Отчёты дежурств</Text>
          <Text style={styles.compactScreenMeta}>Смахните влево для действий</Text>
        </View>
        <IconButton
          icon="refresh"
          label="Обновить отчёты"
          onPress={onRequest}
        />
      </View>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading ? (
        <LoadingState label="Загружаем отчёты…" />
      ) : reports.length ? (
        <View style={styles.reportWorkspace}>
          <ScrollView
            style={styles.reportList}
            contentContainerStyle={styles.reportListContent}
            showsVerticalScrollIndicator={false}
          >
            {reports.map((report, index) => (
              <SwipeableCard
                key={report.filename ?? `${report.generated_at}-${index}`}
                onDelete={() => onDelete(report)}
                onForward={() => onForward(report)}
              >
                <ReportRow
                  report={report}
                  selected={selected?.filename === report.filename}
                  compact={compact}
                  onPress={() => choose(report)}
                  onDelete={() => onDelete(report)}
                  onForward={() => onForward(report)}
                />
              </SwipeableCard>
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
          description="Запросите формирование отчёта у больничного агента."
          action={<Button label="Запросить отчёт" onPress={onRequest} />}
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
  const total =
    Number(data.emergency_total ?? 0) + Number(data.planned_count ?? 0);
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
          {data.period_days ?? 1} сут. · {total} операций
        </Text>
      </View>
      {compact ? (
        <Icon name="chevron-forward" size={17} color={colors.textDim} />
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
          label="План на сегодня"
          value={data.today_planned_count ?? 0}
          active={section === "today"}
          onPress={() => setSection("today")}
        />
      </View>
      {section === "emergency" ? <ReportSection title="Экстренные операции"
        operations={data.emergency_operations ?? []} /> : null}
      {section === "planned" ? <ReportSection title="Плановые операции"
        operations={data.planned_operations ?? []} /> : null}
      {section === "today" ? <ReportSection title="План на сегодня"
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
  return (
    <View style={styles.reportSection}>
      <Text style={styles.reportSectionTitle}>
        {title} · {operations.length}
      </Text>
      <View style={styles.operationTable}>
        {operations.map((operation, index) => (
          <View key={`${operation.patient}-${index}`} style={styles.operationRow}>
            <Text style={styles.operationNumber}>
              {String(index + 1).padStart(2, "0")}
            </Text>
            <View style={styles.operationCopy}>
              <View style={styles.operationTitleLine}>
                <Text style={styles.operationPatient}>
                  {operation.patient || "ФИО не указано"}
                </Text>
                <Text style={styles.operationTime}>
                  {operation.time_beginning || "—"}
                </Text>
              </View>
              <Text style={styles.operationName}>
                {operation.operation || "Операция не указана"}
              </Text>
              <Text style={styles.operationMeta}>
                {operation.age ? `${operation.age} лет · ` : ""}
                {operation.department || "отделение не указано"} ·{" "}
                {operation.surgeon || "хирург не указан"}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function PlanScreen({
  plan,
  onRequest
}: {
  plan: OperationPlan | null;
  onRequest: (date?: string) => void;
}) {
  const [mode, setMode] = useState<"week" | "day">("week");
  const [selectedDate, setSelectedDate] = useState(
    plan?.selected_date ?? new Date().toISOString().slice(0, 10)
  );
  const days = plan?.days ?? [];
  const visibleDays = mode === "week"
    ? days
    : days.filter((day) => day.date === selectedDate);
  return (
    <ScrollView style={styles.screen}
      contentContainerStyle={styles.planContent}
      showsVerticalScrollIndicator={false}>
      <View style={styles.listActions}>
        <Chip label="Неделя" selected={mode === "week"} onPress={() => setMode("week")} />
        <Chip label="День" selected={mode === "day"} onPress={() => setMode("day")} />
        <IconButton
          icon="refresh"
          label="Обновить план"
          onPress={() => onRequest(mode === "day" ? selectedDate : undefined)}
        />
      </View>
      {mode === "day" ? (
        <Field label="Дата" value={selectedDate} onChangeText={setSelectedDate}
          placeholder="YYYY-MM-DD" />
      ) : null}
      {!days.length ? (
        <EmptyState icon="calendar-outline" title="План ещё не загружен"
          description="Обновите данные из недельного файла «План Отчёты» больничного агента."
          action={<Button label="Обновить" icon="refresh" onPress={() => onRequest()} />} />
      ) : (
        <View style={styles.planDays}>
          {visibleDays.map((day) => (
            <View key={day.date} style={styles.planDay}>
              <View style={styles.planDayHeader}>
                <Text style={styles.planDayTitle}>{formatDate(day.date)}</Text>
                <Badge label={`${day.operations.length} пациентов`} tone="neutral" />
              </View>
              {day.operations.length ? day.operations.map((operation, index) => (
                <View key={`${operation.patient}-${index}`} style={styles.operationRow}>
                  <Text style={styles.operationNumber}>{String(index + 1).padStart(2, "0")}</Text>
                  <View style={styles.operationCopy}>
                    <Text style={styles.operationPatient}>{operation.patient || "Пациент не указан"}</Text>
                    <Text style={styles.operationName}>{operation.operation || "Операция не указана"}</Text>
                    <Text style={styles.operationMeta}>
                      {operation.age != null ? `${operation.age} лет · ` : ""}
                      {operation.department || "отделение не указано"}
                    </Text>
                  </View>
                </View>
              )) : (
                <Text style={styles.emptyDayText}>Операций нет</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function MobileMenu({
  visible,
  settings,
  health,
  agentHealth,
  onClose,
  onSettings
}: {
  visible: boolean;
  settings: AppSettings;
  health: ApiHealth | null;
  agentHealth: AgentHealth;
  onClose: () => void;
  onSettings: () => void;
}) {
  const translateX = useRef(new Animated.Value(-380)).current;

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
          style={[styles.drawer, { transform: [{ translateX }] }]}
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
              style={({ pressed }) => [
                styles.drawerItem,
                pressed && styles.pressed
              ]}
              onPress={() => {
                onClose();
                void Linking.openURL(
                  process.env.EXPO_PUBLIC_OHIF_URL ??
                    "http://135.106.130.37:3000"
                );
              }}
            >
              <Icon name="desktop-outline" color={colors.textMuted} />
              <Text style={styles.drawerItemText}>OHIF Viewer</Text>
              <Icon name="open-outline" size={17} color={colors.textDim} />
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
  onClose,
  onSelect
}: {
  visible: boolean;
  selected: StudyCategory;
  onClose: () => void;
  onSelect: (value: StudyCategory) => void;
}) {
  return (
    <Sheet visible={visible} title="Тип операции" onClose={onClose}>
      <View style={styles.filterSheetContent}>
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
      </View>
    </Sheet>
  );
}

function SettingsScreen({
  settings,
  health,
  agentHealthById,
  onSave,
  onCheck
}: {
  settings: AppSettings;
  health: ApiHealth | null;
  agentHealthById: Record<number, AgentHealth>;
  onSave: (settings: AppSettings) => void;
  onCheck: () => void;
}) {
  const [agentIds, setAgentIds] = useState(settings.agentIds);
  const [selectedAgentIds, setSelectedAgentIds] = useState(
    settings.selectedAgentIds
  );
  const [newAgentId, setNewAgentId] = useState("");
  const [userId, setUserId] = useState(settings.userId);

  const addAgent = () => {
    const id = Number.parseInt(newAgentId, 10);
    if (!Number.isInteger(id) || id <= 0 || agentIds.includes(id)) return;
    setAgentIds((current) => [...current, id]);
    setSelectedAgentIds((current) =>
      current.length < 2 ? [...current, id] : current
    );
    setNewAgentId("");
  };

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
      style={styles.screen}
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
          <View style={styles.addAgentRow}>
            <Field
              label="Добавить Agent ID"
              value={newAgentId}
              onChangeText={setNewAgentId}
              keyboardType="number-pad"
              placeholder="Например, 3"
              style={styles.agentIdField}
            />
            <Button
              label="Добавить"
              variant="secondary"
              compact
              onPress={addAgent}
              disabled={!newAgentId.trim()}
            />
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
                userId
              })
            }
          />
        </View>
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
  onClose,
  onSubmit
}: {
  visible: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSubmit: (
    command: AgentCommand,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
}) {
  const [command, setCommand] = useState<AgentCommand>("find_study");
  const [patient, setPatient] = useState("");
  const [studyUID, setStudyUID] = useState("");
  const [period, setPeriod] = useState("1");
  const [planDate, setPlanDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const needsPatient = ["find_study", "find_xa", "find_ct"].includes(command);
  const needsUID = ["get_xa", "get_ct"].includes(command);
  const isReport = command === "get_report";
  const valid =
    (!needsPatient || patient.trim().length >= 2) &&
    (!needsUID || Boolean(studyUID.trim())) &&
    (!isReport || (Number(period) >= 1 && Number(period) <= 4));

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    const payload = needsPatient
      ? { patient: patient.trim() }
      : needsUID
        ? { study_uid: studyUID.trim() }
        : isReport
          ? { period: Number(period) }
          : command === "get_plan" && planDate.trim()
            ? { date: planDate.trim() }
          : {};
    const ok = await onSubmit(command, payload);
    setSubmitting(false);
    if (ok) {
      setPatient("");
      setStudyUID("");
    }
  };

  return (
    <Sheet visible={visible} title="Новое задание агенту" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.commandContent}>
        <View style={styles.commandDestination}>
          <Icon name="hardware-chip-outline" color={colors.primary} />
          <Text style={styles.commandDestinationText}>
            Агент {settings.agentId} · пользователь {settings.userId}
          </Text>
        </View>
        <Text style={styles.commandGroupLabel}>КОМАНДА</Text>
        <View style={styles.commandOptions}>
          {agentCommandOptions.map((item) => (
            <Pressable
              key={item}
              onPress={() => setCommand(item)}
              style={[
                styles.commandOption,
                command === item && styles.commandOptionSelected
              ]}
            >
              <View style={[styles.radio, command === item && styles.radioSelected]}>
                {command === item ? <View style={styles.radioCore} /> : null}
              </View>
              <Text
                style={[
                  styles.commandOptionText,
                  command === item && styles.commandOptionTextSelected
                ]}
              >
                {commandLabels[item]}
              </Text>
            </Pressable>
          ))}
        </View>
        {needsPatient ? (
          <Field
            label="Фамилия пациента"
            value={patient}
            onChangeText={setPatient}
            placeholder="Например, Иванов"
            hint="Результат появится во вкладке «Задания»."
          />
        ) : null}
        {needsUID ? (
          <Field
            label="Study Instance UID"
            value={studyUID}
            onChangeText={setStudyUID}
            placeholder="1.2.840…"
            autoCapitalize="none"
          />
        ) : null}
        {isReport ? (
          <Field
            label="Период, суток"
            value={period}
            onChangeText={setPeriod}
            keyboardType="number-pad"
            hint="Допустимое значение от 1 до 4."
          />
        ) : null}
        {command === "get_plan" ? (
          <Field
            label="Дата (необязательно)"
            value={planDate}
            onChangeText={setPlanDate}
            placeholder="YYYY-MM-DD"
            hint="Без даты агент вернёт текущую рабочую неделю."
          />
        ) : null}
        <View style={styles.commandActions}>
          <Button label="Отмена" variant="ghost" onPress={onClose} />
          <Button
            label="Отправить задание"
            icon="send-outline"
            disabled={!valid}
            loading={submitting}
            onPress={() => void submit()}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  safeAreaDark: { backgroundColor: darkColors.canvas },
  app: { flex: 1, flexDirection: "row", backgroundColor: colors.canvas },
  appDark: { backgroundColor: darkColors.canvas },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.canvas },
  mainDark: { backgroundColor: darkColors.canvas },
  content: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
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
  mobileTitlePill: {
    flex: 1,
    minWidth: 0,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.surfaceSoft
  },
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
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceSoft
  },
  desktopTabButtonDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.borderSoft
  },
  desktopTabButtonActive: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(11,132,179,0.28)"
  },
  desktopTabText: {
    ...typography.meta,
    fontWeight: "700",
    color: colors.textMuted
  },
  desktopTabTextActive: { color: colors.primary },
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
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
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
    width: 66,
    height: 38,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center"
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
  screenCompact: { paddingHorizontal: 10, paddingTop: 8 },
  scrollScreen: { paddingBottom: 38, gap: 18 },
  studyToolbar: {
    marginTop: 18,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  studyToolbarCompact: { flexDirection: "column", alignItems: "stretch" },
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
  angioFiltersCompact: { flexWrap: "wrap", minHeight: 76 },
  angioFilter: {
    minHeight: 32,
    paddingHorizontal: 12,
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
    width: "100%",
    minWidth: 0,
    maxWidth: 880,
    flexGrow: 1,
    backgroundColor: "transparent"
  },
  angioListCompact: { width: "100%", minWidth: 0, maxWidth: "100%" },
  angioListContent: { gap: 6, paddingBottom: 8 },
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
  mobileViewerModality: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 9,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(53,194,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(53,194,255,0.4)"
  },
  mobileViewerModalityText: {
    color: darkColors.primary,
    fontSize: 11,
    fontWeight: "800"
  },
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
  reportList: {
    width: 340,
    flexGrow: 0,
    borderRadius: radii.lg,
    backgroundColor: colors.canvasRaised,
    borderWidth: 1,
    borderColor: colors.border
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
  operationTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden"
  },
  operationRow: {
    flexDirection: "row",
    gap: 11,
    padding: 12,
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
  operationPatient: { ...typography.label, color: colors.text, fontSize: 14 },
  operationTime: { ...typography.meta, color: colors.primary },
  operationName: { ...typography.body, color: colors.text, marginTop: 3 },
  operationMeta: { ...typography.meta, color: colors.textDim, marginTop: 4 },
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
  addAgentRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8
  },
  agentIdField: { flex: 1, minWidth: 0 },
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
  planContent: { padding: 16, gap: 14, paddingBottom: 40 },
  planDays: { gap: 12 },
  planDay: {
    padding: 14,
    gap: 8,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  planDayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  planDayTitle: { ...typography.title, color: colors.text },
  emptyDayText: { ...typography.body, color: colors.textDim, padding: 10 },
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
    backgroundColor: colors.canvas,
    paddingHorizontal: 10,
    paddingTop: 2,
    paddingBottom: 5
  },
  mobileNavSafeDark: { backgroundColor: darkColors.canvas },
  mobileNav: {
    height: 58,
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
  mobileNavTextActive: { color: darkColors.primary }
});
