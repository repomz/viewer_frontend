import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { getPaymentRules, savePaymentRules, setStudyPayment, type PaymentRules, type PaymentRule } from "./api";
import { loadAuth } from "./authStorage";
import type { Study } from "./types";
import { colors } from "./theme";
import { Button } from "./ui";
import { operationTypeLabels } from "./studyOperationCategories";

const updates = new Map<string, Study>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function usePaymentStudy(study: Study) {
  const updated = useSyncExternalStore(subscribe, () => updates.get(study.id));
  return updated && updated.updated_at >= study.updated_at ? updated : study;
}
export function paymentLabel(study: Study) { return study.payment_pending ? "ВМП ?" : study.payment === "vmp" ? "ВМП" : "ОМС"; }
export function PaymentBadge({ study, editable = false }: { study: Study; editable?: boolean }) {
  const current = usePaymentStudy(study);
  const user = loadAuth()?.user;
  const currentYear = new Date(study.time_beginning).toLocaleDateString("en-CA", {timeZone:"Asia/Tomsk",year:"numeric"}) === new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Tomsk",year:"numeric"});
  const permitted = editable && currentYear && (user?.role === "admin" || user?.can_confirm_payment);
  const [open,setOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const choose = async (payment: "oms" | "vmp") => {
    setBusy(true);setError("");
    try { const result=await setStudyPayment(study.id,payment); updates.set(study.id,result);listeners.forEach(fn=>fn());setOpen(false); }
    catch {setError("Не удалось сохранить оплату");} finally {setBusy(false);}
  };
  if (!current.payment && !current.payment_pending) return null;
  return <View style={{ alignItems:"flex-end",gap:6 }}>
    <Pressable disabled={!permitted || busy} onPress={()=>setOpen(!open)} accessibilityRole="button" accessibilityLabel="Оплата операции">
      <Text style={{ color:current.payment_pending ? colors.danger : colors.textDim,fontSize:12,fontWeight:"600" }}>{paymentLabel(current)}</Text>
    </Pressable>
    {open && permitted ? <View style={{ flexDirection:"row",gap:6 }}>
      {(["oms","vmp"] as const).map(value=><Button key={value} compact label={value.toUpperCase() === "OMS" ? "ОМС" : "ВМП"} disabled={busy} onPress={()=>void choose(value)} />)}
    </View>:null}
    {error ? <Text style={{color:colors.danger,fontSize:11}}>{error}</Text>:null}
  </View>;
}

export function usePaymentRules() {
  const [data,setData]=useState<PaymentRules|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{let live=true;void getPaymentRules().then(v=>{if(live)setData(v);}).catch(()=>{if(live)setError("Не удалось загрузить правила ВМП");});return()=>{live=false;};},[]);
  return {data,setData,error};
}

export function planPaymentMode(operation: string, rules: PaymentRule[]): "auto"|"review"|null {
  const value=operation.toLowerCase();
  const types=new Set<string>();
  if (/каг.*стент/.test(value)) types.add("стент_кор");
  else if (value.includes("каг")) types.add("каг");
  if(value.includes("цаг")) types.add("цаг");
  if(value.includes("стент вса")) types.add("стент_вса");
  if(/стент.*(?:опа|нпа|н\/к)/.test(value)) types.add("стент_нк");
  if(/стент.*(?:подключ|в\/к)/.test(value)) types.add("стент_вк");
  if(/бап голен/.test(value)) types.add("бап_голень");
  if(value.includes("фистул")) types.add("бап_фистулы");
  if(value.includes("эма")) types.add("эма");
  if(value.includes("экс")) types.add("ЭКС");
  types.add(operation);
  const matched=rules.filter(r=>r.field==="study_type" ? types.has(r.value) : value.split(/[;,]/).map(option=>option.trim()).includes(r.value));
  return matched.some(r=>r.mode==="auto") ? "auto" : matched.length ? "review" : null;
}

export function PaymentRulesSettings() {
  const {data,setData,error}=usePaymentRules();
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  const change=(field:PaymentRule["field"],value:string,mode:PaymentRule["mode"]|null)=>{
    if(!data)return;
    setData({...data,rules:[...data.rules.filter(r=>r.field!==field||r.value!==value),...(mode?[{field,value,mode}]:[])]});setMessage("");
  };
  const save=async()=>{if(!data)return;setBusy(true);try{setData(await savePaymentRules(data.rules));setMessage("Правила сохранены");}catch{setMessage("Не удалось сохранить правила");}finally{setBusy(false);}};
  const types=[...new Set([...(data?.study_types??[]), ...Object.keys(operationTypeLabels).map(value => value.startsWith("экс") ? value.replaceAll("_", " ") : value)])];
  return <View style={{padding:16,gap:12}}>
    <Text style={{fontSize:18,fontWeight:"700",color:colors.text}}>ВМП</Text>
    <Text style={{color:colors.textMuted}}>Достаточно любого правила. Одна операция учитывается один раз. Подтверждение в протоколе имеет приоритет.</Text>
    {error ? <Text style={{color:colors.danger}}>{error}</Text>:null}
    {data ? [...types.map(value=>({field:"study_type" as const,value})),...(["ivus","vabk","ekmo"] as const).map(value=>({field:"options" as const,value}))].map(({field,value})=>{
      const mode=data.rules.find(r=>r.field===field&&r.value===value)?.mode;
      return <View key={`${field}:${value}`} style={{gap:6,paddingVertical:6,borderBottomWidth:1,borderBottomColor:colors.border}}>
        <Text style={{color:colors.text,fontWeight:"600"}}>{field==="options" ? ({ivus:"ВСУЗИ (ivus)",vabk:"ВАБК",ekmo:"ЭКМО"} as Record<string,string>)[value] : value}</Text>
        <View style={{flexDirection:"row",gap:6,flexWrap:"wrap"}}>
          {[{label:"Не назначать",mode:null},{label:"Автоматически",mode:"auto" as const},{label:"Уточнить",mode:"review" as const}].map(option=><Button compact key={option.label} label={option.label} variant={(mode??null)===option.mode ? "primary":"ghost"} onPress={()=>change(field,value,option.mode)} />)}
        </View>
      </View>;
    }):null}
    <Button label="Сохранить правила ВМП" loading={busy} disabled={!data} onPress={()=>void save()} />
    {message ? <Text style={{color:colors.textMuted}}>{message}</Text>:null}
  </View>;
}
