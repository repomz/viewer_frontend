import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { PlanScreen } from "../App";
import { sharePlanSnapshot } from "./planSnapshot";

jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({children}: any) => children, useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("./planSnapshot", () => ({ sharePlanSnapshot: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./PaymentUI", () => ({ usePaymentRules: () => ({ data: {rules:[]} }), planPaymentMode: () => null }));

const plan = { week_start: "2026-10-26", days: Array.from({ length: 5 }, (_, i) => ({ date: `2026-10-${26+i}`, entries: [] })) };
const props = { plan, loading:false, error:"", weekOffset:0 as const, onWeekChange:jest.fn(), onRetry:jest.fn(), onSave:jest.fn() };
beforeEach(() => jest.clearAllMocks());
test("mobile opens a weekday/week choice and exports the selected Friday", async () => {
  const screen = render(<PlanScreen {...props} compact />);
  fireEvent.press(screen.getByLabelText("Отправить снимок"));
  expect(sharePlanSnapshot).not.toHaveBeenCalled();
  expect(screen.getByText("Вся неделя")).toBeTruthy();
  for (const day of plan.days) expect(screen.getByText(new Date(`${day.date}T12:00:00`).toLocaleDateString("ru-RU", { weekday:"long",day:"2-digit",month:"2-digit" }))).toBeTruthy();
  fireEvent.press(screen.getByText("пятница, 30.10"));
  await waitFor(() => expect(sharePlanSnapshot).toHaveBeenCalledWith(plan, "2026-10-30"));
});
test("whole week is explicitly selectable", async () => {
  const screen = render(<PlanScreen {...props} compact />);
  fireEvent.press(screen.getByLabelText("Отправить снимок"));
  fireEvent.press(screen.getByText("Вся неделя"));
  await waitFor(() => expect(sharePlanSnapshot).toHaveBeenCalledWith(plan, undefined));
});
test("desktop does not show the mobile share action", () => {
  const screen = render(<PlanScreen {...props} compact={false} />);
  expect(screen.queryByLabelText("Отправить снимок")).toBeNull();
});
