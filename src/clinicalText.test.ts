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
    ).toBe("стент ОА-ВТК");
  });

  it("shortens artery names and removes the redundant planned-order phrase from recommendations", () => {
    expect(
      plannedRecommendation(
        "Коронарография с возможным стентированием огибающей артерии, передней нисходящей артерии и правой коронарной артерии в плановом порядке"
      )
    ).toBe("КАГ с возможным стент ОА, ПНА и ПКА");
  });

  it("uses the same compact operation vocabulary as the hospital agent", () => {
    expect(
      shortOperationName(
        "Операционная № 2. Коронарография. Стентирование передней нисходящей артерии"
      )
    ).toBe("КАГ. стент ПНА");
  });

  it("removes filler words from operation names and protocol conclusions", () => {
    expect(
      cleanClinicalText("Отмечается частичная окклюзия ПКА. Частичная реканализация")
    ).toBe("окклюзия ПКА. реканализация");
  });
});
