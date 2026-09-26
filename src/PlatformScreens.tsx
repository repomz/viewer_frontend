import { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { ScrollView } from "./BoundedScrollView";

import {
  changeCredentials,
  deleteDriveFile,
  downloadDriveFile,
  getDriveFiles,
  getPlatformMetrics,
  uploadDriveFile
} from "./api";
import { formatStorageSize } from "./dicomOfflineCache";
import { colors, radii, typography } from "./theme";
import type { DriveFile, DriveListing, PlatformMetrics } from "./types";
import { Button, Field, Icon, InlineError, LoadingState } from "./ui";
import type { AuthUser, StoredAuth } from "./authStorage";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Произошла ошибка";
}

export function CredentialsCard({
  user,
  onUpdated,
  onLogout
}: {
  user: AuthUser;
  onUpdated: (auth: StoredAuth) => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newLogin, setNewLogin] = useState(user.login);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await changeCredentials({
        currentPassword,
        newLogin: newLogin === user.login ? "" : newLogin,
        newPassword
      });
      setCurrentPassword("");
      setNewPassword("");
      onUpdated(result);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <View style={styles.cardIcon}><Icon name="person-outline" color={colors.primary} /></View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{user.display_name}</Text>
          <Text style={styles.meta}>{user.role === "admin" ? "Администратор" : "Пользователь"}</Text>
        </View>
      </View>
      <Field label="Новый логин" value={newLogin} onChangeText={setNewLogin} autoCapitalize="none" />
      <Field label="Новый пароль" value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="Оставьте пустым без изменения" />
      <Field label="Текущий пароль" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
      {error ? <InlineError message={error} onRetry={() => void save()} /> : null}
      <View style={styles.actions}>
        <Button label="Сохранить профиль" loading={saving} onPress={() => void save()} />
        <Button label="Выйти" variant="ghost" icon="log-out-outline" onPress={onLogout} />
      </View>
    </View>
  );
}

export function DriveScreen({ compact }: { compact: boolean }) {
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setListing(await getDriveFiles());
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectFiles = () => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      setUploading(true);
      setError("");
      try {
        for (const file of files) await uploadDriveFile(file);
        await load();
      } catch (reason) {
        setError(message(reason));
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const remove = async (file: DriveFile) => {
    if (Platform.OS === "web" && !globalThis.confirm(`Удалить «${file.name}»?`)) return;
    try {
      await deleteDriveFile(file.id);
      await load();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <View style={[styles.screen, compact && styles.screenCompact]}>
      <View style={styles.driveToolbar}>
        <View style={styles.flex}>
          <Text style={styles.usageValue}>{formatStorageSize(listing?.used_bytes ?? 0)} из 1 ГБ</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, ((listing?.used_bytes ?? 0) / (listing?.quota_bytes || 1)) * 100)}%` }]} />
          </View>
        </View>
        <Button label="Загрузить" icon="cloud-upload-outline" loading={uploading} onPress={selectFiles} />
      </View>
      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      {loading ? <LoadingState label="Загружаем диск…" /> : null}
      {!loading && !listing?.files.length ? (
        <View style={styles.empty}>
          <Icon name="folder-open-outline" size={34} color={colors.textDim} />
          <Text style={styles.cardTitle}>На диске пока нет файлов</Text>
          <Text style={styles.meta}>Файлы доступны только вашему пользователю.</Text>
        </View>
      ) : null}
      <ScrollView style={styles.flex} contentContainerStyle={styles.fileList} showsVerticalScrollIndicator={false}>
        {listing?.files.map((file) => (
          <View key={file.id} style={styles.fileRow}>
            <View style={styles.fileIcon}><Icon name="document-outline" color={colors.primary} /></View>
            <View style={styles.flex}>
              <Text numberOfLines={2} style={styles.fileName}>{file.name}</Text>
              <Text style={styles.meta}>{formatStorageSize(file.size_bytes)} · {new Date(file.created_at).toLocaleString("ru-RU")}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Скачать ${file.name}`} onPress={() => void downloadDriveFile(file.id, file.name).catch((reason) => setError(message(reason)))} style={styles.iconAction}>
              <Icon name="download-outline" color={colors.primary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Удалить ${file.name}`} onPress={() => void remove(file)} style={styles.iconAction}>
              <Icon name="trash-outline" color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function metricPercent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

export function MetricsScreen() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try { setMetrics(await getPlatformMetrics()); }
    catch (reason) { setError(message(reason)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <LoadingState label="Загружаем метрики…" />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.metricsContent} showsVerticalScrollIndicator={false}>
      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      {metrics ? (
        <>
          <View style={styles.metricGrid}>
            <View style={styles.metricCard}><Text style={styles.metricLabel}>Входов за сутки</Text><Text style={styles.metricValue}>{metrics.total_logins}</Text><Text style={styles.meta}>Без администратора</Text></View>
            <View style={styles.metricCard}><Text style={styles.metricLabel}>Протоколов в базе</Text><Text style={styles.metricValue}>{metrics.protocol_count}</Text></View>
            <View style={styles.metricCard}><Text style={styles.metricLabel}>Диск сервера</Text><Text style={styles.metricValue}>{metricPercent(metrics.disk_used_bytes, metrics.disk_total_bytes)}</Text><Text style={styles.meta}>{formatStorageSize(metrics.disk_used_bytes)} из {formatStorageSize(metrics.disk_total_bytes)}</Text></View>
            <View style={styles.metricCard}><Text style={styles.metricLabel}>Оперативная память</Text><Text style={styles.metricValue}>{metricPercent(metrics.memory_used_bytes, metrics.memory_total_bytes)}</Text><Text style={styles.meta}>{formatStorageSize(metrics.memory_used_bytes)} из {formatStorageSize(metrics.memory_total_bytes)}</Text></View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Входы пользователей · {new Date(metrics.date).toLocaleDateString("ru-RU")}</Text>
            {metrics.logins.map((item) => (
              <View key={item.user_id} style={styles.loginRow}>
                <View><Text style={styles.fileName}>{item.display_name}</Text><Text style={styles.meta}>{item.login}</Text></View>
                <Text style={styles.loginCount}>{item.count}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  screen: { flex: 1, minHeight: 0, paddingHorizontal: 18, paddingBottom: 14, backgroundColor: colors.canvas },
  screenCompact: { paddingHorizontal: 10 },
  card: { gap: 13, padding: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  cardTitle: { ...typography.title, color: colors.text },
  meta: { ...typography.meta, color: colors.textDim },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  driveToolbar: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 16, padding: 14, marginBottom: 10, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  usageValue: { ...typography.label, color: colors.text, marginBottom: 7 },
  progressTrack: { height: 7, borderRadius: 7, overflow: "hidden", backgroundColor: colors.surfaceHover },
  progressFill: { height: "100%", borderRadius: 7, backgroundColor: colors.primary },
  fileList: { gap: 7, paddingBottom: 28 },
  fileRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, paddingVertical: 9, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
  fileIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  fileName: { ...typography.label, color: colors.text },
  iconAction: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSoft },
  empty: { minHeight: 240, alignItems: "center", justifyContent: "center", gap: 9 },
  metricsContent: { gap: 12, paddingBottom: 28 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, flexBasis: 220, minHeight: 118, justifyContent: "center", gap: 5, padding: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  metricLabel: { ...typography.label, color: colors.textMuted },
  metricValue: { fontSize: 30, lineHeight: 36, fontWeight: "800", color: colors.primaryStrong },
  loginRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  loginCount: { minWidth: 46, textAlign: "center", fontSize: 22, lineHeight: 28, fontWeight: "800", color: colors.primary }
});
