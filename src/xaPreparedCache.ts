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
  frames: PreparedXAFrame[];
};

export type PreparedXAManifest = {
  status: "ready";
  study_uid: string;
  prepared_at: string;
  frame_count: number;
  total_bytes: number;
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

export const preparedFrameKey = (
  instanceUID: string,
  frameIndex: number
): string => `${instanceUID}:${frameIndex}`;

export async function getPreparedXAManifest(
  studyUID: string,
  options: {
    wait?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<PreparedXAManifest | null> {
  const encoded = encodeURIComponent(studyUID);
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
      await sleep(1500, options.signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Сервер подготовки XA вернул HTTP ${response.status}`);
    }
    return (await response.json()) as PreparedXAManifest;
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
