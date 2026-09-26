import { agentLogGroups } from "./agentLogDisplay";
test("traceback retains the preceding error level and compact context", () => {
  const content = "2026-09-26 21:00:00,100 | ERROR | agent_2 | hospital_agent/app.py:10 | Failed\nTraceback details\n2026-09-26 21:00:01,000 | INFO | agent_2 | app.py:11 | OK";
  expect(agentLogGroups(content, true)).toEqual([{ level: "ERROR", text: "21:00:00 ERROR app.py:10 | Failed\nTraceback details" }]);
});
