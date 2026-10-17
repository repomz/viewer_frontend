import { UserRequest } from "./types";

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
export const transferUID = (request: UserRequest) => String(object(request.payload).study_uid ?? "");
export const isTransfer = (request: UserRequest) => ["get_ct", "get_xa"].includes(request.command);
export const activeTransfer = (request: UserRequest) => isTransfer(request) && ["pending", "in_progress"].includes(request.status);
export function studyTransfer(requests: UserRequest[], uid: string): UserRequest | undefined {
  const matches = requests.filter((r) => isTransfer(r) && transferUID(r) === uid);
  return matches.find(activeTransfer) ?? matches.find((r) => r.status === "completed") ?? matches[0];
}
export function transferLabel(request: UserRequest, now = Date.now()): string {
  if (request.status === "completed") return "Доставлено в MAPDR";
  if (request.status === "error") return request.errors || "Не удалось загрузить исследование";
  if (request.status === "pending") return "В очереди — ожидаем агента";
  const p = object(object(request.result).progress);
  const stage = { download: "Больничный PACS → агент", upload: "Агент → Yandex", import: "Yandex → MAPDR" }[String(p.stage)];
  const count = Number(p.completed) || 0, total = Number(p.total) || 0;
  const files = p.stage !== "import" || count > 0 ? (total ? ` · ${count}/${total} файлов` : count ? ` · ${count} файлов` : "") : "";
  const size = Number(p.bytes) > 0 && p.stage !== "import" ? ` · ${(Number(p.bytes) / 1048576).toFixed(0)} МБ` : "";
  const stale = now - new Date(request.updated_at).getTime() > 90000;
  return `${stage || "Агент выполняет загрузку"}${files}${size}${stale ? " · Давно нет обновления статуса" : ""}`;
}
