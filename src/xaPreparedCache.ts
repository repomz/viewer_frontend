import type { DicomSeries } from "./dicomSeries";

export type PreparedXAFrame = {
  id: string;
  instance_uid: string;
  frame_index: number;
  path: string;
  size: number;
};

export type PreparedXASeries = {
  series_uid: string;
  number: number;
  description?: string;
  columns?: number;
  rows?: number;
  fps?: number;
  cine_id?: string;
  cine_path?: string;
  cine_bytes?: number;
  frames: PreparedXAFrame[];
};

export type PreparedXAManifest = {
  status: "partial" | "ready";
  study_uid: string;
  prepared_at: string;
  frame_count: number;
  total_bytes: number;
  archive_path?: string;
  archive_bytes?: number;
  series: PreparedXASeries[];
};

type PreparationStatus = {
  status: "missing" | "queued" | "preparing" | "error";
  error?: string;
};

const sleep = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

export const preparedFrameURL = (path: string): string =>
  path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;

export const preparedArchiveURL = (manifest: PreparedXAManifest): string | null =>
  manifest.archive_path ? preparedFrameURL(manifest.archive_path) : null;

export const preparedCineURL = (series: PreparedXASeries): string | null =>
  series.cine_path ? preparedFrameURL(series.cine_path) : null;

export const manifestCineURLs = (manifest: PreparedXAManifest): string[] =>
  manifest.series.flatMap((series) => {
    const url = preparedCineURL(series);
    return url ? [url] : [];
  });

export const preparedFrameKey = (
  instanceUID: string,
  frameIndex: number
): string => `${instanceUID}:${frameIndex}`;

export async function getPreparedXAManifest(
  studyUID: string,
  options: {
    wait?: boolean;
    signal?: AbortSignal;
    maxWaitMs?: number;
  } = {}
): Promise<PreparedXAManifest | null> {
  const encoded = encodeURIComponent(studyUID);
  const startedAt = Date.now();
  let partialManifest: PreparedXAManifest | null = null;
  while (!options.signal?.aborted) {
    const response = await fetch(`/api/xa-cache/${encoded}/manifest`, {
      headers: { Accept: "application/json" },
      signal: options.signal
    });
    if (response.status === 202) {
      const status = (await response.json()) as PreparationStatus;
      if (status.status === "error") {
        throw new Error(status.error || "Сервер не смог подготовить XA");
      }
      if (!options.wait) return null;
      if (Date.now() - startedAt >= (options.maxWaitMs ?? 30_000)) return partialManifest;
      await sleep(1500, options.signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Сервер подготовки XA вернул HTTP ${response.status}`);
    }
    const manifest = (await response.json()) as PreparedXAManifest;
    if (manifest.status === "partial" && options.wait) {
      partialManifest = manifest;
      if (Date.now() - startedAt >= (options.maxWaitMs ?? 30_000)) return manifest;
      await sleep(5000, options.signal);
      continue;
    }
    return manifest;
  }
  throw new DOMException("Aborted", "AbortError");
}

export function manifestFrameURLs(manifest: PreparedXAManifest): string[] {
  return manifest.series.flatMap((series) =>
    series.frames.map((frame) => preparedFrameURL(frame.path))
  );
}

export function manifestFrameMap(
  manifest: PreparedXAManifest
): Map<string, string> {
  return new Map(
    manifest.series.flatMap((series) =>
      series.frames.map(
        (frame) =>
          [
            preparedFrameKey(frame.instance_uid, frame.frame_index),
            preparedFrameURL(frame.path)
          ] as const
      )
    )
  );
}

export function manifestDicomSeries(
  manifest: PreparedXAManifest,
  dicomWebRoot = "/dicom-web"
): DicomSeries[] {
  const root = dicomWebRoot.replace(/\/$/, "");
  return manifest.series.map((series) => ({
    uid: series.series_uid,
    number: series.number,
    description: series.description || "Ангиографическая серия",
    frames: series.frames.map((frame) => ({
      instanceUID: frame.instance_uid,
      instanceURL:
        `${root}/studies/${encodeURIComponent(manifest.study_uid)}` +
        `/series/${encodeURIComponent(series.series_uid)}` +
        `/instances/${encodeURIComponent(frame.instance_uid)}`,
      frameIndex: Math.max(0, frame.frame_index - 1),
      metadata: {
        ...(series.rows ? { "00280010": { vr: "US", Value: [series.rows] } } : {}),
        ...(series.columns ? { "00280011": { vr: "US", Value: [series.columns] } } : {})
      }
    }))
  }));
}
