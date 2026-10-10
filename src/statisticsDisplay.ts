import type { OperationStatistics, SurgeonStatistics } from "./types";
import { studyCategories } from "./studyOperationCategories";

export function totalsOnlySurgeon(name: string) {
  return /^(полякова|гергерт)(?:\s|$)/i.test(name.trim());
}

export function statisticCount(rows: SurgeonStatistics[], id: string) {
  return rows.reduce((sum, row) => sum + (id === "total" ? row.total : totalsOnlySurgeon(row.surgeon) ? 0 : row.counts[id] ?? 0), 0);
}

export function frequentOperationTypes(statistics: OperationStatistics | null) {
  return (statistics?.operation_types ?? []).filter(type => statisticCount(statistics?.surgeons ?? [], type.id) > 10);
}

export function frequentStudyCategories(statistics: OperationStatistics | null) {
  return studyCategories.filter(category => category === "all" ||
    (statistics?.operation_types ?? []).filter(type => type.label.replace(/ \(доп\.\)$/, "").toLocaleLowerCase("ru") === category.toLocaleLowerCase("ru"))
      .reduce((sum, type) => sum + (statistics?.surgeons ?? []).reduce((count, row) => count + (row.counts[type.id] ?? 0), 0), 0) > 10);
}

/** Preserve the trailing space while typing; allow deleting automatically inserted dots. */
export function formatPlanPatientInput(value: string, previous = "") {
  const match = value.trimStart().match(/^(\S+)(\s+)?(.*)$/u);
  if (!match) return "";
  const surname = (match[1] ?? "").toLocaleLowerCase("ru").replace(/(^|-)([а-яёa-z])/giu, (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase("ru"));
  if (!match[2]) return surname;
  const initials = (match[3] ?? "").replace(/[.\s]/g, "").toLocaleUpperCase("ru");
  if (!initials) return surname + " ";
  if (initials.length > 2) return surname + " " + match[3];
  let formatted = surname + " " + [...initials].map(letter => letter + ".").join("");
  if (previous.endsWith(".") && value === previous.slice(0, -1)) formatted = formatted.slice(0, -1);
  return formatted;
}
