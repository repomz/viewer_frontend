import { agentCommandOptions } from "../App";

describe("angiography search commands", () => {
  it("exposes only XA and CT search from the frontend", () => {
    expect(agentCommandOptions).toEqual(["find_xa", "find_ct"]);
  });
});
