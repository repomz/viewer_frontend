import {fireEvent,render,waitFor} from "@testing-library/react-native";
import {AgentConfigurationEditor} from "./AgentConfigurationEditor";
import {getUserRequest,updateAgentConfiguration,type AgentConfiguration} from "./api";
jest.mock("./api",()=>({getUserRequest:jest.fn(),updateAgentConfiguration:jest.fn()}));
jest.mock("./ui",()=>{
  const React=jest.requireActual("react");const {Pressable,Text,TextInput}=jest.requireActual("react-native");
  return {Button:({label,onPress,disabled}:any)=>React.createElement(Pressable,{onPress,disabled},React.createElement(Text,null,label)),Field:({label,...props}:any)=>React.createElement(TextInput,{...props,accessibilityLabel:label})};
});
const agent:AgentConfiguration={agent_id:2,received_at:"2026-10-14T03:00:00Z",configuration:{version:"0.2.16",remote_configuration:true,description:"Опер 2",log_dir:"logs",state_file:"state.json",pacs_config_path:"config.json",heartbeat_interval_min:1,study_polling:{state:true,interval_min:5,operations_dir:["C:\\studies"]},xa_polling:{state:true,interval_min:10},ct_polling:{state:false,interval_min:10},user_requests_polling:{state:true,interval_min:1}}};
beforeEach(()=>jest.clearAllMocks());
test("keeps multiline paths editable and awaits agent acknowledgement",async()=>{
  jest.mocked(updateAgentConfiguration).mockResolvedValue({id:"job"} as any);
  jest.mocked(getUserRequest).mockResolvedValue({status:"completed"} as any);
  const applied=jest.fn();const screen=render(<AgentConfigurationEditor agent={agent} onApplied={applied}/>);
  fireEvent.press(screen.getByText("Изменить настройки"));
  const label="Папки протоколов — каждая с новой строки";
  fireEvent.changeText(screen.getByLabelText(label),"C:\\studies\n");
  expect(screen.getByLabelText(label).props.value).toBe("C:\\studies\n");
  fireEvent.changeText(screen.getByLabelText(label),"C:\\studies\nD:\\protocols");
  fireEvent.changeText(screen.getByLabelText("XA: интервал, мин"),"2,5");
  fireEvent.press(screen.getByText("Применить на агенте"));
  await waitFor(()=>expect(applied).toHaveBeenCalled());
  expect(updateAgentConfiguration).toHaveBeenCalledWith(2,expect.objectContaining({xa_polling:{state:true,interval_min:2.5},study_polling:expect.objectContaining({operations_dir:["C:\\studies","D:\\protocols"]})}));
  expect(screen.getByText("Настройки применены агентом")).toBeTruthy();
});
test("restores pending request after reopening settings",async()=>{
  jest.mocked(getUserRequest).mockResolvedValue({status:"pending"} as any);
  const screen=render(<AgentConfigurationEditor agent={{...agent,pending_request_id:"existing"}} onApplied={jest.fn()}/>);
  await waitFor(()=>expect(getUserRequest).toHaveBeenCalledWith("existing"));
  expect(screen.getByText("Ожидаем применения…")).toBeTruthy();
  expect(updateAgentConfiguration).not.toHaveBeenCalled();
});
