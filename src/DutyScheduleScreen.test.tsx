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
  const published = {...schedule, published:true, source_uploaded_at:"2026-10-11T00:00:00Z",groups:schedule.groups.map(g=>({...g,staff:g.staff.map(s=>({...s,review:{}}))}))};
  jest.mocked(api.getDutySchedule).mockResolvedValue(published);
  const screen=render(<DutyScheduleScreen compact={false} admin={false} schedule={published} loading={false} error="" onRetry={()=>{}} onSave={async()=>{}}/>);
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
    expect(save).not.toHaveBeenCalled(); // Recognition now persists atomically on the server.
    expect(screen.queryByText("Сохранить график")).toBeNull();
    expect(screen.queryByTestId("schedule-name-nurse")).toBeNull();
    screen.unmount();
  } finally { Object.defineProperty(Platform, "OS", {configurable:true,value:originalOS}); }
});

test("unpublished or flagged cached schedules are hidden from regular users", async () => {
  const screen=render(<DutyScheduleScreen compact admin={false} schedule={{...schedule,published:true,source_uploaded_at:"2026-10-11"}} loading={false} error="" onRetry={()=>{}} onSave={async()=>{}}/>);
  await act(async()=>{});
  expect(screen.queryByTestId("schedule-name-surgeon")).toBeNull();
  expect(screen.getByText(/График ещё не опубликован/)).toBeTruthy();
  screen.unmount();
});

test("November photo is sent to November even while October refreshes", async () => {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
  try {
    const november = { ...schedule, month: "2026-11" };
    jest.mocked(api.getDutySchedule).mockImplementation(async month => month === "2026-11" ? november : schedule);
    let select!: (photo: Blob) => void;
    jest.spyOn(scheduleTools, "selectSchedulePhoto").mockImplementation(() => new Promise(resolve => { select = resolve; }));
    const recognize = jest.spyOn(api, "recognizeDutySchedule").mockResolvedValue(november);
    const retry = jest.fn();
    const props = { compact: true, admin: true, schedule, loading: false, error: "", onRetry: retry, onSave: async () => {} };
    const screen = render(<DutyScheduleScreen {...props} />);
    await act(async () => fireEvent.press(screen.getByLabelText("Следующий")));
    await act(async () => fireEvent.press(screen.getByLabelText("Загрузить график")));
    screen.rerender(<DutyScheduleScreen {...props} schedule={{ ...schedule }} />);
    const photo = new Blob(["photo"], { type: "image/jpeg" });
    await act(async () => select(photo));
    expect(recognize).toHaveBeenCalledWith("2026-11", photo);
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByText(/ноябрь/i)).toBeTruthy();
    screen.unmount();
  } finally { Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS }); }
});

test("mobile review information is an overlay, not an extra table row", async () => {
  const screen=render(<DutyScheduleScreen compact admin schedule={schedule} loading={false} error="" onRetry={()=>{}} onSave={async()=>{}}/>);
  await act(async()=>{});
  expect(screen.queryByText(/Красные ячейки требуют/)).toBeNull();
  fireEvent.press(screen.getByLabelText("Информация о графике"));
  expect(screen.getByText(/Красные ячейки требуют/)).toBeTruthy();
  expect(screen.getByTestId("schedule-row-surgeon-duty").props.style).toMatchObject({height:42});
  screen.unmount();
});
