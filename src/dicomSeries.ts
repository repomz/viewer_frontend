export type DicomElement = {
  Value?: (string | number)[];
  vr?: string;
};

export type DicomMetadata = Record<string, DicomElement>;

export type DicomSeries = {
  uid: string;
  number: number;
  description: string;
  frames: {
    instanceUID: string;
    instanceURL: string;
    frameIndex: number;
    metadata: DicomMetadata;
  }[];
};

const value = (metadata: DicomMetadata, tag: string): string =>
  String(metadata[tag]?.Value?.[0] ?? "").trim();

const numericValue = (
  metadata: DicomMetadata,
  tag: string,
  fallback: number
): number => {
  const parsed = Number(value(metadata, tag));
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function buildDicomSeries(
  metadataItems: DicomMetadata[],
  studyUID: string,
  dicomWebRoot: string
): DicomSeries[] {
  const root = dicomWebRoot.replace(/\/$/, "");
  const grouped = new Map<
    string,
    {
      number: number;
      description: string;
      instances: {
        uid: string;
        number: number;
        frames: number;
        metadata: DicomMetadata;
      }[];
    }
  >();

  metadataItems.forEach((metadata, index) => {
    const seriesUID = value(metadata, "0020000E");
    const instanceUID = value(metadata, "00080018");
    if (!seriesUID || !instanceUID) return;
    const current = grouped.get(seriesUID) ?? {
      number: numericValue(metadata, "00200011", grouped.size + 1),
      description: value(metadata, "0008103E") || "Ангиографическая серия",
      instances: []
    };
    current.instances.push({
      uid: instanceUID,
      number: numericValue(metadata, "00200013", index + 1),
      frames: Math.max(1, numericValue(metadata, "00280008", 1)),
      metadata
    });
    grouped.set(seriesUID, current);
  });

  return [...grouped.entries()]
    .sort((left, right) => left[1].number - right[1].number)
    .map(([seriesUID, series]) => {
      const frames: DicomSeries["frames"] = [];
      series.instances
        .sort((left, right) => left.number - right.number)
        .forEach((instance) => {
          const instanceURL =
            `${root}/studies/${encodeURIComponent(studyUID)}` +
                `/series/${encodeURIComponent(seriesUID)}` +
            `/instances/${encodeURIComponent(instance.uid)}`;
          for (let frameIndex = 0; frameIndex < instance.frames; frameIndex += 1) {
            frames.push({
              instanceUID: instance.uid,
              instanceURL,
              frameIndex,
              metadata: instance.metadata
            });
          }
        });
      return {
        uid: seriesUID,
        number: series.number,
        description: series.description,
        frames
      };
    })
    .filter((series) => series.frames.length > 0);
}
