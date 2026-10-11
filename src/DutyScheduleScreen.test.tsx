import { act, fireEvent, render } from "@testing-library/react-native";
import { DutyScheduleScreen } from "../App";
import * as api from "./api";
import type { DutySchedule } from "./types";
import { Platform } from "react-native";
import * as scheduleTools from "./dutySchedule";

jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }: any) => children, useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const schedule: DutySchedule = {month:"2026-10",holidays:[],updated_at:"",groups:[
  {id:"surgeons",label:"Хирурги",staff:[{id:"surgeon",name:"Хирург",shifts:{"11:duty":"24"},role:"duty_only"}]},
  {id:"nurses",label:"Медсёстры",staff:[{id:"nurse",name:"Медсестра",shifts:{"11:duty":"16"},role:"duty_only",review:{"12:duty":true}}]}
]};
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-11T05:00:00Z"));
  jest.spyOn(api,"getDutySchedule").mockResolvedValue(schedule);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test("web viewers see nurses but cannot edit or upload", async () => {
  const screen=render(<DutyScheduleScreen compact={false} admin={false} schedule={schedule} loading={false} error="" onRetry={()=>{}} onSave={async()=>{}}/>);
  await act(async()=>{});
  expect(screen.getByTestId("schedule-name-nurse")).toBeTruthy();
  expect(screen.queryByText("Внести изменения")).toBeNull();
  expect(screen.queryByText("Загрузить график")).toBeNull();
  screen.unmount();
});
test("mobile shows surgeons and duty nurse, not nurse grid", async () => {
  const screen=render(<DutyScheduleScreen compact admin schedule={schedule} loading={false} error="" onRetry={()=>{}} onSave={async()=>{}}/>);
  await act(async()=>{});
  expect(screen.queryByTestId("schedule-name-nurse")).toBeNull();
  expect(screen.getByText("Опер медсестра:")).toBeTruthy();
  expect(screen.getByText("Медсестра")).toBeTruthy();
  expect(screen.getByLabelText("Загрузить график")).toBeTruthy();
  screen.unmount();
});
test("admin corrections clear review flags and save both groups", async () => {
  const save=jest.fn(async()=>{});
  const screen=render(<DutyScheduleScreen compact={false} admin schedule={schedule} loading={false} error="" onRetry={()=>{}} onSave={save}/>);
  await act(async()=>{});
  fireEvent.press(screen.getByText("Внести изменения"));
  fireEvent.press(screen.getAllByText("16")[0]!);
  fireEvent.press(screen.getByLabelText("Медсестра, 12: пусто, проверить"));
  await act(async()=>fireEvent.press(screen.getByText("Сохранить график")));
  expect(save.mock.calls.length).toBe(1);
  const saved=(save.mock.calls as unknown as [DutySchedule][])[0]![0];
  expect(saved.groups[1]!.staff[0]!.shifts["12:duty"]).toBe("16");
  expect(saved.groups[1]!.staff[0]!.review?.["12:duty"]).toBeUndefined();
  screen.unmount();
});

test("mobile photo recognition saves immediately without confirmation", async () => {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
  try {
    jest.spyOn(scheduleTools, "selectSchedulePhoto").mockResolvedValue(new Blob(["photo"], {type:"image/jpeg"}));
    jest.spyOn(api, "recognizeDutySchedule").mockResolvedValue(schedule);
    const save=jest.fn(async()=>{});
    const screen=render(<DutyScheduleScreen compact admin schedule={schedule} loading={false} error="" onRetry={()=>{}} onSave={save}/>);
    await act(async()=>fireEvent.press(screen.getByLabelText("Загрузить график")));
    expect(save).toHaveBeenCalledWith(schedule);
    expect(screen.queryByText("Сохранить график")).toBeNull();
    expect(screen.queryByTestId("schedule-name-nurse")).toBeNull();
    screen.unmount();
  } finally { Object.defineProperty(Platform, "OS", {configurable:true,value:originalOS}); }
});
