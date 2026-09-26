export function agentLogGroups(content: string, importantOnly = false) {
  const groups: { level: string; text: string }[] = [];
  let level = "INFO";
  for (const raw of content.split("\n")) {
    const match = raw.match(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})(?:,\d+)?\s*\|\s*(\w+)\s*\|\s*agent_\d+\s*\|\s*([^|]+)\|\s?(.*)$/);
    if (match) level = match[2]!;
    if (importantOnly && !["WARNING", "ERROR", "CRITICAL"].includes(level)) continue;
    const text = match ? `${match[1]} ${level} ${match[3]!.trim().replace(/^hospital_agent\//, "")} | ${match[4]}` : raw;
    const previous = groups[groups.length - 1];
    if (previous?.level === level) previous.text += "\n" + text;
    else groups.push({ level, text });
  }
  return groups;
}
