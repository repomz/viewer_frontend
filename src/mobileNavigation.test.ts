import { mobileNavigationIndexAtX } from "./mobileNavigation";

describe("mobileNavigationIndexAtX", () => {
  it("maps a finger position to the corresponding navigation button", () => {
    expect(mobileNavigationIndexAtX(0, 350, 5)).toBe(0);
    expect(mobileNavigationIndexAtX(69, 350, 5)).toBe(0);
    expect(mobileNavigationIndexAtX(70, 350, 5)).toBe(1);
    expect(mobileNavigationIndexAtX(349, 350, 5)).toBe(4);
  });

  it("clamps positions outside the navigation bounds", () => {
    expect(mobileNavigationIndexAtX(-20, 350, 5)).toBe(0);
    expect(mobileNavigationIndexAtX(500, 350, 5)).toBe(4);
  });
});
