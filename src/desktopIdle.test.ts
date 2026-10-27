import { DESKTOP_IDLE_MS, desktopIdleExpired, rememberDesktopActivity, watchDesktopIdle } from "./desktopIdle";

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100000);
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "document", { configurable: true, value: Object.assign(new EventTarget(), { visibilityState: "visible" }) });
});
afterEach(() => { jest.useRealTimers(); });

test("expires after 30 minutes and does not affect a different login token", () => {
  rememberDesktopActivity("a");
  expect(desktopIdleExpired("a")).toBe(false);
  jest.advanceTimersByTime(DESKTOP_IDLE_MS);
  expect(desktopIdleExpired("a")).toBe(true);
  expect(desktopIdleExpired("b")).toBe(false);
});
test("expires idle tabs and never revives an expired tab on interaction", () => {
  const expire = jest.fn();
  const stop = watchDesktopIdle("a", expire);
  jest.setSystemTime(Date.now() + DESKTOP_IDLE_MS + 1);
  window.dispatchEvent(new Event("pointerdown"));
  expect(expire).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  expect(expire).toHaveBeenCalledTimes(1);
  stop();
});
test("genuine activity extends the session, background polling does not", () => {
  const expire = jest.fn();
  const stop = watchDesktopIdle("a", expire);
  jest.advanceTimersByTime(DESKTOP_IDLE_MS - 2000);
  window.dispatchEvent(new Event("keydown"));
  jest.advanceTimersByTime(3000);
  expect(expire).not.toHaveBeenCalled();
  jest.advanceTimersByTime(DESKTOP_IDLE_MS);
  expect(expire).toHaveBeenCalledTimes(1);
  stop();
});
