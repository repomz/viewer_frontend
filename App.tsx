import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
  getAgentHeartbeatTimes,
  getReports,
  getStudies,
  getUserRequest,
  searchStudies
} from "./src/api";
import { AngiographyViewer } from "./src/AngiographyViewer";
import {
  defaultSettings,
  loadRequests,
  loadSettings,
  saveRequests,
  saveSettings
} from "./src/storage";
import { colors, darkColors, layout, radii, typography } from "./src/theme";
import type {
  AgentCommand,
  AgentHealth,
  ApiHealth,
  AppSettings,
  OperationsReport,
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
  SectionHeader,
  Sheet,
  Toast,
  type IconName
} from "./src/ui";

type Tab = "studies" | "angiography" | "requests" | "reports" | "settings";
type ToastState = { message: string; tone: "success" | "danger" } | null;

const tabs: { id: Tab; label: string; shortLabel: string; icon: IconName }[] = [
  {
    id: "studies",
    label: "Исследования",
    shortLabel: "Исслед.",
    icon: "reader-outline"
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
  },
  {
    id: "settings",
    label: "Настройки",
    shortLabel: "Настр.",
    icon: "options-outline"
  }
];

const commandLabels: Record<AgentCommand, string> = {
  get_report: "Получить отчёт",
  find_study: "Найти протокол",
  find_xa: "Найти XA",
  find_ct: "Найти CT",
  get_xa: "Загрузить XA",
  get_ct: "Загрузить CT",
  xa_polling_on: "Включить XA-мониторинг",
  xa_polling_off: "Выключить XA-мониторинг",
  ct_polling_on: "Включить CT-мониторинг",
  ct_polling_off: "Выключить CT-мониторинг"
};

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

