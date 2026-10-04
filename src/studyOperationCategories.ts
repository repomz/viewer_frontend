import type { Study } from "./types";

export const operationTypeLabels = {
  "каг": "КАГ",
  "цаг": "ЦАГ",
  "стент_кор": "СТЕНТ КОР",
  "бап_кор": "БАП КОР",
  "стент_вса": "СТЕНТ ВСА",
  "стент_па": "СТЕНТ ПА",
  "стент_вк": "СТЕНТ В/К",
  "стент_нк": "СТЕНТ Н/К",
  "стент_почки": "СТЕНТ ПОЧКИ",
  "аневризма": "АНЕВРИЗМА",
  "инсульт": "ИНСУЛЬТ",
  "бап_голень": "Голень",
  "бап_периферии": "БАП ПЕРИФ",
  "бап_вса": "БАП ВСА",
  "бап_фистулы": "БАП ФИСТУЛЫ",
  "эма": "ЭМА",
  "экс_2к": "ЭКС 2к",
  "экс_1к": "ЭКС 1к",
  "вэкс": "ВЭКС",
  "экс_ревизия": "ЭКС РЕВ",
  "экс": "ЭКС ПРОЧ",
  "вабк": "ВАБК",
  "тромбаспирация": "ТА/ТЭ",
  "ангиография": "АНГИО",
  "ангиография_периферии": "АНГИО ПЕРИФЕРИИ",
  "экмо": "ЭКМО",
  "эмболизация": "ЭМБОЛ",
  "эмболизация_периферии": "ЭМБОЛИЗАЦИЯ ПЕРИФЕРИИ",
  "фистулография": "ФИСТУЛОГР",
  "стент_другие": "СТЕНТ ПРОЧ",
  "бап_другие": "БАП ПРОЧ",
  "другие": "ДРУГИЕ",
} as const;
export type StudyCategory = "all" | "ВСУЗИ" | "ВАБК" | "ЭКМО" | (typeof operationTypeLabels)[keyof typeof operationTypeLabels];
export const studyCategories: StudyCategory[] = [
  ...new Set(["all", "ВСУЗИ", "ВАБК", "ЭКМО", ...Object.values(operationTypeLabels)] as StudyCategory[]),
];

/** Do not infer performed procedures from narrative text or historical devices. */
export function studyCategoriesFor(study: Study): Exclude<StudyCategory, "all">[] {
  const type = study.study_type.trim().toLowerCase().replace(/\s+/g, "_");
  const label = operationTypeLabels[type as keyof typeof operationTypeLabels] ?? "ДРУГИЕ";
  const options = new Set((study.options ?? "").toLowerCase().split(/[;,]/).map(value => value.trim()));
  return [...new Set([
    ...(options.has("ivus") ? ["ВСУЗИ" as const] : []),
    ...(options.has("vabk") ? ["ВАБК" as const] : []),
    ...(options.has("ekmo") ? ["ЭКМО" as const] : []),
    label,
  ])];
}
