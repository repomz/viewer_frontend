import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Image } from "react-native";
import App from "../App";
import * as api from "./api";
import * as authStorage from "./authStorage";

jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () => {
  const React = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(View, null, children),
    SafeAreaView: ({ children }: any) => React.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(authStorage, "loadAuth").mockReturnValue(null);
  jest.spyOn(authStorage, "saveAuth").mockImplementation(() => undefined);
  // Simulate a slow connection: clinical data never finishes loading.
  jest.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test("first login opens the workspace without waiting for clinical requests", async () => {
  const studies = jest.spyOn(api, "getStudies");
  jest.spyOn(api, "login").mockResolvedValue({
    token: "test", user: { id: 1, login: "test", display_name: "Тест", role: "admin", quota_bytes: 0 },
  });
  const screen = render(<App />);
  fireEvent(screen.UNSAFE_getByType(Image), "loadEnd");
  act(() => jest.advanceTimersByTime(1500));
  expect(studies).not.toHaveBeenCalled();
  expect(screen.queryByText("Подготавливаем рабочее пространство")).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText("Логин"), "test");
  fireEvent.changeText(screen.getByPlaceholderText("Пароль"), "password");
  fireEvent.press(screen.getByLabelText("Войти"));
  await waitFor(() => expect(screen.queryByPlaceholderText("Пароль")).toBeNull());
  expect(studies).toHaveBeenCalledTimes(1);
  expect(authStorage.saveAuth).toHaveBeenCalled();
  screen.unmount();
});

test("failed login keeps the form available for retry", async () => {
  jest.spyOn(api, "login").mockRejectedValue(new api.ApiError("Неверный пароль", 401));
  const screen = render(<App />);
  fireEvent(screen.UNSAFE_getByType(Image), "loadEnd");
  act(() => jest.advanceTimersByTime(1500));
  fireEvent.changeText(screen.getByPlaceholderText("Логин"), "test");
  fireEvent.changeText(screen.getByPlaceholderText("Пароль"), "wrong");
  fireEvent.press(screen.getByLabelText("Войти"));
  await waitFor(() => expect(screen.getByText("Неверный пароль")).toBeTruthy());
  expect(authStorage.saveAuth).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Войти").props.accessibilityState?.disabled).not.toBe(true);
  screen.unmount();
});

test.each([0, 401, 403])("stored-session verification handles status %s", async (status) => {
  jest.mocked(authStorage.loadAuth).mockReturnValue({
    token: "existing", user: { id: 1, login: "test", display_name: "Тест", role: "admin", quota_bytes: 0 },
  });
  const clear = jest.spyOn(authStorage, "clearAuth").mockImplementation(() => undefined);
  jest.spyOn(api, "getCurrentUser").mockRejectedValue(new api.ApiError("Ошибка проверки", status));
  const screen = render(<App />);
  await act(async () => {});
  if (status === 0) {
    expect(clear).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Пароль")).toBeNull();
  } else {
    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText("Пароль")).toBeTruthy();
  }
  screen.unmount();
});