export default function App() {
  const { width } = useWindowDimensions();
  const compact = width < layout.mobileBreakpoint;
  const [activeTab, setActiveTab] = useState<Tab>("studies");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [studies, setStudies] = useState<Study[]>([]);
  const [studiesLoading, setStudiesLoading] = useState(true);
  const [studiesError, setStudiesError] = useState("");
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState("Все");
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [xaStudies, setXaStudies] = useState<Study[]>([]);
  const [xaLoading, setXaLoading] = useState(false);
  const [xaError, setXaError] = useState("");
  const [requests, setRequests] = useState<UserRequest[]>(loadRequests);
  const [reports, setReports] = useState<ReportDocument[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({
    online: false,
    status: "unknown"
  });
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const loadStudies = useCallback(async () => {
    setStudiesError("");
    setStudiesLoading(true);
    try {
      const response = await getStudies();
      setStudies(response);
      setSelectedStudy((current) => {
        if (!current) return response[0] ?? null;
        return (
          response.find((study) => study.id === current.id) ??
          response[0] ??
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
      setXaStudies(await searchStudies({ studyType: "xa" }));
    } catch (error) {
      setXaError(errorMessage(error));
    } finally {
      setXaLoading(false);
    }
  }, []);

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
    try {
      const [wellTimes, errorTimes] = await Promise.all([
        getAgentHeartbeatTimes(settings.agentId, "well"),
        getAgentHeartbeatTimes(settings.agentId, "with_errors")
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
      const status =
        !online
          ? "offline"
          : latestError &&
              (!latestWell || latestError.getTime() > latestWell.getTime())
            ? "with_errors"
            : "well";
      setAgentHealth({ online, status, lastSeen, ageMs });
    } catch {
      setAgentHealth({ online: false, status: "unknown" });
    }
  }, [settings.agentId]);

  const refreshConnectivity = useCallback(() => {
    void updateServerHealth();
    void updateAgentHealth();
  }, [updateAgentHealth, updateServerHealth]);

  useEffect(() => {
    void loadStudies();
    refreshConnectivity();
  }, [loadStudies, refreshConnectivity]);

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
    document.documentElement.style.backgroundColor = colors.canvas;
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.body.style.fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const modalities = useMemo(() => {
    const values = new Set(
      studies.map((study) => study.study_type.toUpperCase()).filter(Boolean)
    );
    const preferred = ["CT", "XA", "КАГ", "ЦАГ"];
    return [
      "Все",
      ...preferred.filter((item) => values.has(item)),
      ...[...values].filter((item) => !preferred.includes(item)).slice(0, 5)
    ];
  }, [studies]);

  const filteredStudies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    return studies.filter((study) => {
      const modalityMatches =
        modality === "Все" || study.study_type.toUpperCase() === modality;
      if (!modalityMatches) return false;
      if (!query) return true;
      return [
        study.patient,
        study.name_operation,
        study.surgeon,
        study.department,
        study.study_id
      ].some((value) => value.toLocaleLowerCase("ru").includes(query));
    });
  }, [modality, search, studies]);

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
      const normalized = {
        agentId:
          Number.isInteger(next.agentId) && next.agentId > 0
            ? next.agentId
            : defaultSettings.agentId,
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

  const refreshActiveScreen = () => {
    if (activeTab === "reports") void loadReports();
    else if (activeTab === "angiography") void loadXAStudies();
    else void loadStudies();
    refreshConnectivity();
  };

  const isAngiography = activeTab === "angiography";

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.safeArea, isAngiography && styles.safeAreaDark]}
        edges={compact ? ["top"] : []}
      >
        <StatusBar style={isAngiography ? "light" : "dark"} />
        <View style={styles.app}>
          {!compact ? (
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              health={health}
              agentHealth={agentHealth}
            />
          ) : null}

          <View style={styles.main}>
            <TopBar
              compact={compact}
              activeTab={activeTab}
              health={health}
              agentHealth={agentHealth}
              onRefresh={refreshActiveScreen}
              onCommand={() => setCommandOpen(true)}
            />

            <View style={[styles.content, isAngiography && styles.contentDark]}>
              {activeTab === "studies" ? (
                <StudiesScreen
                  compact={compact}
                  inlineDetail={!compact && width >= layout.tabletBreakpoint}
                  studies={filteredStudies}
                  total={studies.length}
                  loading={studiesLoading}
                  error={studiesError}
                  search={search}
                  modality={modality}
                  modalities={modalities}
                  selected={selectedStudy}
                  onSearch={setSearch}
                  onModality={setModality}
                  onSelect={setSelectedStudy}
                  onRetry={() => void loadStudies()}
                  onRefresh={() => void loadStudies()}
                  onCommand={() => setCommandOpen(true)}
                  onRequestStudy={(study, command) =>
                    void submitCommand(command, { study_uid: study.study_id })
                  }
                />
              ) : null}
              {activeTab === "angiography" ? (
                <AngiographyScreen
                  compact={compact}
                  studies={xaStudies}
                  loading={xaLoading}
                  error={xaError}
                  onRetry={() => void loadXAStudies()}
                  onFind={() => setCommandOpen(true)}
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
                />
              ) : null}
              {activeTab === "settings" ? (
                <SettingsScreen
                  settings={settings}
                  health={health}
                  agentHealth={agentHealth}
                  onSave={saveAppSettings}
                  onCheck={refreshConnectivity}
                />
              ) : null}
            </View>

            {compact ? (
              <MobileNavigation
                activeTab={activeTab}
                onTabChange={setActiveTab}
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

function Sidebar({
  activeTab,
  onTabChange,
  health,
  agentHealth
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  health: ApiHealth | null;
  agentHealth: AgentHealth;
}) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Icon name="scan" size={23} color={darkColors.primary} />
        </View>
        <View>
          <Text style={styles.brandName}>VIEWER</Text>
          <Text style={styles.brandSub}>CLINICAL</Text>
        </View>
      </View>

      <View style={styles.nav}>
        <Text style={styles.navLabel}>РАБОЧЕЕ ПРОСТРАНСТВО</Text>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onTabChange(tab.id)}
              style={({ pressed }) => [
                styles.navItem,
                active && styles.navItemActive,
                pressed && styles.pressed
              ]}
            >
              <Icon
                name={
                  active
                    ? (tab.icon.replace("-outline", "") as IconName)
                    : tab.icon
                }
                color={active ? darkColors.primary : darkColors.textMuted}
              />
              <Text style={[styles.navText, active && styles.navTextActive]}>
                {tab.label}
              </Text>
              {active ? <View style={styles.navIndicator} /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sidebarFoot}>
        <StatusLine
          dark
          icon="server-outline"
          label="Сервер"
          online={Boolean(health?.ok)}
          meta={health?.ok ? "Viewer API доступен" : "нет соединения"}
        />
        <StatusLine
          dark
          icon="hardware-chip-outline"
          label={`Агент ${agentHealth.status === "with_errors" ? "с ошибками" : ""}`}
          online={agentHealth.online && agentHealth.status === "well"}
          warning={agentHealth.status === "with_errors"}
          meta={relativeTime(agentHealth.lastSeen)}
        />
        <Text style={styles.privacyNote}>
          Клинические данные. Используйте только на доверенном устройстве.
        </Text>
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
  agentHealth,
  onRefresh,
  onCommand
}: {
  compact: boolean;
  activeTab: Tab;
  health: ApiHealth | null;
  agentHealth: AgentHealth;
  onRefresh: () => void;
  onCommand: () => void;
}) {
  const active = tabs.find((item) => item.id === activeTab) ?? tabs[0]!;
  const dark = activeTab === "angiography";
  if (compact) {
    return (
      <View
        style={[
          styles.topBar,
          styles.topBarCompact,
          dark && styles.topBarDark
        ]}
      >
        <View style={styles.mobileStatusPair}>
          <View
            accessibilityLabel={health?.ok ? "Сервер доступен" : "Сервер недоступен"}
            style={[
              styles.mobileStatusDot,
              { backgroundColor: health?.ok ? colors.success : colors.danger }
            ]}
          />
          <View
            accessibilityLabel={
              agentHealth.online ? "Агент доступен" : "Агент недоступен"
            }
            style={[
              styles.mobileStatusDot,
              {
                backgroundColor:
                  agentHealth.online && agentHealth.status === "well"
                    ? colors.success
                    : agentHealth.status === "with_errors"
                      ? colors.warning
                      : colors.danger
              }
            ]}
          />
        </View>
        <Text
          numberOfLines={1}
          style={[styles.mobileTopTitle, dark && styles.textDark]}
        >
          {active.label}
        </Text>
        <IconButton icon="refresh" label="Обновить" onPress={onRefresh} />
      </View>
    );
  }
  return (
    <View style={[styles.topBar, dark && styles.topBarDark]}>
      <View>
        <Text style={[styles.topTitle, dark && styles.textDark]}>
          {active.label}
        </Text>
        <Text style={[styles.topSubtitle, dark && styles.textMutedDark]}>
          {dark
            ? "Диагностический просмотр XA в OHIF"
            : "Единое рабочее пространство клинических исследований"}
        </Text>
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
        <View style={[styles.healthPill, dark && styles.healthPillDark]}>
          <View
            style={[
              styles.healthDot,
              {
                backgroundColor:
                  agentHealth.online && agentHealth.status === "well"
                    ? colors.success
                    : agentHealth.status === "with_errors"
                      ? colors.warning
                      : colors.danger
              }
            ]}
          />
          <Text style={[styles.healthText, dark && styles.textMutedDark]}>
            Агент {agentHealth.online ? "" : "offline"}
          </Text>
        </View>
        <IconButton icon="refresh" label="Обновить" onPress={onRefresh} />
        <Button label="Новый запрос" icon="add" onPress={onCommand} />
      </View>
    </View>
  );
}

function MobileNavigation({
  activeTab,
  onTabChange
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  return (
    <SafeAreaView edges={["bottom"]} style={styles.mobileNavSafe}>
      <View style={styles.mobileNav}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onTabChange(tab.id)}
              style={styles.mobileNavItem}
            >
              <Icon
                name={tab.icon}
                size={20}
                color={active ? colors.primary : colors.textDim}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.mobileNavText,
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
  modality,
  modalities,
  selected,
  onSearch,
  onModality,
  onSelect,
  onRetry,
  onRefresh,
  onCommand,
  onRequestStudy
}: {
  compact: boolean;
  inlineDetail: boolean;
  studies: Study[];
  total: number;
  loading: boolean;
  error: string;
  search: string;
  modality: string;
  modalities: string[];
  selected: Study | null;
  onSearch: (value: string) => void;
  onModality: (value: string) => void;
  onSelect: (study: Study | null) => void;
  onRetry: () => void;
  onRefresh: () => void;
  onCommand: () => void;
  onRequestStudy: (study: Study, command: "get_ct" | "get_xa") => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(!compact);
  const choose = (study: Study) => {
    onSelect(study);
    if (!inlineDetail) setDetailOpen(true);
  };

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      {!compact ? (
        <SectionHeader
          eyebrow={`${total} записей на сервере`}
          title="Клинические исследования"
          description="Слева — компактный список пациентов, справа — полный протокол операции."
        />
      ) : null}

      <View style={[styles.studyToolbar, compact && styles.studyToolbarCompact]}>
        <SearchField
          value={search}
          onChangeText={onSearch}
          placeholder={compact ? "Поиск пациента" : "Пациент, хирург, операция или ID"}
          filterActive={modality !== "Все"}
          onFilter={
            compact ? () => setFiltersVisible((value) => !value) : undefined
          }
        />
        {filtersVisible ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={compact ? styles.mobileChipsScroll : undefined}
            contentContainerStyle={styles.chips}
          >
            {modalities.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={modality === item}
                onPress={() => onModality(item)}
              />
            ))}
          </ScrollView>
        ) : null}
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
                <StudyRow
                  key={study.id}
                  study={study}
                  index={index}
                  compact={compact}
                  selected={selected?.id === study.id}
                  onPress={() => choose(study)}
                />
              ))}
            </ScrollView>
          ) : (
            <EmptyState
              icon="search-outline"
              title="Исследований не найдено"
              description="Измените поиск или запросите протокол у агента."
              action={
                <Button
                  label="Запросить у агента"
                  icon="add"
                  onPress={onCommand}
                />
              }
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
  onPress
}: {
  study: Study;
  index: number;
  compact: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const type = study.study_type.toUpperCase() || "DICOM";
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
          <Badge label={type} />
        </View>
        <Text numberOfLines={1} style={styles.studyOperation}>
          {study.name_operation}
        </Text>
      </View>
      <Text style={styles.studyDateCompact}>
        {formatDate(study.time_beginning)}
      </Text>
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
  const ohifURL =
    process.env.EXPO_PUBLIC_OHIF_URL ?? "http://135.106.130.37:3000";
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
        {study.dicom_link ? (
          <Button
            label="Открыть DICOM"
            icon="open-outline"
            onPress={() =>
              void Linking.openURL(
                study.dicom_link.startsWith("http")
                  ? study.dicom_link
                  : ohifURL
              )
            }
            style={styles.flexButton}
          />
        ) : (
          <Button
            label={`Запросить ${preferredCommand === "get_ct" ? "CT" : "XA"}`}
            icon="cloud-download-outline"
            onPress={() => onRequest(study, preferredCommand)}
            style={styles.flexButton}
          />
        )}
        <Button
          label="OHIF"
          icon="desktop-outline"
          variant="secondary"
          onPress={() => void Linking.openURL(ohifURL)}
        />
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
  onRetry,
  onFind
}: {
  compact: boolean;
  studies: Study[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onFind: () => void;
}) {
  const [selected, setSelected] = useState<Study | null>(studies[0] ?? null);
  const [mobileViewer, setMobileViewer] = useState(false);
  const ohifRoot =
    process.env.EXPO_PUBLIC_OHIF_URL ?? "http://135.106.130.37:3000";

  useEffect(() => {
    if (!selected && studies[0]) setSelected(studies[0]);
  }, [selected, studies]);

  const viewerURL = selected
    ? `${ohifRoot.replace(/\/$/, "")}/viewer?StudyInstanceUIDs=${encodeURIComponent(
        selected.study_id
      )}`
    : "";

  const choose = (study: Study) => {
    setSelected(study);
    if (compact) setMobileViewer(true);
  };

  return (
    <View style={styles.angioScreen}>
      <View style={styles.angioHeading}>
        <View>
          <Text style={styles.angioEyebrow}>XA · ANGIOGRAPHY</Text>
          <Text style={styles.angioTitle}>Просмотр ангиографий</Text>
          <Text style={styles.angioSubtitle}>
            Исследования XA, загруженные агентом и импортированные в PACS.
          </Text>
        </View>
        <Button
          label="Найти XA"
          icon="search-outline"
          onPress={onFind}
        />
      </View>
      {error ? <InlineError message={error} onRetry={onRetry} /> : null}
      {loading ? (
        <LoadingState label="Проверяем XA-исследования…" />
      ) : studies.length ? (
        <View style={styles.angioWorkspace}>
          <ScrollView
            style={styles.angioList}
            contentContainerStyle={styles.angioListContent}
            showsVerticalScrollIndicator={false}
          >
            {studies.map((study) => (
              <Pressable
                key={study.id}
                accessibilityRole="button"
                accessibilityLabel={`Открыть ангиографию ${study.patient}`}
                onPress={() => choose(study)}
                style={[
                  styles.angioRow,
                  selected?.id === study.id && styles.angioRowSelected
                ]}
              >
                <View style={styles.angioRowIcon}>
                  <Icon name="scan" color={darkColors.primary} />
                </View>
                <View style={styles.angioRowCopy}>
                  <Text numberOfLines={1} style={styles.angioPatient}>
                    {study.patient}
                  </Text>
                  <Text numberOfLines={1} style={styles.angioMeta}>
                    {formatDate(study.time_beginning)} · {study.study_id}
                  </Text>
                </View>
                <Icon
                  name="chevron-forward"
                  size={17}
                  color={darkColors.textDim}
                />
              </Pressable>
            ))}
          </ScrollView>
          {!compact && selected ? (
            <View style={styles.angioViewer}>
              <View style={styles.angioViewerBar}>
                <View>
                  <Text style={styles.angioViewerPatient}>
                    {selected.patient}
                  </Text>
                  <Text style={styles.angioMeta}>{selected.study_id}</Text>
                </View>
                <Button
                  label="Открыть отдельно"
                  variant="secondary"
                  compact
                  icon="open-outline"
                  onPress={() => void Linking.openURL(viewerURL)}
                />
              </View>
              <View style={styles.angioFrame}>
                <AngiographyViewer
                  url={viewerURL}
                  title={`Ангиография ${selected.patient}`}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.angioEmpty}>
          <Icon name="scan-outline" size={32} color={darkColors.primary} />
          <Text style={styles.angioEmptyTitle}>XA пока не загружены</Text>
          <Text style={styles.angioEmptyText}>
            Выполните поиск XA по фамилии, затем загрузите выбранное
            исследование. После импорта оно появится здесь автоматически.
          </Text>
          <Button label="Найти XA в PACS" onPress={onFind} />
        </View>
      )}

      {compact ? (
        <Sheet
          visible={mobileViewer && Boolean(selected)}
          title={selected?.patient || "Ангиография"}
          onClose={() => setMobileViewer(false)}
          fullScreen
        >
          <View style={styles.mobileAngioViewer}>
            {selected ? (
              <AngiographyViewer
                url={viewerURL}
                title={`Ангиография ${selected.patient}`}
              />
            ) : null}
          </View>
        </Sheet>
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
  onRefresh
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
}) {
  return (
    <ScrollView
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollScreen}
    >
      <SectionHeader
        eyebrow="Связь с больничным контуром"
        title="Задания агенту"
        description="Результаты поиска протоколов и PACS-исследований можно открыть прямо здесь."
        action={
          !compact ? (
            <Button
              label="Новое задание"
              icon="add"
              onPress={onCommand}
            />
          ) : undefined
        }
      />
      <View style={styles.infoBanner}>
        <Icon name="information-circle-outline" color={colors.primary} />
        <Text style={styles.infoBannerText}>
          Найденный протокол не всегда автоматически сохранён в Studies.
          Карточка результата явно показывает, есть ли он уже в базе.
        </Text>
      </View>
      {requests.length ? (
        <View style={styles.requestList}>
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              compact={compact}
              request={request}
              studies={studies}
              onSubmit={onSubmit}
              onRefresh={() => onRefresh(request)}
            />
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
          <Text style={styles.requestId}>#{request.id.slice(0, 8)}</Text>
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
  onRequest
}: {
  compact: boolean;
  reports: ReportDocument[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onRequest: () => void;
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
      {!compact ? (
        <SectionHeader
          eyebrow="Операционная отчётность"
          title="Отчёты дежурств"
          description="Выберите дату слева — полный отчёт откроется справа."
          action={
            <Button
              label="Запросить свежий"
              icon="cloud-download-outline"
              onPress={onRequest}
            />
          }
        />
      ) : null}
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
              <ReportRow
                key={report.filename ?? `${report.generated_at}-${index}`}
                report={report}
                selected={selected?.filename === report.filename}
                onPress={() => choose(report)}
              />
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
  onPress
}: {
  report: ReportDocument;
  selected: boolean;
  onPress: () => void;
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
      <Icon name="chevron-forward" size={17} color={colors.textDim} />
    </Pressable>
  );
}

function ReportDetail({ report }: { report: ReportDocument }) {
  const data = reportData(report);
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
        <Badge
          label={`Агент ${String(report.agent_id ?? "—")}`}
          tone="neutral"
        />
      </View>
      <View style={styles.reportStats}>
        <ReportStat label="Экстренные" value={data.emergency_total ?? 0} />
        <ReportStat label="Плановые" value={data.planned_count ?? 0} />
        <ReportStat
          label="План на сегодня"
          value={data.today_planned_count ?? 0}
        />
      </View>
      <ReportSection
        title="Экстренные операции"
        operations={data.emergency_operations ?? []}
      />
      <ReportSection
        title="Плановые операции"
        operations={data.planned_operations ?? []}
      />
      <ReportSection
        title="План на сегодня"
        operations={data.today_planned_operations ?? []}
      />
    </View>
  );
}

function ReportStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.reportStat}>
      <Text style={styles.reportStatValue}>{value}</Text>
      <Text style={styles.reportStatLabel}>{label}</Text>
    </View>
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

function SettingsScreen({
  settings,
  health,
  agentHealth,
  onSave,
  onCheck
}: {
  settings: AppSettings;
  health: ApiHealth | null;
  agentHealth: AgentHealth;
  onSave: (settings: AppSettings) => void;
  onCheck: () => void;
}) {
  const [agentId, setAgentId] = useState(String(settings.agentId));
  const [userId, setUserId] = useState(settings.userId);
  return (
    <ScrollView
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollScreen}
    >
      <SectionHeader
        eyebrow="Локальная конфигурация"
        title="Настройки"
        description="Параметры сохраняются только в браузере этого устройства."
      />
      <View style={styles.settingsGrid}>
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Больничный агент</Text>
          <Field
            label="Agent ID"
            value={agentId}
            onChangeText={setAgentId}
            keyboardType="number-pad"
            hint="Идентификатор операционной, куда отправляются команды."
          />
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
              onSave({ agentId: Number.parseInt(agentId, 10), userId })
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
          <StatusLine
            icon="hardware-chip-outline"
            label={`Hospital Agent ${settings.agentId}`}
            online={agentHealth.online && agentHealth.status === "well"}
            warning={agentHealth.status === "with_errors"}
            meta={`Последний heartbeat: ${relativeTime(agentHealth.lastSeen)}`}
          />
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
          {(
            [
              "find_study",
              "find_xa",
              "find_ct",
              "get_xa",
              "get_ct",
              "get_report"
            ] as AgentCommand[]
          ).map((item) => (
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
  main: { flex: 1, minWidth: 0, backgroundColor: colors.canvas },
  content: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  contentDark: { backgroundColor: darkColors.canvas },
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
    backgroundColor: darkColors.canvas,
    borderBottomColor: darkColors.borderSoft
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
    width: 46,
    height: 38,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center"
  },
  mobileStatusDot: { width: 8, height: 8, borderRadius: 8 },
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
  chips: { gap: 7 },
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
    paddingHorizontal: 22,
    paddingTop: 20,
    backgroundColor: darkColors.canvas
  },
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
  angioList: {
    width: 330,
    flexGrow: 0,
    borderRadius: radii.lg,
    backgroundColor: darkColors.canvasRaised
  },
  angioListContent: { padding: 8, gap: 6 },
  angioRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "transparent"
  },
  angioRowSelected: {
    backgroundColor: darkColors.primarySoft,
    borderColor: "rgba(53,194,255,0.35)"
  },
  angioRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.surface
  },
  angioRowCopy: { flex: 1, minWidth: 0 },
  angioPatient: { ...typography.label, color: darkColors.text },
  angioMeta: { ...typography.meta, color: darkColors.textDim, marginTop: 3 },
  angioViewer: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: darkColors.border,
    backgroundColor: "#05080B"
  },
  angioViewerBar: {
    minHeight: 62,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: darkColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: darkColors.border
  },
  angioViewerPatient: { ...typography.label, color: darkColors.text },
  angioFrame: { flex: 1, minHeight: 420 },
  angioEmpty: {
    flex: 1,
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: darkColors.border,
    backgroundColor: darkColors.canvasRaised
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
    minHeight: 600,
    backgroundColor: "#05080B"
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
  requestList: { gap: 8 },
  requestCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  requestIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
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
  mobileNavSafe: {
    backgroundColor: colors.canvasRaised,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  mobileNav: { height: 60, flexDirection: "row", paddingHorizontal: 2 },
  mobileNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minWidth: 0
  },
  mobileNavText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "600",
    color: colors.textDim
  },
  mobileNavTextActive: { color: colors.primary }
});
