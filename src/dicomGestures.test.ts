import { frameFromVerticalDrag, zoomFromPinch } from "./dicomGestures";

describe("DICOM touch gesture math", () => {
  it("moves forward on upward drag and backward on downward drag", () => {
    expect(frameFromVerticalDrag(10, -24, 30)).toBe(13);
    expect(frameFromVerticalDrag(10, 16, 30)).toBe(8);
  });

  it("keeps frames and zoom inside safe limits", () => {
    expect(frameFromVerticalDrag(1, 500, 20)).toBe(0);
    expect(frameFromVerticalDrag(18, -500, 20)).toBe(19);
    expect(zoomFromPinch(1, 100, 1000)).toBe(4);
    expect(zoomFromPinch(1, 100, 1)).toBe(0.5);
  });
});
