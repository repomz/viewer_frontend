import { activeTransfer, transferLabel, transferUID, studyTransfer } from "./transferProgress";
import { UserRequest } from "./types";
const request = { command: "get_ct", status: "in_progress", updated_at: new Date().toISOString(), payload: {study_uid: "1.2.3"}, result: {progress: {stage: "download", completed: 20, total: 100, bytes: 1048576}} } as unknown as UserRequest;
test("shows actual stage and counts, not a fabricated overall percentage", () => {
 expect(transferLabel(request)).toBe("Больничный PACS → агент · 20/100 файлов · 1 МБ");
 expect(activeTransfer(request)).toBe(true);
 expect(transferUID(request)).toBe("1.2.3");
});
test("completion and stale progress are distinct", () => {
 expect(transferLabel({...request,status:"completed"})).toBe("Доставлено в MAPDR");
 expect(activeTransfer({...request,status:"completed"})).toBe(false);
 expect(transferLabel(request,Date.now()+120000)).toContain("Давно нет обновления");
});
test("cancelled duplicate does not hide successful delivery", () => {
 const completed = {...request, status: "completed"};
 expect(studyTransfer([{...request,status:"error"},completed],"1.2.3")).toBe(completed);
 expect(studyTransfer([completed,request],"1.2.3")).toBe(request);
});
