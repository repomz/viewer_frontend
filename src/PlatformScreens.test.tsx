import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { CredentialsCard, MetricsScreen } from "./PlatformScreens";
import { changeCredentials, getPlatformMetrics } from "./api";

jest.mock("./api", () => ({ changeCredentials: jest.fn(), getPlatformMetrics: jest.fn() }));
jest.mock("./ui", () => {
  const React = jest.requireActual("react");
  const { Text, TextInput, Pressable } = jest.requireActual("react-native");
  return {
    Button: ({ label, onPress, disabled }: any) => React.createElement(Pressable, { onPress, disabled }, React.createElement(Text, null, label)),
    Field: ({ label, ...props }: any) => React.createElement(TextInput, { ...props, accessibilityLabel: label }),
    Icon: () => null,
    LoadingState: () => null,
    InlineError: ({ message }: any) => React.createElement(Text, null, message)
  };
});

const user = { id: 1, display_name: "Тест", login: "test", role: "user" as const, quota_bytes: 100 };

beforeEach(() => jest.clearAllMocks());

test("mobile metrics include both login totals and personal drive usage", async () => {
  jest.mocked(getPlatformMetrics).mockResolvedValue({
    date: "2026-09-27", total_logins: 3, all_time_logins: 9, protocol_count: 1800,
    disk_total_bytes: 100, disk_used_bytes: 30, disk_free_bytes: 70,
    memory_total_bytes: 100, memory_used_bytes: 20,
    logins: [{ user_id: 1, display_name: "Тест", login: "test", count: 3, total: 9, disk_used_bytes: 2 * 1048576 }]
  });
  const screen = render(<MetricsScreen compact />);
  await waitFor(() => expect(screen.getByText("Протоколов")).toBeTruthy());
  expect(screen.getByText("Входов")).toBeTruthy();
  expect(screen.getByText("Память")).toBeTruthy();
  expect(screen.getByText("Диск 2 МБ")).toBeTruthy();
});

test("credentials are hidden until selected and cancel clears edits", () => {
  const screen = render(<CredentialsCard user={user} onUpdated={jest.fn()} />);
  expect(screen.queryByLabelText("Текущий пароль")).toBeNull();
  fireEvent.press(screen.getByText("Сменить пароль"));
  expect(screen.queryByLabelText("Новый логин")).toBeNull();
  fireEvent.changeText(screen.getByLabelText("Новый пароль"), "new-password");
  fireEvent.press(screen.getByText("Отмена"));
  fireEvent.press(screen.getByText("Сменить логин"));
  expect(screen.queryByLabelText("Новый пароль")).toBeNull();
  expect(screen.getByLabelText("Текущий пароль").props.value).toBe("");
});

test("changing login never sends an unrelated password change", async () => {
  const updated = jest.fn();
  const result = { token: "new-token", user: { ...user, login: "updated" } };
  jest.mocked(changeCredentials).mockResolvedValue(result);
  const screen = render(<CredentialsCard user={user} onUpdated={updated} />);
  fireEvent.press(screen.getByText("Сменить логин"));
  fireEvent.changeText(screen.getByLabelText("Новый логин"), "updated");
  fireEvent.changeText(screen.getByLabelText("Текущий пароль"), "current");
  fireEvent.press(screen.getByText("Сохранить"));
  await waitFor(() => expect(updated).toHaveBeenCalledWith(result));
  expect(changeCredentials).toHaveBeenCalledWith({ currentPassword: "current", newLogin: "updated", newPassword: "" });
  expect(screen.queryByLabelText("Текущий пароль")).toBeNull();
});

test("password rejection leaves the form open and does not change the session", async () => {
  const updated = jest.fn();
  jest.mocked(changeCredentials).mockRejectedValue(new Error("Неверный текущий пароль"));
  const screen = render(<CredentialsCard user={user} onUpdated={updated} />);
  fireEvent.press(screen.getByText("Сменить пароль"));
  fireEvent.changeText(screen.getByLabelText("Новый пароль"), "new-password");
  fireEvent.changeText(screen.getByLabelText("Текущий пароль"), "wrong");
  fireEvent.press(screen.getByText("Сохранить"));
  await waitFor(() => expect(screen.getByText("Неверный текущий пароль")).toBeTruthy());
  expect(changeCredentials).toHaveBeenCalledWith({ currentPassword: "wrong", newLogin: "", newPassword: "new-password" });
  expect(updated).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Новый пароль")).toBeTruthy();
});
