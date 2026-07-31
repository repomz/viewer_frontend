import { agentCommandOptions } from "../App";

describe("agent command menu", () => {
  it("shows protocol search and all polling switches", () => {
    expect(agentCommandOptions).toEqual(
      expect.arrayContaining([
        "sync_studies",
        "find_study",
        "xa_polling_on",
        "xa_polling_off",
        "ct_polling_on",
        "ct_polling_off"
      ])
    );
  });
});
