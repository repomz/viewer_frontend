import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Animated,
  ActivityIndicator,
  Image as RNImage,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./ui";
import { colors, darkColors, radii, typography } from "./theme";
import {
  buildDicomSeries,
  type DicomMetadata,
  type DicomSeries
} from "./dicomSeries";
import {
  clampImagePan,
  frameFromVerticalDrag,
  panForFocalZoom,
  zoomFromPinch
} from "./dicomGestures";
import {
  cachePreparedXAManifest,
  getCachedPreparedXAManifest,
  loadRenderedFrameBlob,
  loadXACaptures,
  resolvePreparedCineSource,
  saveXACapture,
  type StoredXACapture
} from "./dicomOfflineCache";
import {
  getPreparedXAManifest,
  manifestDicomSeries,
  manifestFrameMap,
  preparedCineURL,
  preparedFrameKey,
  type PreparedXAManifest
} from "./xaPreparedCache";

const metadataNumber = (
  metadata: DicomMetadata | undefined,
  tag: string,
  fallback: number
): number => {
  const parsed = Number(metadata?.[tag]?.Value?.[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const renderedFrameURL = (
  frame: DicomSeries["frames"][number] | undefined
): string =>
  frame
    ? `${frame.instanceURL}/frames/${frame.frameIndex + 1}/rendered` +
      "?viewport=768,768&quality=85"
    : "";

const touchDistance = (touches: readonly { pageX: number; pageY: number }[]) =>
  touches.length < 2
    ? 0
    : Math.hypot(
        touches[0]!.pageX - touches[1]!.pageX,
        touches[0]!.pageY - touches[1]!.pageY
      );

type ViewerCapture = StoredXACapture & { url: string };

export function MobileDicomViewer({
  studyUID,
  dicomWebRoot = "/dicom-web",
  persistentCacheEnabled = false,
  desktop = false
}: {
  studyUID: string;
  dicomWebRoot?: string;
  persistentCacheEnabled?: boolean;
  desktop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const renderedCache = useRef(new Map<string, Promise<string>>());
  const blobURLs = useRef(new Set<string>());
  const pinchStartDistance = useRef(0);
  const pinchStartZoom = useRef(1);
  const pinchStartFocal = useRef({ x: 0, y: 0 });
  const pinchStartPan = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const singleStartTouch = useRef({ x: 0, y: 0 });
  const singleStartFrame = useRef(0);
  const gestureState = useRef({
    frameIndex: 0,
    frameCount: 0,
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    viewport: { width: 1, height: 1 },
    playing: false
  });
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const pendingAutoPlaySeries = useRef<number | null>(null);
  const resolvedCineURL = useRef<string | null>(null);
  const cineFallbackUsed = useRef(false);
  const seriesSheetY = useRef(new Animated.Value(0)).current;
  const gallerySheetY = useRef(new Animated.Value(0)).current;
  const capturePinchDistance = useRef(0);
  const capturePinchZoom = useRef(1);
  const capturePanStart = useRef({ x: 0, y: 0 });
  const [series, setSeries] = useState<DicomSeries[]>([]);
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [frameReady, setFrameReady] = useState(false);
  const [frameSource, setFrameSource] = useState("");
  const [preparedManifest, setPreparedManifest] =
    useState<PreparedXAManifest | null>(null);
  const [cineSource, setCineSource] = useState("");
  const [cineReady, setCineReady] = useState(false);
  const [preciseMode, setPreciseMode] = useState(false);
  const [seriesPreviews, setSeriesPreviews] = useState<Record<string, string>>(
    {}
  );
  const [error, setError] = useState("");
  const [captures, setCaptures] = useState<ViewerCapture[]>([]);
  const [activeCapture, setActiveCapture] = useState<ViewerCapture | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [captureZoom, setCaptureZoom] = useState(1);
  const [capturePan, setCapturePan] = useState({ x: 0, y: 0 });
  const [preparedFrames, setPreparedFrames] = useState<Map<string, string>>(
    () => new Map()
  );

  const selectedSeries = series[seriesIndex] ?? null;
  const frameCount = selectedSeries?.frames.length ?? 0;
  const selectedFrame = selectedSeries?.frames[frameIndex];
  const selectedPreparedSeries = preparedManifest?.series.find(
    (item) => item.series_uid === selectedSeries?.uid
  );
  const selectedCineURL = selectedPreparedSeries
    ? preparedCineURL(selectedPreparedSeries)
    : null;
  const selectedFPS = selectedPreparedSeries?.fps || 12;
  const frameURL = selectedFrame
    ? preparedFrames.get(
        preparedFrameKey(selectedFrame.instanceUID, selectedFrame.frameIndex + 1)
      ) ?? renderedFrameURL(selectedFrame)
    : "";
  const rows = metadataNumber(selectedFrame?.metadata, "00280010", 0);
  const columns = metadataNumber(selectedFrame?.metadata, "00280011", 0);
  const bitsStored = metadataNumber(selectedFrame?.metadata, "00280101", 12);
  const windowWidth = metadataNumber(
    selectedFrame?.metadata,
    "00281051",
    2 ** bitsStored - 1
  );
  const windowCenter = metadataNumber(
    selectedFrame?.metadata,
    "00281050",
    Math.round(windowWidth / 2)
  );

  const loadRenderedFrame = useCallback(
    (url: string, signal?: AbortSignal): Promise<string> => {
      let pending = renderedCache.current.get(url);
      if (!pending) {
        pending = loadRenderedFrameBlob(url, {
          studyUID,
          persist: persistentCacheEnabled,
          signal
        }).then((blob) => {
          const objectURL = URL.createObjectURL(blob);
          blobURLs.current.add(objectURL);
          return objectURL;
        });
        renderedCache.current.set(url, pending);
        void pending.catch(() => {
          if (renderedCache.current.get(url) === pending) {
            renderedCache.current.delete(url);
          }
        });
      }
      return pending;
    },
    [persistentCacheEnabled, studyUID]
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    blobURLs.current.forEach((url) => URL.revokeObjectURL(url));
    blobURLs.current.clear();
    renderedCache.current.clear();
    const cachedPrepared = persistentCacheEnabled
      ? getCachedPreparedXAManifest(studyUID)
      : null;
    setMetadataLoading(!cachedPrepared);
    setFrameReady(false);
    setFrameSource("");
    setSeriesPreviews({});
    setError("");
    setSeries(
      cachedPrepared
        ? manifestDicomSeries(cachedPrepared, dicomWebRoot.replace(/\/$/, ""))
        : []
    );
    setPreparedManifest(cachedPrepared);
    setPreparedFrames(
      cachedPrepared ? manifestFrameMap(cachedPrepared) : new Map()
    );
    setSeriesIndex(0);
    pendingAutoPlaySeries.current = null;
    resolvedCineURL.current = null;
    setFrameIndex(0);
    setPlaying(false);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setCineSource("");
    setCineReady(false);
    setPreciseMode(false);
    setSeriesOpen(false);
    setCaptures([]);
    setActiveCapture(null);

    void loadXACaptures(studyUID)
      .then((stored) => {
        if (cancelled) return;
        const restored = stored.map((capture) => {
          const url = URL.createObjectURL(capture.blob);
          blobURLs.current.add(url);
          return { ...capture, url };
        });
        setCaptures(restored);
      })
      .catch(() => undefined);

    void (async () => {
      try {
        const root = dicomWebRoot.replace(/\/$/, "");
        if (cachedPrepared) return;
        let prepared: PreparedXAManifest | null = null;
        try {
          prepared = await getPreparedXAManifest(studyUID, {
            signal: controller.signal
          });
        } catch {
          // Direct PACS metadata remains a compatibility fallback.
        }
        if (prepared) {
          const preparedSeries = manifestDicomSeries(prepared, root);
          if (!cancelled) {
            if (persistentCacheEnabled) cachePreparedXAManifest(prepared);
            setSeries(preparedSeries);
            setPreparedManifest(prepared);
            setPreparedFrames(manifestFrameMap(prepared));
          }
          if (prepared.status === "partial") {
            void getPreparedXAManifest(studyUID, {
              wait: true,
              signal: controller.signal
            })
              .then((complete) => {
                if (cancelled || !complete) return;
                if (persistentCacheEnabled) cachePreparedXAManifest(complete);
                setSeries(manifestDicomSeries(complete, root));
                setPreparedManifest(complete);
                setPreparedFrames(manifestFrameMap(complete));
              })
              .catch(() => undefined);
          }
          // The prepared manifest is the playback source of truth. Asking
          // Orthanc for the full DICOM metadata here used to compete with MP4
          // delivery and also failed after an archived study left PACS.
          return;
        }

        const metadataResponse = await fetch(
          `${root}/studies/${encodeURIComponent(studyUID)}/metadata`,
          {
            headers: { Accept: "application/dicom+json" },
            signal: controller.signal
          }
        );
        let loadedSeries: DicomSeries[] = [];
        if (metadataResponse.ok) {
          const metadata = (await metadataResponse.json()) as DicomMetadata[];
          loadedSeries = buildDicomSeries(metadata, studyUID, root);
        }
        if (!loadedSeries.length) {
          const ready = await getPreparedXAManifest(studyUID, {
            wait: true,
            signal: controller.signal
          });
          if (ready) {
            prepared = ready;
            loadedSeries = manifestDicomSeries(ready, root);
            if (!cancelled) setPreparedFrames(manifestFrameMap(ready));
          }
        }
        if (!loadedSeries.length) {
          throw new Error(
            metadataResponse.status
              ? `Не удалось подготовить XA (PACS HTTP ${metadataResponse.status})`
              : "В исследовании не найдены DICOM-кадры"
          );
        }
        if (!cancelled) {
          setSeries(loadedSeries);
          if (prepared) {
            if (persistentCacheEnabled) cachePreparedXAManifest(prepared);
            setPreparedManifest(prepared);
            setPreparedFrames(manifestFrameMap(prepared));
          } else {
            void getPreparedXAManifest(studyUID, {
              wait: true,
              signal: controller.signal
            })
              .then((ready) => {
                if (!cancelled && ready) {
                  if (persistentCacheEnabled) cachePreparedXAManifest(ready);
                  setPreparedManifest(ready);
                  setPreparedFrames(manifestFrameMap(ready));
                }
              })
              .catch(() => undefined);
          }
        }
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось открыть DICOM-исследование"
          );
        }
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dicomWebRoot, persistentCacheEnabled, studyUID]);

  useEffect(() => {
    let cancelled = false;
    let localSource = "";
    setPlaying(false);
    setCineReady(false);
    setCineSource("");
    setPreciseMode(false);
    cineFallbackUsed.current = false;
    resolvedCineURL.current = null;
    if (!selectedCineURL) return;
    void resolvePreparedCineSource(selectedCineURL)
      .then(({ source, local }) => {
        if (cancelled) {
          if (local) URL.revokeObjectURL(source);
          return;
        }
        if (local) localSource = source;
        resolvedCineURL.current = selectedCineURL;
        setCineSource(source);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "Не удалось открыть cine XA"
          );
        }
      });
    return () => {
      cancelled = true;
      if (localSource) URL.revokeObjectURL(localSource);
    };
  }, [selectedCineURL]);

  useEffect(() => {
    if (!frameURL || (selectedCineURL && !preciseMode && cineReady)) {
      return;
    }
    let cancelled = false;
    setError("");
    void loadRenderedFrame(frameURL)
      .then((source) => {
        if (!cancelled) setFrameSource(source);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setPlaying(false);
          setError(
            reason instanceof Error
              ? reason.message
              : "PACS не смог отрисовать выбранный XA-кадр"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cineReady, frameURL, loadRenderedFrame, preciseMode, selectedCineURL]);

  useEffect(() => {
    if (!selectedSeries?.frames.length) return;
    if (selectedCineURL && !cineReady) return;
    // Desktop playback uses MP4 and fetches an exact JPEG only when paused or
    // capturing. Downloading every JPEG in advance competes with the cine on
    // the same internet connection and makes the web viewer appear frozen.
    if (desktop) return;
    let cancelled = false;
    const controller = new AbortController();
    let nextIndex = 0;
    const frames = selectedSeries.frames;
    const worker = async () => {
      while (!cancelled) {
        const frame = frames[nextIndex++];
        if (!frame) return;
        const url =
          preparedFrames.get(
            preparedFrameKey(frame.instanceUID, frame.frameIndex + 1)
          ) ?? renderedFrameURL(frame);
        await loadRenderedFrame(url, controller.signal).catch(() => undefined);
      }
    };
    // Let the MP4 establish playback before JPEG precision frames begin using
    // the same connection. This keeps the first visible cine responsive.
    const timer = window.setTimeout(() => {
      if (!cancelled) void Promise.all(Array.from({ length: 2 }, () => worker()));
    }, 1200);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [cineReady, desktop, loadRenderedFrame, preparedFrames, selectedCineURL, selectedSeries]);

  useEffect(() => {
    if (selectedCineURL && !cineReady) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      for (const item of series) {
        if (cancelled) break;
        const firstFrame = item.frames[0];
        const previewURL = firstFrame
          ? preparedFrames.get(
              preparedFrameKey(firstFrame.instanceUID, firstFrame.frameIndex + 1)
            ) ?? renderedFrameURL(firstFrame)
          : "";
        try {
          if (!previewURL) continue;
          const source = await loadRenderedFrame(previewURL, controller.signal);
          if (!cancelled) {
            setSeriesPreviews((current) => ({
              ...current,
              [item.uid]: source
            }));
          }
        } catch {
          // A missing preview must not block the selected XA series.
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cineReady, loadRenderedFrame, preparedFrames, selectedCineURL, series]);

  useEffect(() => {
    const element = videoElement.current;
    if (!element || !selectedCineURL) return;
    element.playbackRate = 1;
  }, [selectedCineURL]);

  useEffect(() => {
    if (
      pendingAutoPlaySeries.current !== seriesIndex ||
      !cineReady ||
      !cineSource ||
      resolvedCineURL.current !== selectedCineURL ||
      preciseMode
    ) {
      return;
    }
    const element = videoElement.current;
    if (!element) return;
    pendingAutoPlaySeries.current = null;
    element.playbackRate = 1;
    void element.play().catch(() => undefined);
  }, [cineReady, cineSource, preciseMode, selectedCineURL, seriesIndex]);

  useEffect(() => {
    if (!selectedSeries || playing || !preciseMode || !frameReady) return;
    const adjacent = [
      selectedSeries.frames[frameIndex + 1],
      selectedSeries.frames[frameIndex - 1]
    ].filter(Boolean);
    void (async () => {
      for (const frame of adjacent) {
        if (!frame) continue;
        const url =
          preparedFrames.get(
            preparedFrameKey(frame.instanceUID, frame.frameIndex + 1)
          ) ?? renderedFrameURL(frame);
        await loadRenderedFrame(url).catch(() => undefined);
      }
    })();
  }, [
    frameIndex,
    frameReady,
    loadRenderedFrame,
    playing,
    preciseMode,
    preparedFrames,
    selectedSeries
  ]);

  useEffect(
    () => () => {
      blobURLs.current.forEach((url) => URL.revokeObjectURL(url));
      blobURLs.current.clear();
    },
    []
  );

  useEffect(() => {
    if (!playing || selectedCineURL || frameCount < 2) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nextFrame = (frameIndex + 1) % frameCount;
    const nextFrameItem = selectedSeries?.frames[nextFrame];
    const nextURL = nextFrameItem
      ? preparedFrames.get(
          preparedFrameKey(
            nextFrameItem.instanceUID,
            nextFrameItem.frameIndex + 1
          )
        ) ?? renderedFrameURL(nextFrameItem)
      : "";
    const startedAt = Date.now();
    void loadRenderedFrame(nextURL)
      .then(() => {
        if (cancelled) return;
        const delay = Math.max(0, Math.round(1000 / 12) - (Date.now() - startedAt));
        timer = setTimeout(() => {
          if (!cancelled) setFrameIndex(nextFrame);
        }, delay);
      })
      .catch(() => {
        if (!cancelled) {
          setPlaying(false);
          setError("PACS не смог подготовить следующий XA-кадр");
        }
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    frameCount,
    frameIndex,
    loadRenderedFrame,
    playing,
    preparedFrames,
    selectedCineURL,
    selectedSeries
  ]);

  const imageNode = useMemo(
    () =>
      createElement("img", {
        src: frameSource,
        alt: "Кадр XA",
        onLoad: () => setFrameReady(true),
        onError: () => {
          setPlaying(false);
          setError("PACS не смог отрисовать выбранный XA-кадр");
        },
        onDoubleClick: () => {
          setZoom(1);
          setPanOffset({ x: 0, y: 0 });
        },
        style: {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
          touchAction: "none",
          userSelect: "none",
          pointerEvents: "none",
          opacity: frameSource && (preciseMode || !cineReady) ? 1 : 0
        }
      }),
    [
      frameSource,
      cineReady,
      panOffset.x,
      panOffset.y,
      preciseMode,
      zoom
    ]
  );

  const videoNode = useMemo(
    () =>
      createElement("video", {
        ref: (element: HTMLVideoElement | null) => {
          videoElement.current = element;
        },
        src: cineSource,
        muted: true,
        playsInline: true,
        preload: "auto",
        loop: true,
        onLoadedData: () => {
          setCineReady(true);
          if (!preciseMode) setFrameReady(true);
        },
        onCanPlay: () => {
          setCineReady(true);
          if (!preciseMode) setFrameReady(true);
        },
        onPlay: () => setPlaying(true),
        onPause: () => setPlaying(false),
        onTimeUpdate: () => {
          const element = videoElement.current;
          if (!element || preciseMode || frameCount < 1) return;
          setFrameIndex(
            Math.max(
              0,
              Math.min(
                frameCount - 1,
                Math.round(element.currentTime * selectedFPS)
              )
            )
          );
        },
        onError: () => {
          setPlaying(false);
          if (
            cineSource.startsWith("blob:") &&
            selectedCineURL &&
            !cineFallbackUsed.current
          ) {
            cineFallbackUsed.current = true;
            setCineReady(false);
            setError("");
            setCineSource(selectedCineURL);
            return;
          }
          setError("Не удалось воспроизвести подготовленную XA-серию");
        },
        style: {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
          touchAction: "none",
          userSelect: "none",
          pointerEvents: "none",
          opacity: !cineReady || (preciseMode && frameSource) ? 0 : 1
        }
      }),
    [
      cineSource,
      cineReady,
      frameCount,
      frameSource,
      panOffset.x,
      panOffset.y,
      preciseMode,
      selectedCineURL,
      selectedFPS,
      zoom
    ]
  );

  gestureState.current = {
    frameIndex,
    frameCount,
    zoom,
    panOffset,
    viewport: viewportSize,
    playing
  };

  const gestures = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !gestureState.current.playing,
        onMoveShouldSetPanResponder: () => !gestureState.current.playing,
        onPanResponderGrant: (event) => {
          const current = gestureState.current;
          singleStartFrame.current = current.frameIndex;
          panStart.current = current.panOffset;
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            setPreciseMode(true);
            pinchStartDistance.current = touchDistance(touches);
            pinchStartZoom.current = current.zoom;
            pinchStartPan.current = current.panOffset;
            const centerX = (touches[0]!.locationX + touches[1]!.locationX) / 2;
            const centerY = (touches[0]!.locationY + touches[1]!.locationY) / 2;
            pinchStartFocal.current = { x: centerX, y: centerY };
          } else if (touches[0]) {
            singleStartTouch.current = {
              x: touches[0].pageX,
              y: touches[0].pageY
            };
            setPreciseMode(true);
          }
        },
        onPanResponderMove: (event) => {
          const current = gestureState.current;
          if (current.playing) return;
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            if (pinchStartDistance.current <= 0) {
              pinchStartDistance.current = touchDistance(touches);
              pinchStartZoom.current = current.zoom;
              pinchStartPan.current = current.panOffset;
              pinchStartFocal.current = {
                x: (touches[0]!.locationX + touches[1]!.locationX) / 2,
                y: (touches[0]!.locationY + touches[1]!.locationY) / 2
              };
              return;
            }
            const nextZoom = zoomFromPinch(
              pinchStartZoom.current,
              pinchStartDistance.current,
              touchDistance(touches)
            );
            setZoom(nextZoom);
            setPanOffset(
              panForFocalZoom(
                pinchStartPan.current,
                pinchStartZoom.current,
                nextZoom,
                pinchStartFocal.current,
                current.viewport
              )
            );
            return;
          }
          const touch = touches[0];
          if (!touch) return;
          if (pinchStartDistance.current > 0) {
            pinchStartDistance.current = 0;
            panStart.current = current.panOffset;
            singleStartFrame.current = current.frameIndex;
            singleStartTouch.current = { x: touch.pageX, y: touch.pageY };
            return;
          }
          const deltaX = touch.pageX - singleStartTouch.current.x;
          const deltaY = touch.pageY - singleStartTouch.current.y;
          if (current.zoom > 1) {
            setPanOffset(
              clampImagePan(
                {
                  x: panStart.current.x + deltaX,
                  y: panStart.current.y + deltaY
                },
                current.zoom,
                current.viewport
              )
            );
            return;
          }
          setFrameIndex(
            frameFromVerticalDrag(
              singleStartFrame.current,
              deltaY,
              current.frameCount
            )
          );
        },
        onPanResponderRelease: () => {
          pinchStartDistance.current = 0;
        },
        onPanResponderTerminate: () => {
          pinchStartDistance.current = 0;
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true
      }),
    []
  );

  const seriesSheetGesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          seriesSheetY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.75) {
            Animated.timing(seriesSheetY, {
              toValue: 430,
              duration: 180,
              useNativeDriver: true
            }).start(() => {
              setSeriesOpen(false);
              seriesSheetY.setValue(0);
            });
            return;
          }
          Animated.spring(seriesSheetY, {
            toValue: 0,
            useNativeDriver: true
          }).start();
        }
      }),
    [seriesSheetY]
  );

  const gallerySheetGesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          gallerySheetY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.75) {
            Animated.timing(gallerySheetY, {
              toValue: 430,
              duration: 180,
              useNativeDriver: true
            }).start(() => {
              setGalleryOpen(false);
              gallerySheetY.setValue(0);
            });
            return;
          }
          Animated.spring(gallerySheetY, {
            toValue: 0,
            useNativeDriver: true
          }).start();
        }
      }),
    [gallerySheetY]
  );

  const reset = () => {
    setPlaying(false);
    videoElement.current?.pause();
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const togglePlayback = () => {
    if (!selectedCineURL) {
      setPlaying((current) => !current);
      return;
    }
    const element = videoElement.current;
    if (!element) return;
    if (playing) {
      element.pause();
      setFrameIndex(
        Math.max(
          0,
          Math.min(frameCount - 1, Math.round(element.currentTime * selectedFPS))
        )
      );
      setPreciseMode(true);
      return;
    }
    setPreciseMode(false);
    setFrameReady(cineReady);
    element.playbackRate = 1;
    void element.play().catch(() => {
      setError("Браузер не разрешил запустить cine");
    });
  };

  const captureFrame = async () => {
    if (!frameURL) return;
    videoElement.current?.pause();
    setPlaying(false);
    setPreciseMode(true);
    try {
      const blob = await loadRenderedFrameBlob(frameURL, {
        studyUID,
        persist: persistentCacheEnabled
      });
      const source = URL.createObjectURL(blob);
      const image = new Image();
      image.src = source;
      await image.decode();
      const width = Math.max(1, Math.round(viewportSize.width));
      const height = Math.max(1, Math.round(viewportSize.height));
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось подготовить захват");
      context.scale(pixelRatio, pixelRatio);
      context.fillStyle = "#05080B";
      context.fillRect(0, 0, width, height);
      const contain = Math.min(width / image.width, height / image.height);
      const displayWidth = image.width * contain;
      const displayHeight = image.height * contain;
      context.translate(
        width / 2 + panOffset.x,
        height / 2 + panOffset.y
      );
      context.scale(zoom, zoom);
      context.drawImage(
        image,
        -displayWidth / 2,
        -displayHeight / 2,
        displayWidth,
        displayHeight
      );
      URL.revokeObjectURL(source);
      const capturedBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("Не удалось создать JPEG")),
          "image/jpeg",
          0.95
        )
      );
      const filename = `XA-${studyUID}-S${seriesIndex + 1}-F${frameIndex + 1}.jpg`;
      const capture = {
        id: `${Date.now()}-${frameIndex}`,
        url: URL.createObjectURL(capturedBlob),
        blob: capturedBlob,
        filename,
        studyUID,
        createdAt: new Date().toISOString()
      };
      blobURLs.current.add(capture.url);
      await saveXACapture(capture);
      setCaptures((current) => [capture, ...current]);
      setCaptureZoom(1);
      setCapturePan({ x: 0, y: 0 });
      setActiveCapture(capture);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить кадр XA"
      );
    }
  };

  const shareCapture = async (
    capture: { blob: Blob; filename: string }
  ) => {
    const file = new File([capture.blob], capture.filename, {
      type: "image/jpeg"
    });
    const shareData = { files: [file], title: "Кадр ангиографии" };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try {
        await navigator.share(shareData);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        throw reason;
      }
      return;
    }
    const source = URL.createObjectURL(capture.blob);
    const anchor = document.createElement("a");
    anchor.href = source;
    anchor.download = capture.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(source), 1_000);
  };

  const captureGestures = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches;
          capturePinchDistance.current = touchDistance(touches);
          capturePinchZoom.current = captureZoom;
          capturePanStart.current = capturePan;
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            const distance = touchDistance(touches);
            if (capturePinchDistance.current <= 0) {
              capturePinchDistance.current = distance;
              capturePinchZoom.current = captureZoom;
              return;
            }
            setCaptureZoom(
              Math.max(
                1,
                Math.min(
                  5,
                  capturePinchZoom.current *
                    (distance / capturePinchDistance.current)
                )
              )
            );
            return;
          }
          if (captureZoom > 1) {
            setCapturePan({
              x: capturePanStart.current.x + gesture.dx,
              y: capturePanStart.current.y + gesture.dy
            });
          }
        },
        onPanResponderRelease: () => {
          capturePinchDistance.current = 0;
          if (captureZoom <= 1) setCapturePan({ x: 0, y: 0 });
        }
      }),
    [capturePan, captureZoom]
  );

  const selectSeries = (index: number, closeSheet = false) => {
    setPlaying(false);
    videoElement.current?.pause();
    pendingAutoPlaySeries.current = index;
    setSeriesIndex(index);
    setFrameIndex(0);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setPreciseMode(false);
    if (closeSheet) setSeriesOpen(false);
    if (index === seriesIndex && cineReady && videoElement.current) {
      pendingAutoPlaySeries.current = null;
      void videoElement.current.play().catch(() => undefined);
    }
  };

  return (
    <View
      style={[
        styles.root,
        desktop && styles.rootDesktop,
        {
          paddingTop: desktop ? 0 : insets.top + 58,
          paddingBottom: desktop ? 0 : insets.bottom + 82
        }
      ]}
    >
      {desktop && series.length ? (
        <View style={styles.desktopSeriesRail}>
          <Text style={styles.desktopSeriesTitle}>Серии · {series.length}</Text>
          <ScrollView
            style={styles.desktopSeriesScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.desktopSeriesContent}
          >
            {series.map((item, index) => (
              <Pressable
                key={item.uid}
                accessibilityRole="button"
                accessibilityLabel={`Открыть серию ${index + 1}`}
                onPress={() => selectSeries(index)}
                style={[
                  styles.desktopSeriesTile,
                  index === seriesIndex && styles.seriesTileActive
                ]}
              >
                {seriesPreviews[item.uid] ? (
                  <RNImage
                    source={{ uri: seriesPreviews[item.uid] }}
                    resizeMode="cover"
                    style={styles.seriesPreview}
                  />
                ) : (
                  <View style={styles.previewPlaceholder}>
                    <ActivityIndicator color={darkColors.textMuted} size="small" />
                  </View>
                )}
                <Text style={styles.seriesNumber}>{index + 1}</Text>
                <Text style={styles.seriesFrames}>{item.frames.length}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {desktop && !metadataLoading && !error && selectedSeries && selectedFrame ? (
        <View style={styles.desktopControls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Предыдущая серия" disabled={series.length < 2} onPress={() => selectSeries((seriesIndex - 1 + series.length) % series.length)} style={[styles.controlButton, series.length < 2 && styles.controlButtonDisabled]}>
            <Icon name="chevron-up" size={20} color={darkColors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? "Пауза" : "Воспроизвести cine"}
            onPress={togglePlayback}
            style={[styles.controlButton, styles.playButton]}
          >
            <Icon name={playing ? "pause" : "play"} size={21} color={darkColors.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Следующая серия" disabled={series.length < 2} onPress={() => selectSeries((seriesIndex + 1) % series.length)} style={[styles.controlButton, series.length < 2 && styles.controlButtonDisabled]}>
            <Icon name="chevron-down" size={20} color={darkColors.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Сбросить изображение" onPress={reset} style={styles.controlButton}>
            <Icon name="refresh" size={19} color={darkColors.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Сохранить текущий кадр" onPress={() => void captureFrame()} style={styles.controlButton}>
            <Icon name="camera-outline" size={19} color={darkColors.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Открыть сохранённые кадры" onPress={() => setGalleryOpen(true)} style={styles.controlButton}>
            <Icon name="images-outline" size={19} color={darkColors.text} />
            {captures.length ? (
              <View style={styles.captureBadge}>
                <Text style={styles.captureBadgeText}>{captures.length}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : null}
      <View
        {...gestures.panHandlers}
        onLayout={(event) =>
          setViewportSize({
            width: Math.max(1, event.nativeEvent.layout.width),
            height: Math.max(1, event.nativeEvent.layout.height)
          })
        }
        style={[styles.viewport, desktop && styles.viewportDesktop]}
      >
        {cineSource ? videoNode : null}
        {frameSource ? imageNode : null}
        {selectedFrame ? (
          <>
            <Text style={[styles.imageMeta, styles.resolutionMeta]}>
              Разрешение: {columns || "—"}×{rows || "—"}
            </Text>
            <Text style={[styles.imageMeta, styles.windowMeta]}>
              WW: {Math.round(windowWidth)} · WL: {Math.round(windowCenter)}
            </Text>
            <Text style={[styles.imageMeta, styles.seriesMeta]}>
              Серия {seriesIndex + 1}/{series.length}
            </Text>
            <Text style={[styles.imageMeta, styles.frameMeta]}>
              {frameIndex + 1}/{frameCount}
            </Text>
            {!playing ? (
              <Text style={styles.gestureHint}>
                {zoom > 1
                  ? "Перетаскивайте увеличенную область"
                  : "↑↓ кадры · масштаб двумя пальцами в нужной области"}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>

      {metadataLoading ||
      (!preparedManifest && !cineReady && !frameSource && !error) ? (
        <View style={styles.state}>
          <ActivityIndicator color={darkColors.primary} />
          <Text style={styles.stateText}>Подготавливаем просмотр XA…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.state}>
          <Icon name="alert-circle-outline" size={28} color={colors.danger} />
          <Text style={styles.errorTitle}>Не удалось открыть XA</Text>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : null}

      {!metadataLoading && !error && selectedSeries && selectedFrame ? (
        <>
          {!desktop ? <View
            style={[
              styles.controls,
              { bottom: Math.max(8, insets.bottom + 8) }
            ]}
          >
            <View style={styles.controlRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Предыдущая серия"
                disabled={series.length < 2}
                onPress={() => selectSeries((seriesIndex - 1 + series.length) % series.length)}
                style={[styles.controlButton, series.length < 2 && styles.controlButtonDisabled]}
              >
                <Icon name="play-skip-back" size={19} color={darkColors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Открыть серии"
                onPress={() => {
                  setPlaying(false);
                  setSeriesOpen(true);
                }}
                style={[
                  styles.controlButton,
                  seriesOpen && styles.controlButtonActive
                ]}
              >
                <Icon name="layers-outline" size={20} color={darkColors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Следующая серия"
                disabled={series.length < 2}
                onPress={() => selectSeries((seriesIndex + 1) % series.length)}
                style={[styles.controlButton, series.length < 2 && styles.controlButtonDisabled]}
              >
                <Icon name="play-skip-forward" size={19} color={darkColors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playing ? "Пауза" : "Воспроизвести cine"}
                onPress={togglePlayback}
                style={[styles.controlButton, styles.playButton]}
              >
                <Icon
                  name={playing ? "pause" : "play"}
                  size={21}
                  color={darkColors.text}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Сбросить изображение"
                onPress={reset}
                style={styles.controlButton}
              >
                <Icon name="refresh" size={19} color={darkColors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Сохранить текущий кадр"
                onPress={() => void captureFrame()}
                style={styles.controlButton}
              >
                <Icon name="camera-outline" size={19} color={darkColors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Открыть сохранённые кадры"
                onPress={() => setGalleryOpen(true)}
                style={styles.controlButton}
              >
                <Icon name="images-outline" size={19} color={darkColors.text} />
                {captures.length ? (
                  <View style={styles.captureBadge}>
                    <Text style={styles.captureBadgeText}>{captures.length}</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          </View> : null}
          {seriesOpen ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Закрыть серии"
                onPress={() => setSeriesOpen(false)}
                style={styles.seriesBackdrop}
              />
              <Animated.View
                {...seriesSheetGesture.panHandlers}
                style={[
                  styles.seriesSheet,
                  {
                    paddingBottom: insets.bottom,
                    transform: [{ translateY: seriesSheetY }]
                  }
                ]}
              >
                <View style={styles.sheetHandle} />
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.seriesGrid}
                >
                  {series.map((item, index) => {
                    const previewURL = seriesPreviews[item.uid];
                    return (
                      <Pressable
                        key={item.uid}
                        accessibilityRole="button"
                        accessibilityLabel={`Открыть серию ${index + 1}`}
                        onPress={() => selectSeries(index, true)}
                        style={[
                          styles.seriesTile,
                          index === seriesIndex && styles.seriesTileActive
                        ]}
                      >
                        {previewURL ? (
                          <RNImage
                            source={{ uri: previewURL }}
                            resizeMode="cover"
                            style={styles.seriesPreview}
                          />
                        ) : (
                          <View style={styles.previewPlaceholder}>
                            <ActivityIndicator
                              color={darkColors.textMuted}
                              size="small"
                            />
                          </View>
                        )}
                        <Text style={styles.seriesNumber}>{index + 1}</Text>
                        <Text style={styles.seriesFrames}>
                          {item.frames.length}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            </>
          ) : null}
        </>
      ) : null}

      <Modal
        visible={Boolean(activeCapture)}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setActiveCapture(null)}
      >
        <View style={styles.captureViewer}>
          <View {...captureGestures.panHandlers} style={styles.captureCanvas}>
            {activeCapture ? (
              <RNImage
                source={{ uri: activeCapture.url }}
                resizeMode="contain"
                style={[
                  styles.captureImage,
                  {
                    transform: [
                      { translateX: capturePan.x },
                      { translateY: capturePan.y },
                      { scale: captureZoom }
                    ]
                  }
                ]}
              />
            ) : null}
          </View>
          <View style={[styles.captureTopBar, { top: insets.top + 10 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Назад к ангиографии"
              onPress={() => {
                setCaptureZoom(1);
                setCapturePan({ x: 0, y: 0 });
                setActiveCapture(null);
              }}
              style={styles.captureAction}
            >
              <Icon name="chevron-back" size={24} color={darkColors.text} />
            </Pressable>
          </View>
          <View style={[styles.captureShareBar, { bottom: insets.bottom + 14 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Отправить захваченный кадр"
              onPress={() => activeCapture && void shareCapture(activeCapture)}
              style={styles.captureShareButton}
            >
              <Icon name="share-outline" size={21} color={darkColors.text} />
              <Text style={styles.captureShareText}>Отправить</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={galleryOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGalleryOpen(false)}
      >
        <View style={styles.galleryBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть галерею"
            onPress={() => setGalleryOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            {...gallerySheetGesture.panHandlers}
            style={[
              styles.gallerySheet,
              {
                paddingBottom: insets.bottom + 12,
                transform: [{ translateY: gallerySheetY }]
              }
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.galleryHeader}>
              <Text style={styles.galleryTitle}>Захваты кадров</Text>
              <Pressable
                accessibilityLabel="Закрыть галерею"
                onPress={() => setGalleryOpen(false)}
                style={styles.captureAction}
              >
                <Icon name="close" size={21} color={darkColors.text} />
              </Pressable>
            </View>
            {captures.length ? (
              <ScrollView contentContainerStyle={styles.galleryGrid}>
                {captures.map((capture) => (
                  <Pressable
                    key={capture.id}
                    accessibilityLabel={`Открыть ${capture.filename}`}
                    onPress={() => {
                      setGalleryOpen(false);
                      setCaptureZoom(1);
                      setCapturePan({ x: 0, y: 0 });
                      setActiveCapture(capture);
                    }}
                    style={styles.galleryTile}
                  >
                    <RNImage
                      source={{ uri: capture.url }}
                      resizeMode="cover"
                      style={styles.galleryImage}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.galleryEmpty}>Захватов пока нет</Text>
            )}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 62,
    paddingBottom: 104,
    backgroundColor: "#05080B"
  },
  rootDesktop: {
    minHeight: 0,
    flexDirection: "row",
    borderWidth: 1,
    borderColor: darkColors.primary,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#12161B"
  },
  desktopSeriesRail: {
    width: 148,
    minWidth: 148,
    padding: 10,
    paddingBottom: 10,
    borderRightWidth: 1,
    borderRightColor: darkColors.borderSoft,
    backgroundColor: "#12161B"
  },
  desktopSeriesTitle: {
    ...typography.label,
    color: darkColors.text,
    marginBottom: 9
  },
  desktopSeriesContent: {
    gap: 9,
    paddingBottom: 14
  },
  desktopSeriesScroll: { flex: 1, minHeight: 0 },
  desktopSeriesTile: {
    width: "100%",
    aspectRatio: 1.35,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 10,
    backgroundColor: darkColors.surface
  },
  viewport: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: 6,
    marginTop: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: darkColors.primary,
    borderRadius: 20,
    backgroundColor: "#1E2127"
  },
  viewportDesktop: {
    flex: 1,
    alignSelf: "stretch",
    marginHorizontal: 0,
    marginTop: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderColor: "transparent",
    borderRadius: 0
  },
  state: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 28,
    backgroundColor: darkColors.canvas
  },
  errorTitle: { ...typography.title, color: darkColors.text },
  stateText: {
    ...typography.body,
    maxWidth: 340,
    color: darkColors.textMuted,
    textAlign: "center"
  },
  imageMeta: {
    position: "absolute",
    ...typography.meta,
    color: darkColors.text,
    fontSize: 10,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2
  },
  resolutionMeta: { top: 10, left: 12 },
  windowMeta: { top: 10, right: 12 },
  seriesMeta: { bottom: 12, left: 12 },
  frameMeta: { bottom: 12, right: 12 },
  gestureHint: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 36,
    color: darkColors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2
  },
  controls: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    minHeight: 62,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: darkColors.borderSoft,
    backgroundColor: "rgba(30,33,39,0.94)"
  },
  desktopControls: {
    width: 60,
    minWidth: 60,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 8,
    backgroundColor: darkColors.canvas
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.surface
  },
  controlButtonDisabled: { opacity: 0.35 },
  controlButtonActive: {
    borderWidth: 1,
    borderColor: darkColors.primary,
    backgroundColor: darkColors.primarySoft
  },
  playButton: {
    width: 50,
    backgroundColor: darkColors.primarySoft,
    borderWidth: 1,
    borderColor: darkColors.primary
  },
  speedButton: {
    minWidth: 62,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.surface
  },
  speedText: { ...typography.meta, color: darkColors.text },
  captureBadge: {
    position: "absolute",
    top: 3,
    right: 3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.primary
  },
  captureBadgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "900",
    color: "#031018"
  },
  seriesBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: "rgba(5,8,11,0.62)"
  },
  seriesSheet: {
    position: "absolute",
    zIndex: 21,
    left: 0,
    right: 0,
    bottom: 0,
    height: 420,
    paddingTop: 30,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "rgba(30,33,39,0.98)"
  },
  sheetHandle: {
    position: "absolute",
    top: 14,
    left: "33%",
    right: "33%",
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: "#3A414A"
  },
  seriesGrid: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 28,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 15
  },
  seriesTile: {
    width: "21.5%",
    minWidth: 70,
    maxWidth: 84,
    aspectRatio: 1,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 9,
    backgroundColor: darkColors.surface
  },
  seriesTileActive: {
    borderColor: darkColors.primary
  },
  seriesPreview: {
    width: "100%",
    height: "100%"
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  seriesNumber: {
    position: "absolute",
    left: 6,
    bottom: 5,
    ...typography.meta,
    color: "rgba(255,255,255,0.7)"
  },
  seriesFrames: {
    position: "absolute",
    right: 6,
    bottom: 5,
    ...typography.meta,
    color: "rgba(255,255,255,0.72)",
    fontWeight: "800"
  },
  captureViewer: {
    flex: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#05080B"
  },
  captureImage: {
    width: "100%",
    height: "100%"
  },
  captureCanvas: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  captureTopBar: {
    position: "absolute",
    left: 12,
    width: 46,
    height: 46
  },
  captureAction: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: darkColors.surface
  },
  captureShareBar: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center"
  },
  captureShareButton: {
    minWidth: 150,
    height: 50,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: darkColors.primary,
    backgroundColor: "rgba(30,33,39,0.96)"
  },
  captureShareText: {
    ...typography.label,
    color: darkColors.text
  },
  galleryBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(5,8,11,0.7)"
  },
  gallerySheet: {
    height: 420,
    paddingHorizontal: 14,
    paddingTop: 30,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "#1E2127"
  },
  galleryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12
  },
  galleryTitle: {
    ...typography.title,
    color: darkColors.text
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 15,
    paddingBottom: 20
  },
  galleryTile: {
    width: "21.5%",
    minWidth: 70,
    maxWidth: 84,
    aspectRatio: 1,
    overflow: "hidden",
    borderRadius: 9,
    borderWidth: 1,
    borderColor: darkColors.borderSoft
  },
  galleryImage: {
    width: "100%",
    height: "100%"
  },
  galleryEmpty: {
    ...typography.body,
    color: darkColors.textMuted,
    textAlign: "center",
    marginTop: 50
  }
});
