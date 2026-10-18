import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import {AgentFileRequest} from "./AgentFileRequest";
import {getAgentFileRequests, getUserRequest, requestAgentFile} from "./api";
import type {UserRequest} from "./types";

jest.mock("./api", () => ({getAgentFileRequests: jest.fn(), getUserRequest: jest.fn(), requestAgentFile: jest.fn()}));
beforeEach(() => {jest.clearAllMocks(); jest.mocked(getAgentFileRequests).mockResolvedValue([]);});

test("requests original from selected agent and prevents repeat while queued", async () => {
  jest.mocked(requestAgentFile).mockResolvedValue({id: "one", status: "pending"} as UserRequest);
  const screen = render(<AgentFileRequest agentId={2} />);
  fireEvent.press(screen.getByText(/Исходный протокол/));
  fireEvent.changeText(screen.getByLabelText("Путь к исходному протоколу"), "C:\\Протокол.docx");
  fireEvent.press(screen.getByText("Получить"));
  await waitFor(() => expect(screen.getByText(/Ожидаем агента/)).toBeTruthy());
  expect(requestAgentFile).toHaveBeenCalledWith(2, "C:\\Протокол.docx");
  fireEvent.press(screen.getByText("Получить"));
  expect(requestAgentFile).toHaveBeenCalledTimes(1);
  screen.unmount();
});

test("restores pending job and reports successful delivery", async () => {
  jest.useFakeTimers();
  jest.mocked(getAgentFileRequests).mockResolvedValue([{id: "one", status: "in_progress"} as UserRequest]);
  jest.mocked(getUserRequest).mockResolvedValue({id: "one", status: "completed"} as UserRequest);
  const screen = render(<AgentFileRequest agentId={1} />);
  await act(async () => {});
  expect(screen.getByText(/Агент отправляет/)).toBeTruthy();
  await act(async () => {jest.advanceTimersByTime(5000);});
  expect(screen.getByText("Файл сохранён на вашем диске")).toBeTruthy();
  screen.unmount();
  jest.useRealTimers();
});
