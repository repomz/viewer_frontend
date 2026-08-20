import { buildDicomSeries, type DicomMetadata } from "./dicomSeries";
import { unzip } from "fflate";
import {
  getPreparedXAManifest,
  manifestCineURLs,
  manifestFrameURLs,
  preparedArchiveURL,
  preparedFrameURL,
  type PreparedXAManifest
} from "./xaPreparedCache";

const CACHE_NAME = "viewer-xa-media-v3";
const INDEX_KEY = "viewer.xa-cache-index.v3";
const EXPECTED_KEY = "viewer.xa-cache-expected.v3";
const MANIFEST_KEY = "viewer.xa-cache-manifests.v1";
const CAPTURE_INDEX_KEY = "viewer.xa-captures-index.v1";

type CacheEntry = {
  studyUID: string;
  bytes: number;
  kind?: "frame" | "cine";
  cachedAt?: string;
};

type CacheIndex = Record<string, CacheEntry>;
type ExpectedFrames = Record<string, number>;
type PreparedManifestIndex = Record<string, PreparedXAManifest>;
type CaptureIndex = Record<
  string,
  {
    studyUID: string;
    bytes: number;
    filename: string;
    createdAt: string;
  }
>;

export type StoredXACapture = {
  id: string;
  studyUID: string;
  filename: string;
  createdAt: string;
  blob: Blob;
};

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

function openCaptureDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const request = window.indexedDB.open("viewer-xa-captures-v1", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("captures")) {
        request.result.createObjectStore("captures", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveXACapture(
  capture: StoredXACapture
): Promise<void> {
  const database = await openCaptureDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("captures", "readwrite");
    transaction.objectStore("captures").put(capture);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const index = readRecord<CaptureIndex>(CAPTURE_INDEX_KEY);
  index[capture.id] = {
    studyUID: capture.studyUID,
    bytes: capture.blob.size,
    filename: capture.filename,
    createdAt: capture.createdAt
  };
  writeRecord(CAPTURE_INDEX_KEY, index);
  emit();
}

export async function loadXACaptures(
  studyUID: string
): Promise<StoredXACapture[]> {
  if (!hasIndexedDB()) return [];
  const database = await openCaptureDatabase();
  const captures = await new Promise<StoredXACapture[]>((resolve, reject) => {
    const transaction = database.transaction("captures", "readonly");
    const request = transaction.objectStore("captures").getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as StoredXACapture[])
          .filter((capture) => capture.studyUID === studyUID)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      );
    request.onerror = () => reject(request.error);
  });
  database.close();
  return captures;
}

async function deleteXACaptures(studyUID?: string): Promise<void> {
  if (!hasIndexedDB()) return;
  const database = await openCaptureDatabase();
  const index = readRecord<CaptureIndex>(CAPTURE_INDEX_KEY);
  const ids = Object.entries(index)
    .filter(([, entry]) => !studyUID || entry.studyUID === studyUID)
    .map(([id]) => id);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("captures", "readwrite");
    const store = transaction.objectStore("captures");
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  ids.forEach((id) => delete index[id]);
  writeRecord(CAPTURE_INDEX_KEY, index);
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

export function getCachedPreparedXAManifest(
  studyUID: string
): PreparedXAManifest | null {
  const manifest = readRecord<PreparedManifestIndex>(MANIFEST_KEY)[studyUID];
  return manifest?.study_uid === studyUID &&
    manifest.series.some((series) => Boolean(series.cine_path))
    ? manifest
    : null;
}

export function cachePreparedXAManifest(manifest: PreparedXAManifest): void {
  if (!manifest.series.some((series) => Boolean(series.cine_path))) return;
  const manifests = readRecord<PreparedManifestIndex>(MANIFEST_KEY);
  manifests[manifest.study_uid] = manifest;
  writeRecord(MANIFEST_KEY, manifests);
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function recordFrame(url: string, studyUID: string, bytes: number): void {
  const index = readRecord<CacheIndex>(INDEX_KEY);
  index[url] = { studyUID, bytes, kind: "frame", cachedAt: new Date().toISOString() };
  writeRecord(INDEX_KEY, index);
  emit();
}

function recordCines(
  cines: { url: string; studyUID: string; bytes: number }[]
): void {
  const index = readRecord<CacheIndex>(INDEX_KEY);
  cines.forEach((cine) => {
    index[cine.url] = { ...cine, kind: "cine", cachedAt: new Date().toISOString() };
  });
  writeRecord(INDEX_KEY, index);
  emit();
}

async function persistPreparedCines(
  studyUID: string,
  urls: string[],
  signal: AbortSignal
): Promise<void> {
  const stored: { url: string; studyUID: string; bytes: number }[] = [];
  const cache = hasCacheAPI()
    ? await window.caches.open(CACHE_NAME).catch(() => null)
    : null;
  let nextIndex = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const url = urls[nextIndex++];
      if (!url) return;
      if (cache) {
        const existing = await cache.match(url);
        if (existing) {
          const blob = await existing.blob();
          // Keep cine studies in IndexedDB as well. On iOS standalone PWAs the
          // Cache API can be reclaimed between launches even when localStorage
          // survives, while IndexedDB is the more reliable persistent store.
          if (hasIndexedDB()) {
            await writeIndexedFrame(url, blob).catch(() => undefined);
          }
          stored.push({ url, studyUID, bytes: blob.size });
          continue;
        }
      }
      const response = await fetch(url, {
        headers: { Accept: "video/mp4" },
        signal
      });
      if (!response.ok) {
        throw new Error(`Cine XA вернул HTTP ${response.status}`);
      }
      const blob = await response.clone().blob();
      let persisted = false;
      if (hasIndexedDB()) {
        persisted = await writeIndexedFrame(url, blob)
          .then(() => true)
          .catch(() => false);
      }
      if (!persisted && cache) {
        persisted = await cache
          .put(url, response)
          .then(() => true)
          .catch(() => false);
      }
      if (!persisted) throw new Error("Не удалось сохранить cine XA на устройстве");
      stored.push({ url, studyUID, bytes: blob.size });
    }
  };
  await Promise.all(Array.from({ length: 3 }, () => worker()));
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  recordCines(stored);
}

