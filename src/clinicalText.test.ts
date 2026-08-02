import { cleanClinicalText, plannedRecommendation, shortOperationName } from "../App";

describe("clinical protocol presentation", () => {
  it("removes the operating room prefix and abbreviates IVUS", () => {
    expect(
      cleanClinicalText(
        "Операционная № 2. Коронарография и внутрисосудистое ультразвуковое исследование",
        true
      )
    ).toBe("Коронарография и ВСУЗИ");
  });

  it("keeps only the planned recommendation", () => {
    expect(
      plannedRecommendation(
        "- Контроль АД.- Аспирин пожизненно- стентирование ОА-ВТК в плановом порядкеРасходные материалы: контраст"
      )
    ).toBe("стентирование ОА-ВТК в плановом порядке");
  });

  it("uses the same compact operation vocabulary as the hospital agent", () => {
    expect(
      shortOperationName(
        "Операционная № 2. Коронарография. Стентирование передней нисходящей артерии"
      )
    ).toBe("КАГ. стент ПНА");
  });
});
