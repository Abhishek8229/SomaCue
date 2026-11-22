// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LABEL_GAP, layoutLabels, rectsOverlap, type LabelRequest } from "@/components/stage/angle-layout";

const pill = (key: string, x: number, y: number, priority: number, width = 150): LabelRequest => ({
  key,
  width,
  height: 22,
  anchor: { x, y },
  priority,
});

function expectClean(requests: LabelRequest[], bounds = { left: 8, top: 8, right: 350, bottom: 300 }) {
  const placements = layoutLabels(requests, bounds);
  const shown = placements.filter((placement) => placement.visible);
  const rects = shown.map((placement) => {
    const request = requests.find((r) => r.key === placement.key) as LabelRequest;
    return { x: placement.x, y: placement.y, width: request.width, height: request.height };
  });
  for (const rect of rects) {
    expect(rect.x).toBeGreaterThanOrEqual(bounds.left);
    expect(rect.y).toBeGreaterThanOrEqual(bounds.top);
    expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.right);
    expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.bottom);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let k = i + 1; k < rects.length; k++) expect(rectsOverlap(rects[i], rects[k], LABEL_GAP - 0.01)).toBe(false);
  }
  return placements;
}

describe("joint angle label layout", () => {
  it("puts a lone label just above its joint", () => {
    const [placement] = expectClean([pill("hip", 175, 150, 10)]);
    expect(placement.visible).toBe(true);
    expect(placement.y + 22).toBeLessThanOrEqual(150);
    expect(Math.abs(placement.x + 75 - 175)).toBeLessThan(1);
  });

  it("separates labels whose joints sit on top of each other (side view of both hips)", () => {
    const placements = expectClean([pill("a", 175, 160, 30), pill("b", 176, 161, 20), pill("c", 178, 158, 10)]);
    expect(placements.every((placement) => placement.visible)).toBe(true);
  });

  it("fits seven labels on a 358 px phone stage without overlap or clipping", () => {
    const requests = [
      pill("lumbar", 180, 170, 52),
      pill("pelvis", 150, 175, 41),
      pill("hip", 140, 180, 37),
      pill("shoulder", 250, 175, 37),
      pill("neck", 300, 160, 35),
      pill("thoracic", 220, 165, 22),
      pill("knee", 90, 150, 15),
    ];
    const placements = expectClean(requests);
    expect(placements.filter((placement) => placement.visible)).toHaveLength(7);
  });

  it("keeps labels of joints near the stage edge inside it", () => {
    const placements = expectClean([pill("head", 345, 10, 10), pill("foot", 5, 295, 9)]);
    expect(placements.every((placement) => placement.visible)).toBe(true);
  });

  it("hides labels rather than overlap when there is no room left", () => {
    const requests = Array.from({ length: 30 }, (_, i) => pill(`j${i}`, 175, 150, 30 - i));
    const placements = expectClean(requests, { left: 0, top: 0, right: 320, bottom: 120 });
    expect(placements.some((placement) => !placement.visible)).toBe(true);
    // The highest-priority labels win the room.
    expect(placements[0].visible).toBe(true);
  });

  it("keeps a label where it was last frame while that spot is still good", () => {
    const requests = [pill("hip", 175, 150, 10)];
    const first = layoutLabels(requests, { left: 0, top: 0, right: 350, bottom: 300 });
    const moved = layoutLabels(
      [pill("hip", 178, 151, 10)],
      { left: 0, top: 0, right: 350, bottom: 300 },
      [],
      new Map([["hip", first[0].slot]]),
    );
    expect(moved[0].slot).toBe(first[0].slot);
  });

  it("steers labels off the figure", () => {
    // Body points fill the space above the joint, so the label goes elsewhere.
    const body = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 4, y: 120 }));
    const [placement] = layoutLabels([pill("knee", 175, 150, 10)], { left: 0, top: 0, right: 350, bottom: 300 }, body);
    const rect = { x: placement.x, y: placement.y, width: 150, height: 22 };
    expect(body.filter((point) => point.x >= rect.x && point.x <= rect.x + 150 && point.y >= rect.y && point.y <= rect.y + 22)).toHaveLength(0);
  });

  it("draws a leader from the joint when the label sits away from it", () => {
    const placements = layoutLabels([pill("a", 175, 160, 2), pill("b", 175, 160, 1)], { left: 0, top: 0, right: 350, bottom: 300 });
    expect(placements.some((placement) => placement.leader !== null)).toBe(true);
  });
});
