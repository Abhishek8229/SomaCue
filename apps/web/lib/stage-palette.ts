export type StagePalette = {
  bg: string;
  bg2: string;
  panel: string;
  well: string;
  ink: string;
  ink2: string;
  muted: string;
  rule: string;
  ruleStrong: string;
  accent: string;
  accentInk: string;
  bone: string;
  grid: string;
  gridStrong: string;
  shadow: string;
};

const TOKENS: Record<keyof StagePalette, string> = {
  bg: "--stage-bg",
  bg2: "--stage-bg-2",
  panel: "--stage-panel",
  well: "--stage-well",
  ink: "--stage-ink",
  ink2: "--stage-ink-2",
  muted: "--stage-muted",
  rule: "--stage-rule",
  ruleStrong: "--stage-rule-strong",
  accent: "--stage-accent",
  accentInk: "--stage-accent-ink",
  bone: "--stage-bone",
  grid: "--stage-grid",
  gridStrong: "--stage-grid-strong",
  shadow: "--stage-shadow",
};

/**
 * Three.js does not parse OKLCH. Resolve each stage token to an sRGB colour
 * through a 2D canvas so the colours stay defined once, in tokens.css.
 */
function resolveToken(token: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!raw) throw new Error(`Stage token ${token} is not defined`);

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("A 2D canvas is needed to resolve the stage palette");

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = raw;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  // Three.js parses the legacy comma syntax only; space-separated rgb() is
  // treated as an unknown colour and silently leaves materials white.
  return `rgb(${r}, ${g}, ${b})`;
}

export function readStagePalette(): StagePalette {
  const palette = {} as StagePalette;
  for (const key of Object.keys(TOKENS) as Array<keyof StagePalette>) {
    palette[key] = resolveToken(TOKENS[key]);
  }
  return palette;
}