export async function resolvePreparedCineSource(url: string): Promise<{
  source: string;
  local: boolean;
}> {
  if (hasCacheAPI()) {
    const cache = await window.caches.open(CACHE_NAME).catch(() => null);
    const cached = cache ? await cache.match(url) : undefined;
    if (cached) {
      return { source: URL.createObjectURL(await cached.blob()), local: true };
    }
  }
  const indexed = await readIndexedFrame(url).catch(() => undefined);
  if (indexed) {
    return { source: URL.createObjectURL(indexed), local: true };
  }
  return { source: url, local: false };
}

function recordFrames(
  frames: { url: string; studyUID: string; bytes: number }[]
): void {
  const index = readRecord<CacheIndex>(INDEX_KEY);
  frames.forEach((frame) => {
    index[frame.url] = { studyUID: frame.studyUID, bytes: frame.bytes, kind: "frame", cachedAt: new Date().toISOString() };
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

  Object.values(readRecord<CaptureIndex>(CAPTURE_INDEX_KEY)).forEach(
    (capture) => {
      if (capture && Number.isFinite(capture.bytes)) totalBytes += capture.bytes;
    }
  );

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
  // Cancellable background preloads must not share a fetch with a visible
  // frame. Otherwise changing a patient can either leave the old transfer
  // running or abort the frame the user is currently waiting for.
  const pending = options.signal ? undefined : inFlight.get(url);
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

  if (!options.signal) inFlight.set(url, load);
  try {
    return await load;
  } finally {
    if (!options.signal) inFlight.delete(url);
  }
}

export async function downloadStudyForOffline(
  studyUID: string,
  dicomWebRoot = "/dicom-web"
): Promise<boolean> {
  if (!supported() || activeDownloads.has(studyUID)) return false;
  const existing = getDicomCacheSnapshot().studies[studyUID];
  if (existing?.complete && getCachedPreparedXAManifest(studyUID)) return true;

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

    const cineURLs = preparedManifest ? manifestCineURLs(preparedManifest) : [];
    if (
      preparedManifest &&
      cineURLs.length > 0 &&
      cineURLs.length === preparedManifest.series.length
    ) {
      expected[studyUID] = cineURLs.length;
      writeRecord(EXPECTED_KEY, expected);
      emit();
      await persistPreparedCines(studyUID, cineURLs, controller.signal);
      cachePreparedXAManifest(preparedManifest);
      return true;
    }

    if (preparedManifest?.archive_path) {
      try {
        if (
          await persistPreparedArchive(
            studyUID,
            preparedManifest,
            controller.signal
          )
        ) {
          cachePreparedXAManifest(preparedManifest);
          return true;
        }
      } catch (reason) {
        if (controller.signal.aborted) throw reason;
        // A partially upgraded server or browser falls back to frame downloads.
      }
    }

    // Orthanc rendering remains limited to two requests, but static prepared
    // files use a small parallel pool so clinical API requests remain responsive.
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
      Array.from({ length: preparedOnServer ? 3 : 2 }, () => worker())
    );
    if (preparedManifest) cachePreparedXAManifest(preparedManifest);
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

export async function downloadStudyFirstSeriesForOffline(
  studyUID: string
): Promise<boolean> {
  if (!supported() || activeDownloads.has(studyUID)) return false;
  activeDownloads.add(studyUID);
  const controller = new AbortController();
  downloadControllers.set(studyUID, controller);
  downloadErrors.delete(studyUID);
  emit();
  try {
    await requestPersistentStorage();
    let manifest = getCachedPreparedXAManifest(studyUID);
    while (!manifest && !controller.signal.aborted) {
      manifest = await getPreparedXAManifest(studyUID, {
        signal: controller.signal
      });
      if (manifest && manifestCineURLs(manifest).length > 0) break;
      manifest = null;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 1000);
        controller.signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
    }
    if (!manifest) return false;
    const cineURLs = manifestCineURLs(manifest);
    const firstCine = cineURLs[0];
    if (!firstCine) return false;
    const expected = readRecord<ExpectedFrames>(EXPECTED_KEY);
    expected[studyUID] = cineURLs.length;
    writeRecord(EXPECTED_KEY, expected);
    await persistPreparedCines(studyUID, [firstCine], controller.signal);
    cachePreparedXAManifest(manifest);
    return true;
  } catch (reason) {
    if (!controller.signal.aborted) {
      downloadErrors.set(
        studyUID,
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить первую серию XA"
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

export async function deleteStudyFromDevice(studyUID: string): Promise<void> {
  if (!supported()) return;
  const index = readRecord<CacheIndex>(INDEX_KEY);
  const manifests = readRecord<PreparedManifestIndex>(MANIFEST_KEY);
  delete manifests[studyUID];
  writeRecord(MANIFEST_KEY, manifests);
  const urls = Object.entries(index)
    .filter(([, entry]) => entry.studyUID === studyUID)
    .map(([url]) => url);
  if (hasCacheAPI()) {
    const cache = await window.caches.open(CACHE_NAME).catch(() => null);
    if (cache) await Promise.all(urls.map((url) => cache.delete(url)));
  }
  if (hasIndexedDB()) {
    const database = await openFrameDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("frames", "readwrite");
      const store = transaction.objectStore("frames");
      urls.forEach((url) => store.delete(url));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }
  urls.forEach((url) => delete index[url]);
  writeRecord(INDEX_KEY, index);
  const expected = readRecord<ExpectedFrames>(EXPECTED_KEY);
  delete expected[studyUID];
  writeRecord(EXPECTED_KEY, expected);
  await deleteXACaptures(studyUID).catch(() => undefined);
  emit();
}

export async function pruneDicomCache(validStudyUIDs: Iterable<string>): Promise<void> {
  if (!supported()) return;
  const valid = new Set(validStudyUIDs);
  const cached = Object.keys(getDicomCacheSnapshot().studies);
  await Promise.all(
    cached
      .filter((studyUID) => !valid.has(studyUID))
      .map((studyUID) => deleteStudyFromDevice(studyUID))
  );
}

export async function pruneExpiredDicomFrames(maxAgeHours = 12): Promise<void> {
  if (!supported()) return;
  const index = readRecord<CacheIndex>(INDEX_KEY);
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const urls = Object.entries(index)
    .filter(
      ([, entry]) =>
        entry.kind !== "cine" &&
        (!entry.cachedAt || new Date(entry.cachedAt).getTime() < cutoff)
    )
    .map(([url]) => url);
  if (!urls.length) return;
  if (hasCacheAPI()) {
    const cache = await window.caches.open(CACHE_NAME).catch(() => null);
    if (cache) await Promise.all(urls.map((url) => cache.delete(url)));
  }
  if (hasIndexedDB()) {
    const database = await openFrameDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("frames", "readwrite");
      const store = transaction.objectStore("frames");
      urls.forEach((url) => store.delete(url));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }
  urls.forEach((url) => delete index[url]);
  writeRecord(INDEX_KEY, index);
  emit();
}

export async function clearDicomCache(): Promise<void> {
  if (!supported()) return;
  if (hasCacheAPI()) {
    await window.caches.delete(CACHE_NAME).catch(() => false);
    await window.caches.delete("viewer-xa-frames-v2").catch(() => false);
    await window.caches.delete("viewer-xa-frames-v1").catch(() => false);
  }
  await clearIndexedFrames().catch(() => undefined);
  await deleteXACaptures().catch(() => undefined);
  window.localStorage.removeItem(INDEX_KEY);
  window.localStorage.removeItem(EXPECTED_KEY);
  window.localStorage.removeItem(CAPTURE_INDEX_KEY);
  window.localStorage.removeItem(MANIFEST_KEY);
  window.localStorage.removeItem("viewer.xa-cache-index.v2");
  window.localStorage.removeItem("viewer.xa-cache-expected.v2");
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
