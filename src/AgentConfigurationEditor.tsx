import React, {useEffect,useState} from "react";
import {Text,View,Switch} from "react-native";
import {type AgentConfiguration,type EditableAgentConfiguration,getUserRequest,updateAgentConfiguration} from "./api";
import {Button,Field} from "./ui";
import {colors} from "./theme";

const pollingNames = {study_polling:"Протоколы",xa_polling:"XA",ct_polling:"CT",user_requests_polling:"Команды"} as const;
export function AgentConfigurationEditor({agent,onApplied}:{agent:AgentConfiguration;onApplied:()=>void}) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(agent.configuration);
  const [pending,setPending]=useState<string|null>(agent.pending_request_id||null);
  const [intervals,setIntervals]=useState<Record<string,string>>({});
  const [directories,setDirectories]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{if(!editing&&!pending)setDraft(agent.configuration);},[agent,editing,pending]);
  useEffect(()=>{
    if(!pending)return;
    let live=true;
    const check=async()=>{try{
      const result=await getUserRequest(pending);
      if(!live)return;
      if(result.status==="completed") {setMessage("Настройки применены агентом");setPending(null);setEditing(false);onApplied();}
      if(result.status==="error") {setMessage(result.errors||"Агент не применил настройки");setPending(null);}
    }catch{if(live)setMessage("Не удалось проверить применение. Ожидаем связь…");}};
    void check();const timer=setInterval(()=>void check(),5000);
    return()=>{live=false;clearInterval(timer);};
  },[pending,onApplied]);
  const save=async()=>{
    setBusy(true);setMessage("");
    const {description,heartbeat_interval_min,study_polling,xa_polling,ct_polling,user_requests_polling}=draft;
    const settings:EditableAgentConfiguration={description,heartbeat_interval_min:Number(intervals.heartbeat??heartbeat_interval_min),study_polling:{...study_polling,operations_dir:directories.split("\n").map(v=>v.trim()).filter(Boolean)},xa_polling:{...xa_polling},ct_polling:{...ct_polling},user_requests_polling:{...user_requests_polling}};
    for(const key of Object.keys(pollingNames) as (keyof typeof pollingNames)[]) settings[key]={...settings[key],interval_min:Number((intervals[key]??String(settings[key].interval_min)).replace(",","."))};
    try {const result=await updateAgentConfiguration(agent.agent_id,settings);setPending(result.id);setMessage("Отправлено. Ожидаем подтверждение агента…");}
    catch(error){setMessage(error instanceof Error?error.message:"Не удалось отправить настройки");}finally{setBusy(false);}
  };
  const disabled=busy||!!pending;
  return <View style={{padding:16,gap:12,borderWidth:1,borderColor:colors.border,borderRadius:16,backgroundColor:colors.surface}}>
    <Text style={{color:colors.text,fontWeight:"700",fontSize:17}}>Агент {agent.agent_id} · {agent.configuration.description}</Text>
    <Text style={{color:colors.textMuted}}>Версия {agent.configuration.version} · конфигурация от {new Date(agent.received_at).toLocaleString("ru-RU")}</Text>
    {!editing?<View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{(Object.keys(pollingNames) as (keyof typeof pollingNames)[]).map(key=><Text key={key} style={{color:colors.textMuted,padding:8,borderRadius:8,backgroundColor:colors.surfaceSoft}}>{pollingNames[key]}: {agent.configuration[key].state?`${agent.configuration[key].interval_min} мин`:"выкл."}</Text>)}</View>:null}
    {!agent.configuration.remote_configuration?<Text style={{color:colors.textMuted}}>Для редактирования обновите агента до 0.2.16 или новее.</Text>:null}
    {!editing?<Button compact label={pending?"Ожидаем применения…":"Изменить настройки"} disabled={!!pending||!agent.configuration.remote_configuration} onPress={()=>{setIntervals({heartbeat:String(draft.heartbeat_interval_min)});setDirectories((draft.study_polling.operations_dir??[]).join("\n"));setEditing(true);}} />:null}
    {editing?<>
      <Field label="Описание агента" value={draft.description} editable={!disabled} onChangeText={description=>setDraft({...draft,description})} />
      <Field label="Связь с сервером, мин (1–60)" value={intervals.heartbeat??""} keyboardType="decimal-pad" editable={!disabled} onChangeText={v=>setIntervals({...intervals,heartbeat:v.replace(",",".")})} />
      {(Object.keys(pollingNames) as (keyof typeof pollingNames)[]).map(key=><View key={key} style={{gap:6,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.border}}>
        <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text style={{color:colors.text,fontWeight:"600"}}>{pollingNames[key]}</Text><Switch accessibilityLabel={pollingNames[key]} value={draft[key].state} disabled={disabled||key==="user_requests_polling"} onValueChange={state=>setDraft({...draft,[key]:{...draft[key],state}})} /></View>
        <Field label={`${pollingNames[key]}: интервал, мин`} value={intervals[key]??String(draft[key].interval_min)} editable={!disabled} keyboardType="decimal-pad" onChangeText={v=>setIntervals({...intervals,[key]:v})} />
      </View>)}
      <Field label="Папки протоколов — каждая с новой строки" multiline value={directories} editable={!disabled} onChangeText={setDirectories} />
      <Text style={{color:colors.textMuted}}>Опрос команд всегда включён. Пути к состоянию, ключи доступа и адрес сервера удалённо не меняются.</Text>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}><Button label="Применить на агенте" loading={busy} disabled={disabled} onPress={()=>void save()} /><Button label="Отмена" variant="ghost" disabled={disabled} onPress={()=>{setEditing(false);setMessage("");}} /></View>
    </>:null}
    {message?<Text accessibilityLiveRegion="polite" style={{color:colors.textMuted}}>{message}</Text>:null}
  </View>;
}
