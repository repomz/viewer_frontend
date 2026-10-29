import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radii } from "./theme";

export const anesthesiologists = ["Студницкий А.В.", "Кирилин В.В.", "Дядянов А.Э.", "Зимин И.А.", "Соловцов А.М.", "Плотников С.А.", "Чернышев А."];
export const surgeons = ["Киргизов А.А.", "Идрисов М.З.", "Старков А.С.", "Шпилевой М.П.", "Суслов И.В."];

export function AnesthesiologistPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return <DoctorPicker value={value} onChange={onChange} names={anesthesiologists} label="ФИО анестезиолога" listLabel="Список анестезиологов" />;
}

export function DoctorPicker({ value, onChange, names, label, listLabel }: { value: string; onChange: (name: string) => void; names: string[]; label: string; listLabel: string }) {
  const [open, setOpen] = useState(false);
  const query = value.toLocaleLowerCase("ru").replace(/[.\s]/g, "");
  const options = names.filter(name => name.toLocaleLowerCase("ru").replace(/[.\s]/g, "").includes(query));
  return <View>
    <View style={styles.field}>
      <TextInput accessibilityLabel={label} value={value}
        placeholder="Выберите или введите фамилию" placeholderTextColor={colors.textDim}
        autoComplete="off" autoCorrect={false} onFocus={() => setOpen(true)}
        onChangeText={name => { onChange(name); setOpen(true); }} style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel={listLabel}
        accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle}>
        <Text style={styles.arrow}>{open ? "▴" : "▾"}</Text>
      </Pressable>
    </View>
    {open ? <View style={styles.options}>
      {(options.length ? options : names).map(name => <Pressable key={name}
        accessibilityRole="button" onPress={() => { onChange(name); setOpen(false); }}
        style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfaceSoft }]}>
        <Text style={styles.label}>{name}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.canvasRaised },
  input: { flex: 1, minWidth: 0, padding: 12, fontSize: 16, color: colors.text },
  toggle: { width: 42, minHeight: 44, alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 18, color: colors.textDim },
  options: { marginTop: 5, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.canvasRaised, overflow: "hidden" },
  option: { paddingHorizontal: 12, paddingVertical: 11 },
  label: { fontSize: 15, color: colors.text }
});
