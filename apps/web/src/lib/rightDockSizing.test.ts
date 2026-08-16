import { describe, expect, it } from "vitest";

import {
  RIGHT_DOCK_MAIN_MIN_WIDTH,
  RIGHT_DOCK_NORMAL_MIN_WIDTH,
  clampRightDockOpenWidth,
  clampRightDockShrinkWidth,
  rightDockEffectiveBounds,
} from "./rightDockSizing";

describe("rightDockEffectiveBounds", () => {
  it("keeps the 416px floor at wide shells and caps the dock at shell - 360", () => {
    expect(rightDockEffectiveBounds(1200)).toEqual({
      minDock: RIGHT_DOCK_NORMAL_MIN_WIDTH,
      maxDock: 1200 - RIGHT_DOCK_MAIN_MIN_WIDTH,
    });
    expect(rightDockEffectiveBounds(1000)).toEqual({ minDock: 416, maxDock: 640 });
  });

  it("collapses to the exact 416px boundary at a 776px shell", () => {
    expect(rightDockEffectiveBounds(776)).toEqual({ minDock: 416, maxDock: 416 });
  });

  it("lets the dock drop below 416 exactly as far as needed once the shell is under 776", () => {
    expect(rightDockEffectiveBounds(768)).toEqual({ minDock: 408, maxDock: 408 });
    expect(rightDockEffectiveBounds(700)).toEqual({ minDock: 340, maxDock: 340 });
    expect(rightDockEffectiveBounds(500)).toEqual({ minDock: 140, maxDock: 140 });
  });

  it("floors at zero for shells at or below the Main-conversation minimum", () => {
    expect(rightDockEffectiveBounds(360)).toEqual({ minDock: 0, maxDock: 0 });
    expect(rightDockEffectiveBounds(350)).toEqual({ minDock: 0, maxDock: 0 });
    expect(rightDockEffectiveBounds(0)).toEqual({ minDock: 0, maxDock: 0 });
  });

  it("keeps fractional ceilings exact so fractional shells never round a dock above shell - 360", () => {
    expect(rightDockEffectiveBounds(1000.5)).toEqual({ minDock: 416, maxDock: 640.5 });
    expect(rightDockEffectiveBounds(800.5)).toEqual({ minDock: 416, maxDock: 440.5 });
    expect(rightDockEffectiveBounds(700.5)).toEqual({ minDock: 340.5, maxDock: 340.5 });
    expect(rightDockEffectiveBounds(360.25)).toEqual({ minDock: 0.25, maxDock: 0.25 });
  });
});

describe("clampRightDockOpenWidth", () => {
  it("keeps the existing half-shell/preferred default at wide shells", () => {
    expect(clampRightDockOpenWidth(600, 1200, 416)).toBe(600);
    expect(clampRightDockOpenWidth(500, 1000, 416)).toBe(500);
  });

  it("keeps the existing minWidth floor at wide shells", () => {
    expect(clampRightDockOpenWidth(200, 1200, 416)).toBe(416);
  });

  it("clamps the default only downward when the shell cannot afford it", () => {
    expect(clampRightDockOpenWidth(900, 1200, 416)).toBe(840);
    expect(clampRightDockOpenWidth(700, 800, 416)).toBe(440);
  });

  it("opens at exactly shell - 360 below the 776px boundary", () => {
    expect(clampRightDockOpenWidth(388, 776, 416)).toBe(416);
    expect(clampRightDockOpenWidth(384, 768, 416)).toBe(408);
    expect(clampRightDockOpenWidth(350, 700, 416)).toBe(340);
    expect(clampRightDockOpenWidth(250, 500, 416)).toBe(140);
  });

  it("clamps the default to the exact fractional ceiling without rounding up", () => {
    expect(clampRightDockOpenWidth(650, 1000.5, 416)).toBe(640.5);
    expect(clampRightDockOpenWidth(640.6, 1000.5, 416)).toBe(640.5);
    expect(clampRightDockOpenWidth(640.5, 1000.5, 416)).toBe(640.5);
    expect(clampRightDockOpenWidth(440, 800.5, 416)).toBe(440);
  });

  it("clamps preferred pane widths (e.g. device) down to the ceiling", () => {
    expect(clampRightDockOpenWidth(608, 900, 416)).toBe(540);
  });

  it("collapses to a zero-width dock at or below a 360px shell", () => {
    expect(clampRightDockOpenWidth(175, 350, 416)).toBe(0);
    expect(clampRightDockOpenWidth(180, 360, 416)).toBe(0);
  });
});

describe("clampRightDockShrinkWidth", () => {
  it("leaves the dock alone when the shell can still afford it", () => {
    expect(clampRightDockShrinkWidth(600, 1200)).toBe(600);
    expect(clampRightDockShrinkWidth(500, 1000)).toBe(500);
  });

  it("auto-shrinks the dock when the shell shrinks below the current width", () => {
    expect(clampRightDockShrinkWidth(600, 800)).toBe(440);
    expect(clampRightDockShrinkWidth(600, 768)).toBe(408);
    expect(clampRightDockShrinkWidth(600, 500)).toBe(140);
  });

  it("never auto-grows the dock when the shell grows", () => {
    expect(clampRightDockShrinkWidth(440, 1200)).toBe(440);
    expect(clampRightDockShrinkWidth(408, 1000)).toBe(408);
    expect(clampRightDockShrinkWidth(340, 776)).toBe(340);
  });

  it("is monotonic non-increasing so repeated shell changes converge", () => {
    expect(clampRightDockShrinkWidth(clampRightDockShrinkWidth(600, 800), 1200)).toBe(440);
    expect(clampRightDockShrinkWidth(600, 1200)).toBe(600);
    expect(clampRightDockShrinkWidth(600, 350)).toBe(0);
  });

  it("shrinks to the exact fractional ceiling on fractional shell widths", () => {
    expect(clampRightDockShrinkWidth(641, 1000.5)).toBe(640.5);
    expect(clampRightDockShrinkWidth(640.6, 1000.5)).toBe(640.5);
    expect(clampRightDockShrinkWidth(640.5, 1000.5)).toBe(640.5);
    expect(clampRightDockShrinkWidth(600, 700.5)).toBe(340.5);
  });

  it("never rounds a fractional ceiling up past shell - 360", () => {
    expect(clampRightDockShrinkWidth(1000, 999.6)).toBe(639.6);
    expect(clampRightDockShrinkWidth(440.9, 800.4)).toBe(440.4);
    expect(clampRightDockShrinkWidth(200, 359.5)).toBe(0);
  });

  it("never auto-grows on fractional shell growth", () => {
    expect(clampRightDockShrinkWidth(640.5, 1200)).toBe(640.5);
    expect(clampRightDockShrinkWidth(340.5, 776)).toBe(340.5);
    expect(clampRightDockShrinkWidth(440.5, 800.5)).toBe(440.5);
  });
});
