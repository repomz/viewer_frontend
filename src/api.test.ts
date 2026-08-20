import {
  checkHealth,
  generateReport,
  getAgentHeartbeatTimes,
  getBackendVersion,
  getHistoricalStatistics,
  getOperationStatistics,
  getOperationPlan,
  getStudies,
  saveVMPStatisticsConfig
} from "./api";

describe("Viewer API client", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("loads the study collection", async () => {
    const payload = [
      {
        id: "study-1",
        created_at: "2026-07-26T00:00:00Z",
        updated_at: "2026-07-26T00:00:00Z",
        study_id: "1.2.3",
        patient: "Иванов И.И.",
        age: 60,
        department: "кардиология",
        name_operation: "КАГ",
        study_type: "xa",
        descr_operation: "Протокол",
        time_beginning: "2026-07-26T08:00:00Z",
        time_duration: 30,
        surgeon: "Петров",
        dicom_link: ""
      }
    ];
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(getStudies()).resolves.toEqual(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/studies?page=1&page_size=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("accepts the plain-text health response", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("DICOM viewer API v0.1", { status: 200 }));

    await expect(checkHealth()).resolves.toBe("DICOM viewer API v0.1");
  });

  it("loads the backend build version", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "0.2.8", revision: "abc123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(getBackendVersion()).resolves.toEqual({
      version: "0.2.8",
      revision: "abc123"
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/version",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("loads the latest successful agent heartbeats", async () => {
    const payload = [
      "2026-07-27T14:21:41Z",
      "2026-07-27T14:20:41Z"
    ];
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(getAgentHeartbeatTimes(2, "well")).resolves.toEqual(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/agent_status/searchby_status?agent_id=2&limit=1&status=well",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("normalizes empty operation-plan days returned as null", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          week_start: "2026-07-27",
          days: [{ date: "2026-07-27", entries: null }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(getOperationPlan()).resolves.toEqual({
      week_start: "2026-07-27",
      days: [{ date: "2026-07-27", entries: [] }]
    });
  });

  it("generates a report on backend for a calendar period", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ filename: "report.json" }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      })
    );

    await generateReport({
      agentId: 2,
      dateFrom: "2026-07-27",
      dateTo: "2026-08-02"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          agent_id: 2,
          date_from: "2026-07-27",
          date_to: "2026-08-02"
        })
      })
    );
  });

  it("loads and updates VMP statistics rules", async () => {
    const payload = {
      operation_types: [{ id: "каг", label: "КАГ", total: 2 }],
      surgeons: [],
      vmp_operation_types: ["каг"],
      vmp_patients: [],
      included_study_ids: [],
      excluded_study_ids: []
    };
    const response = () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());

    await expect(getOperationStatistics()).resolves.toEqual(payload);
    await saveVMPStatisticsConfig({
      operationTypes: ["каг"],
      includedStudyIds: ["study-1"],
      excludedStudyIds: []
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/statistics/vmp",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          operation_types: ["каг"],
          included_study_ids: ["study-1"],
          excluded_study_ids: []
        })
      })
    );
  });

  it("loads the dynamic historical statistics table", async () => {
    const payload = {
      source: "hospital-archive",
      start_year: 2024,
      end_year: 2026,
      generated_at: "2026-08-03T00:00:00Z",
      operation_types: ["КАГ", "ЦАГ"],
      years: [{ year: 2026, counts: { "КАГ": 4, "ЦАГ": 2 }, total: 6 }]
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(getHistoricalStatistics()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/statistics/history",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
