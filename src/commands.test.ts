import {
  agentCommandOptions,
  isCompletedAngiographySearch,
  shouldNotifyAgentRequest
} from "../App";
import type { UserRequest } from "./types";

describe("angiography search commands", () => {
  it("exposes only XA and CT search from the frontend", () => {
    expect(agentCommandOptions).toEqual(["find_xa", "find_ct"]);
  });

  it("does not notify for automatic follow-up downloads", () => {
    expect(shouldNotifyAgentRequest("user")).toBe(true);
    expect(shouldNotifyAgentRequest("automatic")).toBe(false);
  });

  it("recognizes completed historical angiography searches", () => {
    const request = {
      status: "completed",
      command: "find_xa"
    } as UserRequest;
    expect(isCompletedAngiographySearch(request)).toBe(true);
    expect(
      isCompletedAngiographySearch({ ...request, status: "pending" })
    ).toBe(false);
    expect(
      isCompletedAngiographySearch({ ...request, command: "get_xa" })
    ).toBe(false);
  });
});
