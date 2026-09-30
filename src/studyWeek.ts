import type { Study } from "./types";

/** Same clinical window as /studies: Monday plus the preceding weekend. */
export function belongsToStudyWeek(study: Study, now = new Date()): boolean {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tomsk", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const monday = new Date(`${day}T00:00:00+07:00`);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  monday.setTime(monday.getTime() - (weekday - 1 + 2) * 86400000);
  return new Date(study.time_beginning).getTime() >= monday.getTime();
}
