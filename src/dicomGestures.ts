export function frameFromVerticalDrag(
  startFrame: number,
  dragY: number,
  frameCount: number,
  pixelsPerFrame = 8
): number {
  if (frameCount <= 1) return 0;
  const next = startFrame + Math.round(-dragY / pixelsPerFrame);
  return Math.max(0, Math.min(frameCount - 1, next));
}

export function zoomFromPinch(
  startZoom: number,
  startDistance: number,
  currentDistance: number
): number {
  if (startDistance <= 0 || currentDistance <= 0) return startZoom;
  return Math.max(0.5, Math.min(4, startZoom * (currentDistance / startDistance)));
}

export function clampImagePan(
  pan: { x: number; y: number },
  zoom: number,
  viewport: { width: number; height: number }
): { x: number; y: number } {
  if (zoom <= 1) return { x: 0, y: 0 };
  const maxX = Math.max(0, viewport.width * (zoom - 1) * 0.5);
  const maxY = Math.max(0, viewport.height * (zoom - 1) * 0.5);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y))
  };
}

export function panForFocalZoom(
  startPan: { x: number; y: number },
  startZoom: number,
  nextZoom: number,
  focal: { x: number; y: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  if (startZoom <= 0 || nextZoom <= 1) return { x: 0, y: 0 };
  const ratio = nextZoom / startZoom;
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  return clampImagePan(
    {
      x:
        startPan.x +
        (1 - ratio) * (focal.x - center.x - startPan.x),
      y:
        startPan.y +
        (1 - ratio) * (focal.y - center.y - startPan.y)
    },
    nextZoom,
    viewport
  );
}
