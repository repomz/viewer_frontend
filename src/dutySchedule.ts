import type { DutySchedule, DutyScheduleStaff } from "./types";

export const scheduleRows = (staff: DutyScheduleStaff): ("day" | "duty")[] =>
  staff.role === "duty_only" ? ["duty"] : staff.role === "day_only" ? ["day"] : ["day", "duty"];

// The hospital's calendar is independent of the viewer's travel/timezone.
export function dutyDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tomsk", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  const date = new Date(`${value("year")}-${value("month")}-${value("day")}T12:00:00Z`);
  if (Number(value("hour")) < 8) date.setUTCDate(date.getUTCDate() - 1);
  return { month: date.toISOString().slice(0, 7), day: date.getUTCDate(), label: date.toLocaleDateString("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" }) };
}

export function dutyNurses(schedule: DutySchedule | null, day: number) {
  const staff = schedule?.groups.find((group) => group.id === "nurses")?.staff ?? [];
  return {
    names: staff.filter((person) => ["16", "24"].includes(person.shifts[`${day}:duty`] ?? person.shifts[String(day)] ?? "") && !person.review?.[`${day}:duty`]).map((person) => person.name),
    uncertain: staff.some((person) => person.review?.[`${day}:duty`])
  };
}

// Convert mobile gallery formats through the browser decoder; preserve detail
// for dense tables and strip EXIF. Never send a provider API key to the client.
export function selectSchedulePhoto(): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (file.size > 30 * 1024 * 1024) { reject(new Error("Фотография должна быть не больше 30 МБ")); return; }
      const url = URL.createObjectURL(file);
      try {
        const img = new Image(); img.src = url; await img.decode();
        const scale = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Не удалось подготовить фото");
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось подготовить фото")), "image/jpeg", 0.94);
      } catch { reject(new Error("Не удалось прочитать фото. Выберите JPEG или PNG.")); }
      finally { URL.revokeObjectURL(url); }
    };
    input.click();
  });
}
