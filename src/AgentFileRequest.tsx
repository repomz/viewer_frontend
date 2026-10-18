import {useEffect, useState} from "react";
import {Pressable, Text, TextInput, View} from "react-native";
import {getAgentFileRequests, getUserRequest, requestAgentFile} from "./api";
import {colors} from "./theme";
import type {UserRequest} from "./types";

export function AgentFileRequest({agentId}: {agentId: number}) {
  const [expanded, setExpanded] = useState(false);
  const [path, setPath] = useState("");
  const [job, setJob] = useState<UserRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = job?.status === "pending" || job?.status === "in_progress";
  useEffect(() => {
    let cancelled = false;
    void getAgentFileRequests(agentId).then(jobs => {
      if (!cancelled) setJob(current => current ?? jobs.find(item => item.status === "pending" || item.status === "in_progress") ?? jobs[0] ?? null);
    }).catch(() => { /* Request creation still reports actionable server errors. */ });
    return () => {cancelled = true;};
  }, [agentId]);
  useEffect(() => {
    if (!active || !job) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void getUserRequest(job.id).then(value => {if (!cancelled) {setJob(value); setError("");}})
        .catch(() => {if (!cancelled) setError("Не удалось обновить статус. Запрос остаётся в очереди.");});
    }, 5000);
    return () => {cancelled = true; clearInterval(timer);};
  }, [active, job?.id]);
  const send = async () => {
    if (!path.trim() || busy || active) return;
    setBusy(true); setError("");
    try {setJob(await requestAgentFile(agentId, path.trim()));}
    catch (e) {setError(e instanceof Error ? e.message : "Не удалось запросить файл");}
    finally {setBusy(false);}
  };
  return <View style={{gap: 6, paddingVertical: 6}}>
    <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}>
      <Text style={{color: colors.primary}}>Исходный протокол на диск {expanded ? "▴" : "▾"}</Text>
    </Pressable>
    {expanded && <>
      <Text style={{color: colors.textMuted, fontSize: 12}}>Агент {agentId} · Вставьте полный путь из лога. Только протоколы, до 20 МБ.</Text>
      <View style={{flexDirection: "row", gap: 8, alignItems: "center"}}>
        <TextInput accessibilityLabel="Путь к исходному протоколу" value={path} onChangeText={setPath}
          autoCapitalize="none" autoCorrect={false} placeholder="C:\\…\\Протокол.docx"
          placeholderTextColor={colors.textMuted}
          style={{flex: 1, minWidth: 0, color: colors.text, padding: 10, borderWidth: 1, borderColor: colors.primary, borderRadius: 10}} />
        <Pressable accessibilityRole="button" disabled={busy || !!active || !path.trim()} onPress={() => void send()}
          style={{padding: 10, borderRadius: 10, backgroundColor: colors.primary, opacity: busy || active || !path.trim() ? 0.5 : 1}}>
          <Text style={{color: "white"}}>{busy ? "…" : "Получить"}</Text>
        </Pressable>
      </View>
    </>}
    {job && <Text style={{color: job.status === "error" ? colors.danger : colors.textMuted, fontSize: 12}}>
      {job.status === "completed" ? "Файл сохранён на вашем диске" : job.status === "error" ? job.errors || "Не удалось получить файл" : job.status === "in_progress" ? "Агент отправляет файл…" : "Ожидаем агента. Не создавайте повторный запрос."}
    </Text>}
    {!!error && <Text style={{color: colors.danger, fontSize: 12}}>{error}</Text>}
  </View>;
}
