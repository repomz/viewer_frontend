import {
  clampImagePan,
  frameFromVerticalDrag,
  panForFocalZoom,
  zoomFromPinch
} from "./dicomGestures";

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

describe("image pan and focal pinch", () => {
  test("clamps a zoomed image inside the viewport", () => {
    expect(
      clampImagePan({ x: 500, y: -500 }, 2, { width: 300, height: 400 })
    ).toEqual({ x: 150, y: -200 });
    expect(
      clampImagePan({ x: 20, y: 30 }, 1, { width: 300, height: 400 })
    ).toEqual({ x: 0, y: 0 });
  });

  test("keeps an off-centre focal point under the fingers", () => {
    expect(
      panForFocalZoom(
        { x: 0, y: 0 },
        1,
        2,
        { x: 225, y: 100 },
        { width: 300, height: 400 }
      )
    ).toEqual({ x: -75, y: 100 });
  });
});
