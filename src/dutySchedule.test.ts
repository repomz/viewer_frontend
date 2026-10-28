import { dutyDate, dutyNurses, scheduleRows } from "./dutySchedule";
import type { DutySchedule } from "./types";

test("hospital night changes at 08:00 including month boundary", () => {
  expect(dutyDate(new Date("2026-11-01T00:59:00Z"))).toMatchObject({month:"2026-10",day:31});
  expect(dutyDate(new Date("2026-11-01T01:00:00Z"))).toMatchObject({month:"2026-11",day:1});
});
test("nurses use 16/18/24-hour shifts and never present uncertain cells as confirmed", () => {
  const doc: DutySchedule = {month:"2026-10", holidays:[],updated_at:"", groups:[{id:"nurses", label:"Медсёстры",staff:[
    {id:"a",name:"А",shifts:{"1:duty":"16"}},
    {id:"b",name:"Б",shifts:{"1:duty":"24"},review:{"1:duty":true}},
    {id:"c",name:"В",shifts:{"1:day":"6"}},
    {id:"d",name:"Г",shifts:{"1:duty":"18"}},
  ]}]};
  expect(dutyNurses(doc,1)).toEqual({names:["А","Г"],uncertain:true});
  expect(scheduleRows({...doc.groups[0]!.staff[0]!,role:"day_only"})).toEqual(["day"]);
});
