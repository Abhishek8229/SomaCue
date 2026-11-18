/*
 * Places the floating joint-angle pills in screen space.
 *
 * Each pill is tried at several spots around its joint (above first, then to
 * the sides, then below, near then further out). A spot is rejected if it
 * overlaps a pill already placed or leaves the stage; among the rest the one
 * that covers the fewest body points and sits closest wins. A pill keeps its
 * spot from the last frame while that spot stays good, so pills do not jump.
 * A pill that cannot be placed without overlapping is hidden; its value is
 * still in the stage readout.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type LayoutBounds = { left: number; top: number; right: number; bottom: number };

export type LabelRequest = {
  key: string;
  width: number;
  height: number;
  /** screen point the pill belongs to */
  anchor: Point;
  /** higher is placed first */
  priority: number;
};

export type LabelPlacement = {
  key: string;
  visible: boolean;
  x: number;
  y: number;
  slot: number;
  /** from the joint to the nearest edge of the pill, when they are apart */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
};

export const LABEL_GAP = 4;

const DIRECTIONS: Array<[number, number, number]> = [
  // dx, dy, cost
  [0, -1, 0],
  [0.8, -0.6, 1],
  [-0.8, -0.6, 1],
  [1, 0, 2],
  [-1, 0, 2],
  [0.8, 0.6, 4],
  [-0.8, 0.6, 4],
  [0, 1, 5],
];
const DISTANCES = [12, 30, 56];

export function rectsOverlap(a: Rect, b: Rect, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

function contains(rect: Rect, point: Point, pad = 0) {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  );
}

function clampInto(rect: Rect, bounds: LayoutBounds): Rect | null {
  if (rect.width > bounds.right - bounds.left || rect.height > bounds.bottom - bounds.top) return null;
  return {
    ...rect,
    x: Math.min(bounds.right - rect.width, Math.max(bounds.left, rect.x)),
    y: Math.min(bounds.bottom - rect.height, Math.max(bounds.top, rect.y)),
  };
}

function leaderFor(anchor: Point, rect: Rect) {
  const x = Math.min(rect.x + rect.width, Math.max(rect.x, anchor.x));
  const y = Math.min(rect.y + rect.height, Math.max(rect.y, anchor.y));
  return Math.hypot(x - anchor.x, y - anchor.y) > 6 ? { x1: anchor.x, y1: anchor.y, x2: x, y2: y } : null;
}

export function layoutLabels(
  requests: LabelRequest[],
  bounds: LayoutBounds,
  obstacles: Point[] = [],
  previous: ReadonlyMap<string, number> = new Map(),
): LabelPlacement[] {
  const placed: Rect[] = [];
  const out = new Map<string, LabelPlacement>();
  const order = [...requests].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));

  for (const request of order) {
    const { width, height, anchor } = request;
    let best: { rect: Rect; slot: number; score: number } | null = null;
    let slot = 0;
    for (const distance of DISTANCES) {
      for (const [dx, dy, cost] of DIRECTIONS) {
        const index = slot;
        slot += 1;
        const reach = distance + Math.abs(dx) * (width / 2) + Math.abs(dy) * (height / 2);
        const wanted = { x: anchor.x + dx * reach - width / 2, y: anchor.y + dy * reach - height / 2, width, height };
        const rect = clampInto(wanted, bounds);
        if (!rect || placed.some((other) => rectsOverlap(other, rect, LABEL_GAP))) continue;
        let covered = 0;
        for (const point of obstacles) if (contains(rect, point, 2)) covered += 1;
        const shift = Math.hypot(rect.x - wanted.x, rect.y - wanted.y);
        let score = distance * 0.25 + cost * 2 + covered * 9 + shift * 0.5 + (contains(rect, anchor, 3) ? 30 : 0);
        if (previous.get(request.key) === index) score -= 10;
        if (!best || score < best.score) best = { rect, slot: index, score };
      }
    }

    // Crowded: stack along the stage edges, nearest free row first.
    if (!best) {
      const rows: Rect[] = [];
      for (let y = bounds.top; y + height <= bounds.bottom; y += height + LABEL_GAP) {
        rows.push({ x: bounds.left, y, width, height }, { x: bounds.right - width, y, width, height });
      }
      const free = rows
        .filter((rect) => rect.x >= bounds.left && !placed.some((other) => rectsOverlap(other, rect, LABEL_GAP)))
        .sort(
          (a, b) =>
            Math.hypot(a.x + width / 2 - anchor.x, a.y + height / 2 - anchor.y) -
            Math.hypot(b.x + width / 2 - anchor.x, b.y + height / 2 - anchor.y),
        );
      if (free[0]) best = { rect: free[0], slot: -1, score: 0 };
    }

    if (!best) {
      out.set(request.key, { key: request.key, visible: false, x: 0, y: 0, slot: -1, leader: null });
      continue;
    }
    placed.push(best.rect);
    out.set(request.key, {
      key: request.key,
      visible: true,
      x: best.rect.x,
      y: best.rect.y,
      slot: best.slot,
      leader: leaderFor(anchor, best.rect),
    });
  }

  return requests.map((request) => out.get(request.key) as LabelPlacement);
}
