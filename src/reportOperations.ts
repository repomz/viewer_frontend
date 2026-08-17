import type { OperationsReport, ReportOperation } from "./types";

export type ReportOperationCategory =
  | "КАГ"
  | "КАГ + стент"
  | "ЦАГ"
  | "ЦАГ + ТА"
  | "ЦАГ + ТА + БАП"
  | "ЦАГ + ТА + стент"
  | "Тромбэкстракции"
  | "Аневризма"
  | "Другие";

export type DressingPatient = {
  id: string;
  patient: string;
  age?: string | number;
  department: string;
  operation: string;
};

export type DressingDepartment = {
  department: string;
  patients: DressingPatient[];
};

function normalized(value?: string): string {
  return (value ?? "").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
}

export function reportOperationCategory(
  operation: ReportOperation
): ReportOperationCategory {
  const value = normalized(operation.operation);
  const hasCerebralAngiography = /цаг|церебральн.*ангиограф/.test(value);
  const hasThrombusAspiration =
    /(?:^|[^а-яa-z0-9])(?:та|тэ|ta|te)(?:$|[^а-яa-z0-9])/.test(value) ||
    /тромб(?:[\s-]*о)?[\s-]*аспирац|тромб[\s-]*экстракц|тромб[\s-]*эктом/.test(value);
  if (hasCerebralAngiography && hasThrombusAspiration) {
    if (/стент/.test(value)) return "ЦАГ + ТА + стент";
    if (/ангиопласт|(?:^|[^а-яa-z0-9])бап(?:$|[^а-яa-z0-9])/.test(value)) {
      return "ЦАГ + ТА + БАП";
    }
    return "ЦАГ + ТА";
  }
  if (/всузи|внутрисосудист/.test(value)) return "КАГ + стент";
  if (hasThrombusAspiration) return "Тромбэкстракции";
  if (/(аневризм|эмболизац.*аневр)/.test(value)) return "Аневризма";
  if (/каг/.test(value) && /стент/.test(value)) return "КАГ + стент";
  if (/каг|коронарограф/.test(value)) return "КАГ";
  if (hasCerebralAngiography) return "ЦАГ";
  return "Другие";
}

export function dressingRoundID(report: OperationsReport): string {
  return [report.period_start, report.period_end, report.date]
    .filter(Boolean)
    .join("|") || "latest";
}

export function dressingDepartments(
  report: OperationsReport
): DressingDepartment[] {
  const operations = [
    ...(report.emergency_operations ?? []),
    ...(report.planned_operations ?? [])
  ];
  const patients = new Map<string, DressingPatient>();

  operations.forEach((operation) => {
    const patient = operation.patient?.trim() || "ФИО не указано";
    const rawDepartment = operation.department?.trim() || "";
    const department = rawDepartment && normalized(rawDepartment) !== "не указано"
      ? rawDepartment
      : "Без отделения";
    const id = `${normalized(department)}|${normalized(patient)}`;
    if (patients.has(id)) return;
    patients.set(id, {
      id,
      patient,
      age: operation.age,
      department,
      operation: operation.operation?.trim() || "Операция не указана"
    });
  });

  const groups = new Map<string, DressingPatient[]>();
  patients.forEach((patient) => {
    const group = groups.get(patient.department) ?? [];
    group.push(patient);
    groups.set(patient.department, group);
  });

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ru"))
    .map(([department, group]) => ({
      department,
      patients: group.sort((left, right) => left.patient.localeCompare(right.patient, "ru"))
    }));
}
