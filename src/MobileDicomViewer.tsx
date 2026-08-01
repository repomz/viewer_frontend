import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ActivityIndicator,
  Image as RNImage,
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
  loadRenderedFrameBlob,
  resolvePreparedCineSource
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

export function MobileDicomViewer({
  studyUID,
  dicomWebRoot = "/dicom-web",
  persistentCacheEnabled = false
}: {
  studyUID: string;
  dicomWebRoot?: string;
  persistentCacheEnabled?: boolean;
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
  const [series, setSeries] = useState<DicomSeries[]>([]);
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(12);
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
  const selectedFPS = selectedPreparedSeries?.fps || fps;
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
    (url: string): Promise<string> => {
      let pending = renderedCache.current.get(url);
      if (!pending) {
        pending = loadRenderedFrameBlob(url, {
          studyUID,
          persist: persistentCacheEnabled
        }).then((blob) => {
          const objectURL = URL.createObjectURL(blob);
          blobURLs.current.add(objectURL);
          return objectURL;
        });
        renderedCache.current.set(url, pending);
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
    setMetadataLoading(true);
    setFrameReady(false);
    setFrameSource("");
    setSeriesPreviews({});
    setError("");
    setSeries([]);
    setPreparedManifest(null);
    setPreparedFrames(new Map());
    setSeriesIndex(0);
    setFrameIndex(0);
    setPlaying(false);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setCineSource("");
    setCineReady(false);
    setPreciseMode(false);
    setSeriesOpen(false);

    void (async () => {
      try {
        const root = dicomWebRoot.replace(/\/$/, "");
        const [metadataResult, preparedResult] = await Promise.allSettled([
          fetch(`${root}/studies/${encodeURIComponent(studyUID)}/metadata`, {
            headers: { Accept: "application/dicom+json" },
            signal: controller.signal
          }),
          getPreparedXAManifest(studyUID, {
            signal: controller.signal
          })
        ]);
        const prepared =
          preparedResult.status === "fulfilled" ? preparedResult.value : null;
        let loadedSeries: DicomSeries[] = [];
        if (
          metadataResult.status === "fulfilled" &&
          metadataResult.value.ok
        ) {
          const metadata = (await metadataResult.value.json()) as DicomMetadata[];
          loadedSeries = buildDicomSeries(metadata, studyUID, root);
        }
        if (!loadedSeries.length && prepared) {
          loadedSeries = manifestDicomSeries(prepared, root);
        }
        if (!loadedSeries.length && !prepared) {
          const ready = await getPreparedXAManifest(studyUID, {
            wait: true,
            signal: controller.signal
          });
          if (ready) {
            loadedSeries = manifestDicomSeries(ready, root);
            if (!cancelled) setPreparedFrames(manifestFrameMap(ready));
          }
        }
        if (!loadedSeries.length) {
          const pacsStatus =
            metadataResult.status === "fulfilled"
              ? metadataResult.value.status
              : 0;
          throw new Error(
            pacsStatus
              ? `Не удалось подготовить XA (PACS HTTP ${pacsStatus})`
              : "В исследовании не найдены DICOM-кадры"
          );
        }
        if (!cancelled) {
          setSeries(loadedSeries);
          if (prepared) {
            setPreparedManifest(prepared);
            setPreparedFrames(manifestFrameMap(prepared));
          } else {
            void getPreparedXAManifest(studyUID, {
              wait: true,
              signal: controller.signal
            })
              .then((ready) => {
                if (!cancelled && ready) {
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
  }, [dicomWebRoot, studyUID]);

  useEffect(() => {
    let cancelled = false;
    let localSource = "";
    setPlaying(false);
    setCineReady(false);
    setCineSource("");
    setPreciseMode(false);
    if (!selectedCineURL) return;
    void resolvePreparedCineSource(selectedCineURL)
      .then(({ source, local }) => {
        if (cancelled) {
          if (local) URL.revokeObjectURL(source);
          return;
        }
        if (local) localSource = source;
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
    if (!frameURL || (selectedCineURL && !preciseMode)) {
      setFrameSource("");
      return;
    }
    let cancelled = false;
    setError("");
    setFrameReady(false);
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
  }, [frameURL, loadRenderedFrame, preciseMode, selectedCineURL]);

  useEffect(() => {
    if (!seriesOpen) return;
    let cancelled = false;
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
          const source = await loadRenderedFrame(previewURL);
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
    };
  }, [loadRenderedFrame, preparedFrames, series, seriesOpen]);

  useEffect(() => {
    const element = videoElement.current;
    if (!element || !selectedCineURL) return;
    element.playbackRate = Math.max(0.25, fps / selectedFPS);
  }, [fps, selectedCineURL, selectedFPS]);

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
        const delay = Math.max(0, Math.round(1000 / fps) - (Date.now() - startedAt));
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
    fps,
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
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
          touchAction: "none",
          userSelect: "none",
          pointerEvents: "none"
        }
      }),
    [
      frameSource,
      panOffset.x,
      panOffset.y,
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
          opacity: preciseMode ? 0 : 1
        }
      }),
    [
      cineSource,
      frameCount,
      panOffset.x,
      panOffset.y,
      preciseMode,
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
    element.playbackRate = Math.max(0.25, fps / selectedFPS);
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
      const file = new File(
        [blob],
        `XA-${studyUID}-S${seriesIndex + 1}-F${frameIndex + 1}.jpg`,
        { type: "image/jpeg" }
      );
      const shareData = { files: [file], title: "Кадр ангиографии" };
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }
      const source = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = source;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(source), 1_000);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить кадр XA"
      );
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 58,
          paddingBottom: insets.bottom + 82
        }
      ]}
    >
      <View
        {...gestures.panHandlers}
        onLayout={(event) =>
          setViewportSize({
            width: Math.max(1, event.nativeEvent.layout.width),
            height: Math.max(1, event.nativeEvent.layout.height)
          })
        }
        style={styles.viewport}
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

      {metadataLoading || (!frameReady && !error) ? (
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
          <View
            style={[
              styles.controls,
              { bottom: Math.max(8, insets.bottom + 8) }
            ]}
          >
            <View style={styles.controlRow}>
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
                accessibilityLabel="Изменить скорость cine"
                onPress={() =>
                  setFps((current) =>
                    current === 6 ? 12 : current === 12 ? 18 : 6
                  )
                }
                style={styles.speedButton}
              >
                <Text style={styles.speedText}>{fps} fps</Text>
              </Pressable>
            </View>
          </View>
          {seriesOpen ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Закрыть серии"
                onPress={() => setSeriesOpen(false)}
                style={styles.seriesBackdrop}
              />
              <View
                style={[
                  styles.seriesSheet,
                  { paddingBottom: insets.bottom }
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
                        onPress={() => {
                          setPlaying(false);
                          videoElement.current?.pause();
                          setSeriesIndex(index);
                          setFrameIndex(0);
                          setZoom(1);
                          setPanOffset({ x: 0, y: 0 });
                          setPreciseMode(false);
                          setSeriesOpen(false);
                        }}
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
              </View>
            </>
          ) : null}
        </>
      ) : null}
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
  }
});
