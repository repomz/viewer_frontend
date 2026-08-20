import { getDicomCacheSnapshot } from "./dicomOfflineCache";

const INDEX_KEY = "viewer.xa-cache-index.v3";
const EXPECTED_KEY = "viewer.xa-cache-expected.v3";
const MANIFEST_KEY = "viewer.xa-cache-manifests.v1";
const STUDY_UID = "1.2.840.test";

const manifest = (status: "partial" | "ready") => ({
  status,
  study_uid: STUDY_UID,
  prepared_at: "2026-08-20T12:00:00Z",
  frame_count: 100,
  total_bytes: 1000,
  series: [1, 2, 3].map((number) => ({
    series_uid: `series-${number}`,
    number,
    cine_path: `/xa/${number}.mp4`,
    frames: []
  }))
});

describe("persistent XA cine cache", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {}
    });
  });

  it("does not count cached JPEG frames as downloaded MP4 series", () => {
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify({
        "/xa/1.mp4": { studyUID: STUDY_UID, bytes: 500, kind: "cine" },
        ...Object.fromEntries(
          Array.from({ length: 40 }, (_, index) => [
            `/xa/frame-${index}.jpg`,
            { studyUID: STUDY_UID, bytes: 10, kind: "frame" }
          ])
        )
      })
    );
    window.localStorage.setItem(
      EXPECTED_KEY,
      JSON.stringify({ [STUDY_UID]: { count: 3, kind: "cine" } })
    );
    window.localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ [STUDY_UID]: manifest("ready") })
    );

    expect(getDicomCacheSnapshot().studies[STUDY_UID]).toMatchObject({
      cachedFrames: 1,
      expectedFrames: 3,
      complete: false
    });
  });

  it("requires a ready manifest before treating all MP4 series as complete", () => {
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(
        Object.fromEntries(
          [1, 2, 3].map((number) => [
            `/xa/${number}.mp4`,
            { studyUID: STUDY_UID, bytes: 500, kind: "cine" }
          ])
        )
      )
    );
    window.localStorage.setItem(
      EXPECTED_KEY,
      JSON.stringify({ [STUDY_UID]: { count: 3, kind: "cine" } })
    );
    window.localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ [STUDY_UID]: manifest("partial") })
    );

    expect(getDicomCacheSnapshot().studies[STUDY_UID]?.complete).toBe(false);

    window.localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ [STUDY_UID]: manifest("ready") })
    );
    expect(getDicomCacheSnapshot().studies[STUDY_UID]?.complete).toBe(true);
  });
});
