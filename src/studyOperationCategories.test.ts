import {studyCategories, studyCategoriesFor} from "./studyOperationCategories";
import type {Study} from "./types";
const study = (study_type: string, options = "") => ({
  study_type, options, name_operation: "КАГ. Ранее стент ПКА",
  description: "Рекомендовано ВСУЗИ.", descr_operation: "Стент проходим."
} as Study);

test("classification uses only structured type and options", () => {
  expect(studyCategoriesFor(study("каг"))).toEqual(["КАГ"]);
  expect(studyCategoriesFor(study("стент_кор", "ivus"))).toEqual(["ВСУЗИ", "СТЕНТ КОР"]);
  expect(studyCategoriesFor(study("каг", "ivus,vabk,ekmo"))).toEqual(["ВСУЗИ", "ВАБК", "ЭКМО", "КАГ"]);
  expect(studyCategoriesFor(study("инсульт"))).toEqual(["ИНСУЛЬТ"]);
});
test("new groups, options, and temporary pacing remain separate", () => {
  expect(studyCategoriesFor(study("ВЭКС"))).toEqual(["ВЭКС"]);
  expect(studyCategoriesFor(study("ЭКС 1к"))).toEqual(["ЭКС 1к"]);
  expect(studyCategoriesFor(study("стент_па"))).toEqual(["СТЕНТ ПА"]);
  expect(studyCategoriesFor(study("эма"))).toEqual(["ЭМА"]);
  expect(studyCategoriesFor(study("ангиография периферии"))).toEqual(["АНГИО ПЕРИФЕРИИ"]);
  expect(studyCategoriesFor(study("эмболизация периферии"))).toEqual(["ЭМБОЛИЗАЦИЯ ПЕРИФЕРИИ"]);
  expect(studyCategoriesFor(study("unknown"))).toEqual(["ДРУГИЕ"]);
  expect(new Set(studyCategories).size).toBe(studyCategories.length);
});
