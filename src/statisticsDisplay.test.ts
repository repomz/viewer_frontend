import { formatPlanPatientInput, frequentOperationTypes, frequentStudyCategories, statisticCount } from "./statisticsDisplay";
import type { OperationStatistics, SurgeonStatistics } from "./types";

const rows = [
  { surgeon: "Идрисов", total: 25, vmp: 0, counts: { kag: 11, tsag: 10 } },
  { surgeon: "Полякова", total: 8, vmp: 0, counts: { kag: 8 } },
  { surgeon: "Гергерт А.А.", total: 9, vmp: 0, counts: { kag: 9 } },
] as SurgeonStatistics[];

test("all-operation totals include every surgeon, type totals exclude totals-only surgeons", () => {
  expect(statisticCount(rows, "total")).toBe(42);
  expect(statisticCount(rows, "kag")).toBe(11);
  const statistics = { surgeons: rows, operation_types: [{ id: "kag", label: "КАГ" }, { id: "tsag", label: "ЦАГ" }] } as OperationStatistics;
  expect(frequentOperationTypes(statistics).map(type => type.id)).toEqual(["kag"]);
  expect(frequentStudyCategories(statistics)).toEqual(["all", "КАГ"]);
});

test("patient initials are formatted while typing and can be deleted", () => {
  expect(formatPlanPatientInput("иванов вп")).toBe("Иванов В.П.");
  expect(formatPlanPatientInput("иванов в.п.")).toBe("Иванов В.П.");
  expect(formatPlanPatientInput("Иванов ")).toBe("Иванов ");
  expect(formatPlanPatientInput("Иванов В", "Иванов В.")).toBe("Иванов В");
  expect(formatPlanPatientInput("Иванов ", "Иванов В")).toBe("Иванов ");
  expect(formatPlanPatientInput("садыков-петров аи")).toBe("Садыков-Петров А.И.");
});
