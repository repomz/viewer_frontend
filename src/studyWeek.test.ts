import { belongsToStudyWeek } from "./studyWeek";
import type { Study } from "./types";

test("week excludes opened year/archive protocols but retains the preceding weekend", () => {
  const now = new Date("2026-09-30T12:00:00+07:00");
  const study = (time_beginning: string) => ({ time_beginning } as Study);
  expect(belongsToStudyWeek(study("2026-09-26T00:00:00+07:00"), now)).toBe(true);
  expect(belongsToStudyWeek(study("2026-09-25T23:59:59+07:00"), now)).toBe(false);
  expect(belongsToStudyWeek(study("2026-01-01T12:00:00+07:00"), now)).toBe(false);
  expect(belongsToStudyWeek(study("2025-09-30T12:00:00+07:00"), now)).toBe(false);
});
