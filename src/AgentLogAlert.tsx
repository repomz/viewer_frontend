import React, {useEffect, useState} from "react";
import {View} from "react-native";
import {getAgentLogAlerts} from "./api";
import {colors} from "./theme";
import {Icon} from "./ui";

/** Mounted only in admin navigation. No full log downloads for the indicator. */
export function AgentLogAlert({color = colors.textMuted, size = 20, selected = false}: {color?: string; size?: number; selected?: boolean}) {
  const [issues, setIssues] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void getAgentLogAlerts().then(value => {if(live) setIssues(value.has_issues);}).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {live=false;clearInterval(timer);};
  }, []);
  return <View accessibilityLabel={issues ? "В журналах есть ошибки или предупреждения" : "Логи"}>
    <Icon name={selected ? "warning" : "warning-outline"} size={size} color={issues ? colors.danger : color} />
  </View>;
}
