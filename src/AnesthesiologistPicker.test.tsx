import { useState } from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AnesthesiologistPicker, anesthesiologists } from "./AnesthesiologistPicker";

function Form() {
  const [name, setName] = useState("");
  return <AnesthesiologistPicker value={name} onChange={setName} />;
}

test("starts empty and selects a doctor only on explicit selection", () => {
  const screen = render(<Form />);
  expect(screen.getByLabelText("ФИО анестезиолога").props.value).toBe("");
  expect(screen.queryByText("Студницкий А.В.")).toBeNull();
  fireEvent.press(screen.getByLabelText("Список анестезиологов"));
  for (const name of anesthesiologists) expect(screen.getByText(name)).toBeTruthy();
  fireEvent.press(screen.getByText("Дядянов А.Э."));
  expect(screen.getByLabelText("ФИО анестезиолога").props.value).toBe("Дядянов А.Э.");
  expect(screen.queryByText("Студницкий А.В.")).toBeNull();
});

test("supports surname search and manual input", () => {
  const screen = render(<Form />);
  fireEvent.changeText(screen.getByLabelText("ФИО анестезиолога"), "кир");
  expect(screen.getByText("Кирилин В.В.")).toBeTruthy();
  expect(screen.queryByText("Зимин И.А.")).toBeNull();
  fireEvent.changeText(screen.getByLabelText("ФИО анестезиолога"), "Другой А.Б.");
  expect(screen.getByLabelText("ФИО анестезиолога").props.value).toBe("Другой А.Б.");
});
