import {fireEvent, render} from "@testing-library/react-native";
import {Alert} from "react-native";
import {AngiographyScreen} from "../App";
import {getDicomCacheSnapshot} from "./dicomOfflineCache";
import type {Study} from "./types";

jest.mock("expo-status-bar", () => ({StatusBar: () => null}));
jest.mock("react-native-safe-area-context", () => ({SafeAreaProvider: ({children}: any) => children, useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0})}));
jest.mock("@expo/vector-icons", () => ({Ionicons: () => null}));
jest.mock("./MobileDicomViewer", () => ({MobileDicomViewer: () => null}));

const study = {id:"ct-1", study_id:"1.2.3", patient:"Тестовый И.И.", study_type:"ct",time_beginning:"2026-10-28T10:00:00Z"} as Study;
const props = {requests:[],studies:[study],loading:false,error:"",persistentCacheEnabled:false,dicomCache:getDicomCacheSnapshot(),onRetry:()=>{},onDeleteLocal:async()=>{},deletionJobs:[],onSearch:()=>{},initialStudyUID:null,onInitialStudyHandled:()=>{}};
afterEach(()=>jest.restoreAllMocks());

test.each([true,false])("admin can delete CT with confirmation, compact=%s",compact=>{
  const remove=jest.fn(async()=>{});
  const confirm=jest.spyOn(Alert,"alert").mockImplementation(()=>{});
  const screen=render(<AngiographyScreen {...props} compact={compact} onDeleteEverywhere={remove}/>);
  fireEvent.press(screen.getByText("CT"));
  fireEvent.press(screen.getByLabelText("Действия с Тестовый И.И."),{stopPropagation:()=>{}});
  expect(screen.queryByText("Удалить")).toBeNull();
  fireEvent.press(screen.getByText("Удалить везде"));
  expect(remove).not.toHaveBeenCalled();
  const buttons=confirm.mock.calls[0]?.[2];
  expect(confirm.mock.calls[0]?.[1]).toContain("Протокол операции и оригинал в больнице останутся");
  buttons?.find(b=>b.text==="Удалить")?.onPress?.();
  expect(remove).toHaveBeenCalledWith(study);
  screen.unmount();
});

test.each([true,false])("non-admin has no CT deletion action, compact=%s",compact=>{
  const screen=render(<AngiographyScreen {...props} compact={compact}/>);
  fireEvent.press(screen.getByText("CT"));
  expect(screen.queryByLabelText("Действия с Тестовый И.И.")).toBeNull();
  screen.unmount();
});
