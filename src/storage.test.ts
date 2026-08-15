import {
  loadDressingChecks,
  loadOperationPlanCache,
  loadReportsCache,
  saveDressingChecks,
  saveOperationPlanCache,
  saveReportsCache
} from "./storage";

describe("clinical data cache", () => {
  const values = new Map<string, string>();

  beforeAll(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });
  });

  beforeEach(() => values.clear());

  it("keeps reports isolated by agent", () => {
    saveReportsCache(2, [{ filename: "report-2.json", agent_id: 2 }]);
    saveReportsCache(3, [{ filename: "report-3.json", agent_id: 3 }]);

    expect(loadReportsCache(2)).toEqual([
      { filename: "report-2.json", agent_id: 2 }
    ]);
    expect(loadReportsCache(3)).toEqual([
      { filename: "report-3.json", agent_id: 3 }
    ]);
  });

  it("returns the cached operation plan for its calendar week", () => {
    const plan = {
      week_start: "2026-08-03",
      days: [{ date: "2026-08-04", entries: [] }]
    };
    saveOperationPlanCache(plan);

    expect(loadOperationPlanCache("2026-08-03")).toEqual(plan);
    expect(loadOperationPlanCache("2026-08-10")).toBeNull();
  });

  it("persists dressing marks separately for each reporting period", () => {
    saveDressingChecks("2026-08-14", ["к/о 2|иванов", "к/о 2|иванов"]);
    saveDressingChecks("2026-08-15", ["рсц|петров"]);

    expect(loadDressingChecks("2026-08-14")).toEqual(["к/о 2|иванов"]);
    expect(loadDressingChecks("2026-08-15")).toEqual(["рсц|петров"]);
  });
});
