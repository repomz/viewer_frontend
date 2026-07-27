import { Platform, StyleSheet, Text, View } from "react-native";

import { darkColors, radii, typography } from "./theme";

export function AngiographyViewer({
  url,
  title
}: {
  url: string;
  title: string;
}) {
  if (Platform.OS !== "web") {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Просмотр доступен в браузере</Text>
        <Text style={styles.fallbackText}>
          Откройте web-версию Viewer Clinical для работы с OHIF.
        </Text>
      </View>
    );
  }

  return (
    <iframe
      allow="fullscreen"
      src={url}
      title={title}
      style={{
        width: "100%",
        height: "100%",
        border: "0",
        background: "#05080B"
      }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    borderRadius: radii.lg,
    backgroundColor: darkColors.surface
  },
  fallbackTitle: {
    ...typography.title,
    color: darkColors.text
  },
  fallbackText: {
    ...typography.body,
    color: darkColors.textMuted,
    textAlign: "center",
    marginTop: 6
  }
});
