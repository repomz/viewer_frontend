import Ionicons from "@expo/vector-icons/Ionicons";
import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
  ViewStyle
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, darkColors, radii, shadow, typography } from "./theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function Icon({
  name,
  size = 20,
  color = colors.text
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Button({
  label,
  icon,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  compact = false,
  style
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === "secondary" && styles.buttonSecondary,
        variant === "ghost" && styles.buttonGhost,
        variant === "danger" && styles.buttonDanger,
        pressed && styles.buttonActive,
        (disabled || loading) && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.canvas : colors.text}
        />
      ) : (
        <>
          {icon ? (
            <Icon
              name={icon}
              size={compact ? 16 : 18}
              color={variant === "primary" ? colors.canvas : colors.text}
            />
          ) : null}
          <Text
            style={[
              styles.buttonText,
              variant === "primary" && styles.buttonTextPrimary,
              compact && styles.buttonTextCompact
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  dark = false
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  dark?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        dark && styles.iconButtonDark,
        active && styles.iconButtonActive,
        pressed && styles.buttonActive
      ]}
    >
      <Icon
        name={icon}
        size={20}
        color={
          active
            ? dark
              ? darkColors.primary
              : colors.primary
            : dark
              ? darkColors.text
              : colors.textMuted
        }
      />
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  style,
  ...inputProps
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.primary}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error || hint ? (
        <Text style={[styles.hint, error ? styles.error : null]}>
          {error ?? hint}
        </Text>
      ) : null}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  filterActive = false,
  onFilter
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  filterActive?: boolean;
  onFilter?: () => void;
}) {
  return (
    <View style={styles.search}>
      <Icon name="search-outline" size={19} color={colors.textDim} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.primary}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          onPress={() => onChangeText("")}
          hitSlop={10}
        >
          <Icon name="close-circle" size={18} color={colors.textDim} />
        </Pressable>
      ) : null}
      {onFilter ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Фильтр исследований"
          accessibilityState={{ selected: filterActive }}
          onPress={onFilter}
          hitSlop={10}
        >
          <Icon
            name="swap-vertical"
            size={21}
            color={filterActive ? colors.primary : colors.text}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled = false
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.disabled,
        pressed && styles.buttonActive
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "primary"
}: {
  label: string;
  tone?: "primary" | "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <View
      style={[
        styles.badge,
        tone === "success" && styles.badgeSuccess,
        tone === "warning" && styles.badgeWarning,
        tone === "danger" && styles.badgeDanger,
        tone === "neutral" && styles.badgeNeutral
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          tone === "success" && styles.badgeTextSuccess,
          tone === "warning" && styles.badgeTextWarning,
          tone === "danger" && styles.badgeTextDanger,
          tone === "neutral" && styles.badgeTextNeutral
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
        {description ? (
          <Text style={styles.sectionDescription}>{description}</Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={25} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action}
    </View>
  );
}

export function LoadingState({ label = "Загрузка…" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function InlineError({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.inlineError}>
      <Icon name="alert-circle-outline" color={colors.danger} />
      <Text style={styles.inlineErrorText}>{message}</Text>
      {onRetry ? (
        <Button
          label="Повторить"
          variant="ghost"
          compact
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

export function Sheet({
  visible,
  title,
  onClose,
  children,
  wide = false,
  extraWide = false,
  fullScreen = false
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  extraWide?: boolean;
  fullScreen?: boolean;
}>) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.modalRoot,
          compact && styles.modalRootCompact,
          extraWide && styles.modalRootExtraWide,
          fullScreen && styles.modalRootFull
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.sheet,
            compact && styles.sheetCompact,
            wide && styles.sheetWide,
            extraWide && styles.sheetExtraWide,
            fullScreen && styles.sheetFull
          ]}
        >
          <View
            style={[
            styles.sheetHeader,
              extraWide && styles.sheetHeaderExtraWide,
              fullScreen && {
                minHeight: 62 + insets.top,
                paddingTop: insets.top
              }
            ]}
          >
            <Text style={styles.sheetTitle}>{title}</Text>
            <IconButton icon="close" label="Закрыть" onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function Toast({
  message,
  tone,
  onDismiss
}: {
  message: string;
  tone: "success" | "danger";
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="alert"
      onPress={onDismiss}
      style={[
        styles.toast,
        {
          left: Math.max(12, (width - Math.min(400, width - 24)) / 2),
          width: Math.min(400, width - 24)
        },
        tone === "danger" ? styles.toastDanger : styles.toastSuccess
      ]}
    >
      <Icon
        name={tone === "danger" ? "alert-circle" : "checkmark-circle"}
        color={tone === "danger" ? colors.danger : colors.success}
      />
      <Text style={styles.toastText}>{message}</Text>
      <Icon name="close" size={18} color="rgba(255,255,255,0.72)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 17,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  buttonCompact: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: radii.sm
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border
  },
  buttonGhost: {
    backgroundColor: "transparent"
  },
  buttonDanger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: "rgba(251, 113, 133, 0.28)"
  },
  buttonActive: {
    opacity: 0.78
  },
  disabled: {
    opacity: 0.45
  },
  buttonText: {
    ...typography.label,
    color: colors.text
  },
  buttonTextPrimary: {
    color: colors.canvas,
    fontWeight: "700"
  },
  buttonTextCompact: {
    fontSize: 12
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border
  },
  iconButtonActive: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(53, 194, 255, 0.32)"
  },
  iconButtonDark: {
    backgroundColor: darkColors.primarySoft,
    borderColor: darkColors.borderSoft
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: 7
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.canvasRaised,
    paddingHorizontal: 13,
    color: colors.text,
    fontSize: 15,
    outlineStyle: "none"
  } as never,
  inputError: {
    borderColor: colors.danger
  },
  hint: {
    ...typography.meta,
    color: colors.textDim,
    marginTop: 6
  },
  error: {
    color: colors.danger
  },
  search: {
    minHeight: 46,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 13
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 14,
    outlineStyle: "none"
  } as never,
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  chipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: "rgba(53, 194, 255, 0.4)"
  },
  chipText: {
    ...typography.meta,
    color: colors.textMuted
  },
  chipTextSelected: {
    color: colors.primary
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft
  },
  badgeSuccess: {
    backgroundColor: colors.successSoft
  },
  badgeWarning: {
    backgroundColor: colors.warningSoft
  },
  badgeDanger: {
    backgroundColor: colors.dangerSoft
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceHover
  },
  badgeText: {
    ...typography.meta,
    color: colors.primary,
    fontWeight: "700"
  },
  badgeTextSuccess: {
    color: colors.success
  },
  badgeTextWarning: {
    color: colors.warning
  },
  badgeTextDanger: {
    color: colors.danger
  },
  badgeTextNeutral: {
    color: colors.textMuted
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16
  },
  sectionHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  eyebrow: {
    ...typography.meta,
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 5
  },
  sectionTitle: {
    ...typography.display,
    color: colors.text
  },
  sectionDescription: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 7,
    maxWidth: 680
  },
  empty: {
    minHeight: 280,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceSoft
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16
  },
  emptyTitle: {
    ...typography.title,
    color: colors.text,
    textAlign: "center"
  },
  emptyDescription: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 420,
    marginTop: 7,
    marginBottom: 18
  },
  loading: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 12
  },
  loadingText: {
    ...typography.label,
    color: colors.textMuted
  },
  inlineError: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: "rgba(251, 113, 133, 0.22)"
  },
  inlineErrorText: {
    ...typography.body,
    color: colors.text,
    flex: 1
  },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 11, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18
  },
  modalRootFull: {
    padding: 0,
    backgroundColor: colors.canvas
  },
  modalRootCompact: {
    justifyContent: "flex-end",
    padding: 8,
    paddingBottom: 0
  },
  modalRootExtraWide: {
    padding: 4
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "90%",
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow
  },
  sheetWide: {
    maxWidth: 760
  },
  sheetExtraWide: {
    maxWidth: 1240,
    width: "96%",
    maxHeight: "100%"
  },
  sheetCompact: {
    maxWidth: "100%",
    maxHeight: "92%",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  sheetFull: {
    maxWidth: "100%",
    maxHeight: "100%",
    height: "100%",
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: colors.canvas
  },
  sheetHeader: {
    minHeight: 70,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft
  },
  sheetHeaderExtraWide: {
    minHeight: 54,
    paddingHorizontal: 14
  },
  sheetTitle: {
    ...typography.title,
    color: colors.text
  },
  toast: {
    position: "absolute",
    zIndex: 100,
    top: Platform.OS === "web" ? 22 : 54,
    alignSelf: "center",
    minHeight: 54,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    ...shadow
  },
  toastSuccess: {
    backgroundColor: "#102925",
    borderColor: "rgba(45, 212, 191, 0.3)"
  },
  toastDanger: {
    backgroundColor: "#301A21",
    borderColor: "rgba(251, 113, 133, 0.3)"
  },
  toastText: {
    ...typography.label,
    color: "#F6FAFC",
    flex: 1
  }
});
