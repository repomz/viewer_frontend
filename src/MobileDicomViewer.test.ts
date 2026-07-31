import {
  buildDicomSeries,
  type DicomMetadata
} from "./dicomSeries";
import { manifestDicomSeries } from "./xaPreparedCache";

const metadata = (
  seriesUID: string,
  instanceUID: string,
  instanceNumber: number,
  frames = 1
): DicomMetadata => ({
  "0020000E": { vr: "UI", Value: [seriesUID] },
  "00080018": { vr: "UI", Value: [instanceUID] },
  "00200011": { vr: "IS", Value: [2] },
  "00200013": { vr: "IS", Value: [instanceNumber] },
  "00280008": { vr: "IS", Value: [frames] },
  "0008103E": { vr: "LO", Value: ["Коронарография"] }
});

describe("buildDicomSeries", () => {
  it("expands a multi-frame XA instance into ordered DICOM frames", () => {
    const result = buildDicomSeries(
      [
        metadata("1.2.series", "1.2.instance.2", 2),
        metadata("1.2.series", "1.2.instance.1", 1, 3)
      ],
      "1.2.study",
      "/dicom-web/"
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: "1.2.series",
      number: 2,
      description: "Коронарография"
    });
    expect(result[0]?.frames).toEqual([
      expect.objectContaining({
        instanceURL:
          "/dicom-web/studies/1.2.study/series/1.2.series/instances/1.2.instance.1",
        frameIndex: 0
      }),
      expect.objectContaining({ frameIndex: 1 }),
      expect.objectContaining({ frameIndex: 2 }),
      expect.objectContaining({
        instanceURL:
          "/dicom-web/studies/1.2.study/series/1.2.series/instances/1.2.instance.2",
        frameIndex: 0
      })
    ]);
  });

  it("can open prepared XA when the direct PACS metadata route is unavailable", () => {
    const result = manifestDicomSeries({
      status: "ready",
      study_uid: "1.2.study",
      prepared_at: "2026-07-31T12:00:00Z",
      frame_count: 2,
      total_bytes: 100,
      series: [
        {
          series_uid: "1.2.series",
          number: 3,
          description: "XA cine",
          frames: [
            { id: "a.jpg", instance_uid: "1.2.instance", frame_index: 1, path: "/a", size: 50 },
            { id: "b.jpg", instance_uid: "1.2.instance", frame_index: 2, path: "/b", size: 50 }
          ]
        }
      ]
    });

    expect(result[0]).toMatchObject({ uid: "1.2.series", number: 3 });
    expect(result[0]?.frames.map((frame) => frame.frameIndex)).toEqual([0, 1]);
  });
});
