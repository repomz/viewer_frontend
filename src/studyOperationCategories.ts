import type { Study } from "./types";

export type StudyCategory =
  | "all"
  | "ВСУЗИ"
  | "КАГ"
  | "ЦАГ"
  | "СТЕНТ КОР"
  | "БАП КОР"
  | "СТЕНТ ВСА"
  | "СТЕНТ В/К"
  | "СТЕНТ Н/К"
  | "АНЕВРИЗМА"
  | "ИНСУЛЬТ"
  | "Голень"
  | "ДРУГИЕ";

/** Matches the operation types currently exposed by backend statistics. */
export const studyCategories: StudyCategory[] = [
  "all",
  "ВСУЗИ",
  "КАГ",
  "ЦАГ",
  "СТЕНТ КОР",
  "БАП КОР",
  "СТЕНТ ВСА",
  "СТЕНТ В/К",
  "СТЕНТ Н/К",
  "АНЕВРИЗМА",
  "ИНСУЛЬТ",
  "Голень",
  "ДРУГИЕ"
];

function includesAny(source: string, ...needles: string[]): boolean {
  return needles.some((needle) => source.includes(needle));
}

export function studyCategoriesFor(study: Study): Exclude<StudyCategory, "all">[] {
  const source = `${study.study_type} ${study.name_operation} ${study.descr_operation}`
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/_/g, " ");
  const stent = includesAny(source, "стент", "чкв");
  const vzuzi = includesAny(source, "всузи", "внутрисосудист");
  const coronary = includesAny(source, "коронар", "каг", "чкв", "стент кор", "бап кор");
  const categories: Exclude<StudyCategory, "all">[] = [];

  if (vzuzi) categories.push("ВСУЗИ");
  if (stent && coronary) categories.push("СТЕНТ КОР");
  else if (coronary && includesAny(source, "баллон", "бап")) categories.push("БАП КОР");
  else if (includesAny(source, "каг", "коронарограф")) categories.push("КАГ");

  if (
    !stent &&
    includesAny(source, "цаг", "церебраль", "ангиограф") &&
    includesAny(source, "бца", "церебраль", "цаг")
  ) categories.push("ЦАГ");
  if (stent && includesAny(source, "вса", "каротид", "сонн")) categories.push("СТЕНТ ВСА");
  if (stent && includesAny(source, "верхн", "подключ")) categories.push("СТЕНТ В/К");
  if (stent && includesAny(source, "нижн", "опа", "нпа", "бедрен", "подкол")) categories.push("СТЕНТ Н/К");
  if (includesAny(source, "эмболизац") && includesAny(source, "аневризм")) categories.push("АНЕВРИЗМА");
  if (
    includesAny(source, "тромбаспирац", "тромбэкстракц", "тромбэктом") &&
    includesAny(source, "сма", "пма", "зма", "базиляр", "вса", "инсульт")
  ) categories.push("ИНСУЛЬТ");
  if (includesAny(source, "бап голен", "баллонная ангиопластика голен")) categories.push("Голень");

  return categories.length ? [...new Set(categories)] : ["ДРУГИЕ"];
}
