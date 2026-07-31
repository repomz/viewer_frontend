import { buildDicomSeries, type DicomMetadata } from "./dicomSeries";
import { unzip } from "fflate";
import {
  getPreparedXAManifest,
  manifestFrameURLs,
  preparedArchiveURL,
  preparedFrameURL,
  type PreparedXAManifest
} from "./xaPreparedCache";

const CACHE_NAME = "viewer-xa-frames-v2";
const INDEX_KEY = "viewer.xa-cache-index.v2";
const EXPECTED_KEY = "viewer.xa-cache-expected.v2";

type CacheEntry = {
  studyUID: string;
  bytes: number;
};

type CacheIndex = Record<string, CacheEntry>;
type ExpectedFrames = Record<string, number>;

export type StudyCacheInfo = {
  bytes: number;
  cachedFrames: number;
  expectedFrames: number;
  complete: boolean;
  downloading: boolean;
  error?: string;
};

export type DicomCacheSnapshot = {
  supported: boolean;
  totalBytes: number;
  studies: Record<string, StudyCacheInfo>;
};

const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<Blob>>();
const activeDownloads = new Set<string>();
const downloadErrors = new Map<string, string>();
const downloadControllers = new Map<string, AbortController>();

function hasCacheAPI(): boolean {
  return typeof window !== "undefined" && typeof window.caches !== "undefined";
}

function hasIndexedDB(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined"
  );
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined" &&
    (hasCacheAPI() || hasIndexedDB())
  );
}

function openFrameDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const request = window.indexedDB.open("viewer-xa-frames-v2", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("frames")) {
        request.result.createObjectStore("frames");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedFrame(url: string): Promise<Blob | undefined> {
  if (!hasIndexedDB()) return undefined;
  const database = await openFrameDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("frames", "readonly");
    const request = transaction.objectStore("frames").get(url);
    request.onsuccess = () =>
      resolve(request.result instanceof Blob ? request.result : undefined);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeIndexedFrame(url: string, blob: Blob): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await openFrameDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("frames", "readwrite");
    transaction.objectStore("frames").put(blob, url);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function clearIndexedFrames(): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await openFrameDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("frames", "readwrite");
    transaction.objectStore("frames").clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function readRecord<T extends Record<string, unknown>>(key: string): T {
  if (!supported()) return {} as T;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function writeRecord(key: string, value: Record<string, unknown>): void {
  if (!supported()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function recordFrame(url: string, studyUID: string, bytes: number): void {
  const index = readRecord<CacheIndex>(INDEX_KEY);
  index[url] = { studyUID, bytes };
  writeRecord(INDEX_KEY, index);
  emit();
}

function recordFrames(
  frames: { url: string; studyUID: string; bytes: number }[]
): void {
  const index = readRecord<CacheIndex>(INDEX_KEY);
  frames.forEach((frame) => {
    index[frame.url] = { studyUID: frame.studyUID, bytes: frame.bytes };
  });
  writeRecord(INDEX_KEY, index);
  emit();
}

function unzipFrames(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

async function persistPreparedArchive(
  studyUID: string,
  manifest: PreparedXAManifest,
  signal: AbortSignal
): Promise<boolean> {
  const archiveURL = preparedArchiveURL(manifest);
  if (!archiveURL) return false;
  const response = await fetch(archiveURL, {
    headers: { Accept: "application/zip" },
    signal
  });
  if (!response.ok) {
    throw new Error(`Архив XA вернул HTTP ${response.status}`);
  }
  const files = await unzipFrames(new Uint8Array(await response.arrayBuffer()));
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const frames = manifest.series.flatMap((series) =>
    series.frames.map((frame) => {
      const bytes = files[`frames/${frame.id}`];
      if (!bytes) throw new Error(`В архиве XA отсутствует кадр ${frame.id}`);
      return {
        url: preparedFrameURL(frame.path),
        blob: new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" })
      };
    })
  );

  if (hasCacheAPI()) {
    const cache = await window.caches.open(CACHE_NAME);
    let nextIndex = 0;
    const worker = async () => {
      while (!signal.aborted) {
        const frame = frames[nextIndex++];
        if (!frame) return;
        await cache.put(
          frame.url,
          new Response(frame.blob, { headers: { "Content-Type": "image/jpeg" } })
        );
      }
    };
    await Promise.all(Array.from({ length: 8 }, () => worker()));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  } else {
    for (const frame of frames) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await writeIndexedFrame(frame.url, frame.blob);
    }
  }
  recordFrames(
    frames.map((frame) => ({
      url: frame.url,
      studyUID,
      bytes: frame.blob.size
    }))
  );
  return true;
}

function renderedURL(instanceURL: string, frameIndex: number): string {
  return (
    `${instanceURL}/frames/${frameIndex + 1}/rendered` +
    "?viewport=768,768&quality=85"
  );
}

export function getDicomCacheSnapshot(): DicomCacheSnapshot {
  const index = readRecord<CacheIndex>(INDEX_KEY);
  const expected = readRecord<ExpectedFrames>(EXPECTED_KEY);
  const studies: Record<string, StudyCacheInfo> = {};
  let totalBytes = 0;

  Object.values(index).forEach((entry) => {
    if (
      !entry ||
      typeof entry.studyUID !== "string" ||
      !Number.isFinite(entry.bytes)
    ) {
      return;
    }
    totalBytes += entry.bytes;
    const current = studies[entry.studyUID] ?? {
      bytes: 0,
      cachedFrames: 0,
      expectedFrames: expected[entry.studyUID] ?? 0,
      complete: false,
      downloading: activeDownloads.has(entry.studyUID)
    };
    current.bytes += entry.bytes;
    current.cachedFrames += 1;
    studies[entry.studyUID] = current;
  });

  Object.entries(expected).forEach(([studyUID, expectedFrames]) => {
    const current = studies[studyUID] ?? {
      bytes: 0,
      cachedFrames: 0,
      expectedFrames,
      complete: false,
      downloading: activeDownloads.has(studyUID)
    };
    current.expectedFrames = expectedFrames;
    current.downloading = activeDownloads.has(studyUID);
    current.complete =
      expectedFrames > 0 && current.cachedFrames >= expectedFrames;
    current.error = downloadErrors.get(studyUID);
    studies[studyUID] = current;
  });

  return { supported: supported(), totalBytes, studies };
}

export function subscribeDicomCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function requestPersistentStorage(): Promise<void> {
  if (
    typeof navigator !== "undefined" &&
    navigator.storage?.persist
  ) {
    await navigator.storage.persist().catch(() => false);
  }
}

export async function loadRenderedFrameBlob(
  url: string,
  options: {
    studyUID: string;
    persist: boolean;
    signal?: AbortSignal;
  }
): Promise<Blob> {
  const pending = inFlight.get(url);
  if (pending) return pending;

  const load = (async () => {
    let cache: Cache | null = null;
    if (options.persist && hasCacheAPI()) {
      cache = await window.caches.open(CACHE_NAME).catch(() => null);
    }
    const cached = cache ? await cache.match(url) : undefined;
    if (cached) return cached.blob();
    if (options.persist) {
      const indexed = await readIndexedFrame(url).catch(() => undefined);
      if (indexed) return indexed;
    }

    const response = await fetch(url, {
      headers: { Accept: "image/jpeg" },
      signal: options.signal
    });
    if (!response.ok) {
      throw new Error(`PACS вернул HTTP ${response.status}`);
    }
    const blob = await response.clone().blob();
    if (options.persist) {
      let stored = false;
      if (cache) {
        stored = await cache
          .put(url, response)
          .then(() => true)
          .catch(() => false);
      }
      if (!stored) {
        await writeIndexedFrame(url, blob);
      }
      recordFrame(url, options.studyUID, blob.size);
    }
    return blob;
  })();

  inFlight.set(url, load);
  try {
    return await load;
  } finally {
    inFlight.delete(url);
  }
}

export async function downloadStudyForOffline(
  studyUID: string,
  dicomWebRoot = "/dicom-web"
): Promise<boolean> {
  if (!supported() || activeDownloads.has(studyUID)) return false;
  const existing = getDicomCacheSnapshot().studies[studyUID];
  if (existing?.complete) return true;

  activeDownloads.add(studyUID);
  const controller = new AbortController();
  downloadControllers.set(studyUID, controller);
  downloadErrors.delete(studyUID);
  emit();
  try {
    await requestPersistentStorage();
    let urls: string[];
    let preparedManifest: PreparedXAManifest | null = null;
    let preparedOnServer = false;
    try {
      const manifest = await getPreparedXAManifest(studyUID, {
        wait: true,
        signal: controller.signal
      });
      urls = manifest ? manifestFrameURLs(manifest) : [];
      preparedManifest = manifest;
      preparedOnServer = Boolean(manifest);
    } catch (reason) {
      if (controller.signal.aborted) throw reason;
      if (
        !(reason instanceof Error) ||
        !reason.message.includes("HTTP 404")
      ) {
        throw reason;
      }
      // Compatibility fallback for a backend that has not been upgraded yet.
      const root = dicomWebRoot.replace(/\/$/, "");
      const response = await fetch(
        `${root}/studies/${encodeURIComponent(studyUID)}/metadata`,
        {
          headers: { Accept: "application/dicom+json" },
          signal: controller.signal
        }
      );
      if (!response.ok) throw new Error(`PACS вернул HTTP ${response.status}`);
      const metadata = (await response.json()) as DicomMetadata[];
      urls = buildDicomSeries(metadata, studyUID, root).flatMap((series) =>
        series.frames.map((frame) =>
          renderedURL(frame.instanceURL, frame.frameIndex)
        )
      );
    }
    const expected = readRecord<ExpectedFrames>(EXPECTED_KEY);
    expected[studyUID] = urls.length;
    writeRecord(EXPECTED_KEY, expected);
    emit();

    if (preparedManifest?.archive_path) {
      try {
        if (
          await persistPreparedArchive(
            studyUID,
            preparedManifest,
            controller.signal
          )
        ) {
          return true;
        }
      } catch (reason) {
        if (controller.signal.aborted) throw reason;
        // A partially upgraded server or browser falls back to frame downloads.
      }
    }

    // Orthanc rendering remains limited to two requests, but static prepared
    // files can saturate Wi-Fi safely with six parallel downloads.
    let nextIndex = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex;
        nextIndex += 1;
        const url = urls[index];
        if (!url) return;
        await loadRenderedFrameBlob(url, {
          studyUID,
          persist: true,
          signal: controller.signal
        });
      }
    };
    await Promise.all(
      Array.from({ length: preparedOnServer ? 6 : 2 }, () => worker())
    );
    return true;
  } catch (reason) {
    if (!controller.signal.aborted) {
      downloadErrors.set(
        studyUID,
        reason instanceof Error ? reason.message : "Не удалось сохранить XA"
      );
    }
    return false;
  } finally {
    downloadControllers.delete(studyUID);
    activeDownloads.delete(studyUID);
    emit();
  }
}

export function cancelDicomDownloads(): void {
  downloadControllers.forEach((controller) => controller.abort());
}

export async function clearDicomCache(): Promise<void> {
  if (!supported()) return;
  if (hasCacheAPI()) {
    await window.caches.delete(CACHE_NAME).catch(() => false);
    await window.caches.delete("viewer-xa-frames-v1").catch(() => false);
  }
  await clearIndexedFrames().catch(() => undefined);
  window.localStorage.removeItem(INDEX_KEY);
  window.localStorage.removeItem(EXPECTED_KEY);
  window.localStorage.removeItem("viewer.xa-cache-index.v1");
  window.localStorage.removeItem("viewer.xa-cache-expected.v1");
  if (hasIndexedDB()) {
    window.indexedDB.deleteDatabase("viewer-xa-frames-v1");
  }
  downloadErrors.clear();
  emit();
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
