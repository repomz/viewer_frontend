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
