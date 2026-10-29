import type { OperationPlan } from "./types";

type TextRun = { text: string; x: number; y: number; font: string; color: string };
const font = "26px -apple-system, BlinkMacSystemFont, sans-serif";
const bold = `700 ${font}`;

export function planSnapshotLayout(plan: OperationPlan, measure: (text: string, font: string) => number, selectedDate?: string) {
  const days = plan.days.filter(day => !selectedDate || day.date === selectedDate);
  const runs: TextRun[] = [];
  const bands: number[] = [];
  const wrap = (text: string, width: number, face: string) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (line && measure(`${line} ${word}`, face) > width) { lines.push(line); line = ""; }
      for (const char of word) {
        if (measure(line + char, face) > width && line) { lines.push(line); line = ""; }
        line += char;
      }
      line += " ";
    }
    if (line.trim()) lines.push(line.trim());
    return lines.length ? lines : [""];
  };
  const add = (text: string, x: number, y: number, face = font, color = "#10212E") => runs.push({ text, x, y, font: face, color });
  add("План операций", 50, 65, `700 40px sans-serif`);
  add(selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("ru-RU") : `Неделя с ${new Date(`${plan.week_start}T12:00:00`).toLocaleDateString("ru-RU")}`, 50, 110);
  let y = 165;
  for (const day of days) {
    bands.push(y - 30);
    add(new Date(`${day.date}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "long", day: "2-digit", month: "2-digit" }), 60, y, bold, "#287DA0");
    y += 55;
    add("Пациент", 60, y, font, "#607482");
    add("Отделение", 470, y, font, "#607482");
    add("Операция", 675, y, font, "#607482");
    y += 44;
    if (!day.entries.length) { add("Операций нет", 60, y); y += 48; }
    day.entries.forEach((entry, index) => {
      const columns = [
        { text: `${index + 1}. ${entry.patient}`, x: 60, width: 385, face: bold },
        { text: entry.department, x: 470, width: 180, face: font },
        { text: entry.operation + (entry.additions ? ` · ${entry.additions}` : ""), x: 675, width: 465, face: font }
      ];
      let count = 1;
      columns.forEach(column => {
        const lines = wrap(column.text, column.width, column.face);
        count = Math.max(count, lines.length);
        lines.forEach((line, i) => add(line.trim(), column.x, y + i * 34, column.face));
      });
      y += count * 34 + 18;
    });
    y += 25;
  }
  return { width: 1200, height: Math.ceil(y + 30), runs, bands };
}

export async function createPlanSnapshot(plan: OperationPlan, selectedDate?: string): Promise<File> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось создать снимок плана");
  const layout = planSnapshotLayout(plan, (text, font) => { ctx.font = font; return ctx.measureText(text).width; }, selectedDate);
  // Keep the entire week, including Friday. Bound the bitmap for mobile canvas limits.
  const scale = Math.min(1, Math.sqrt(12_000_000 / (layout.width * layout.height)), 16000 / layout.height);
  canvas.width = Math.floor(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#F3F6F8";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#DCEAF0";
  layout.bands.forEach(y => ctx.fillRect(45, y, 1110, 45));
  layout.runs.forEach(run => { ctx.font = run.font; ctx.fillStyle = run.color; ctx.fillText(run.text, run.x, run.y); });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Снимок не создан")), "image/png"));
  const name = `plan-${selectedDate ?? plan.week_start}.png`;
  return new File([blob], name, { type: "image/png" });
}

export async function sharePlanSnapshot(plan: OperationPlan, selectedDate?: string): Promise<void> {
  const file = await createPlanSnapshot(plan, selectedDate);
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
