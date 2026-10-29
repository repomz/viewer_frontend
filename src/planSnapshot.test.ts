import { planSnapshotLayout, sharePlanSnapshot } from "./planSnapshot";
import type { OperationPlan } from "./types";

const plan: OperationPlan = { week_start: "2026-10-26", days: Array.from({ length: 5 }, (_, d) => ({ date: `2026-10-${26 + d}`, entries: Array.from({ length: 18 }, (_, i) => ({ patient: `Пациент${d}-${i} И.И.`, department: "кардио 2", operation: "каг стент", additions: "" })) })) };
const measure = (text: string) => text.length * 14;

it("includes every patient through Friday in a dynamically sized image", () => {
  const layout = planSnapshotLayout(plan, measure);
  expect(layout.height).toBeGreaterThan(1500);
  expect(layout.bands).toHaveLength(5);
  expect(layout.runs.some(run => run.text.includes("Пациент4-17"))).toBe(true);
  expect(layout.runs.every(run => run.y < layout.height)).toBe(true);
});
it("exports only the selected day and aligns department and operation with the patient", () => {
  const layout = planSnapshotLayout(plan, measure, "2026-10-30");
  expect(layout.bands).toHaveLength(1);
  expect(layout.runs.some(run => run.text.includes("Пациент0"))).toBe(false);
  const patient = layout.runs.find(run => run.text.includes("Пациент4-0"))!;
  expect(layout.runs.filter(run => run.y === patient.y).map(run => run.x)).toEqual([60, 470, 675]);
});
it("wraps long cells without clipping the bottom of the image", () => {
  const layout = planSnapshotLayout({ ...plan, days: [{ date: "2026-10-30", entries: [{ patient: "Пациент", department: "сосуды", operation: "ангиография ".repeat(60), additions: "" }] }] }, measure);
  expect(layout.runs.filter(run => run.x === 675).length).toBeGreaterThan(10);
  expect(Math.max(...layout.runs.map(run => run.y))).toBeLessThan(layout.height);
});
it("shares only a PNG file without a text message", async () => {
  const ctx = { font: "", fillStyle: "", measureText: (text: string) => ({ width: measure(text) }), scale: jest.fn(), fillRect: jest.fn(), fillText: jest.fn() };
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ getContext: () => ctx, toBlob: (cb: (blob: Blob) => void) => cb(new Blob(["png"], { type: "image/png" })) }) } });
  const share = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  try {
    await sharePlanSnapshot(plan, "2026-10-30");
    expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
    expect(share.mock.calls[0][0].files[0].name).toBe("plan-2026-10-30.png");
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "canShare");
  }
});
