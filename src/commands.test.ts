import { agentCommandOptions } from "../App";

describe("agent command menu", () => {
  it("shows search commands and polling switches without duplicate workflows", () => {
    expect(agentCommandOptions).toEqual(
      expect.arrayContaining([
        "find_study",
        "find_xa",
        "find_ct",
        "xa_polling_on",
        "xa_polling_off",
        "ct_polling_on",
        "ct_polling_off"
      ])
    );
    expect(agentCommandOptions).not.toEqual(
      expect.arrayContaining(["sync_studies", "get_report", "get_xa", "get_ct"])
    );
  });
});
