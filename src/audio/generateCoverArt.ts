import type { WavArtwork } from "./exportWav";

export type GeneratedCoverInput = {
  title: string;
  artist: string;
  bpm: number;
  hue?: number;
};

export type GeneratedCoverTheme = {
  background: string;
  accent: string;
};

const COVER_SIZE = 1000;

export function createGeneratedCoverTheme(
  input: GeneratedCoverInput,
): GeneratedCoverTheme {
  const hue = resolveHue(input);
  const secondHue = (hue + 54) % 360;

  return {
    background: `linear-gradient(145deg, hsl(${hue} 62% 18%), hsl(${secondHue} 72% 8%))`,
    accent: `hsl(${hue} 92% 68%)`,
  };
}

export async function generateCoverArtwork(
  input: GeneratedCoverInput,
): Promise<WavArtwork> {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_SIZE;
  canvas.height = COVER_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is unavailable.");
  }

  drawCover(context, input);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Unable to generate cover artwork."));
      }
    }, "image/png");
  });

  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    mimeType: "image/png",
  };
}

function drawCover(
  context: CanvasRenderingContext2D,
  input: GeneratedCoverInput,
): void {
  const hue = resolveHue(input);
  const secondHue = (hue + 54) % 360;
  const background = context.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
  background.addColorStop(0, `hsl(${hue} 62% 18%)`);
  background.addColorStop(1, `hsl(${secondHue} 72% 8%)`);
  context.fillStyle = background;
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);

  const glow = context.createRadialGradient(790, 160, 20, 790, 160, 520);
  glow.addColorStop(0, `hsl(${hue} 92% 68% / 0.46)`);
  glow.addColorStop(1, `hsl(${hue} 92% 68% / 0)`);
  context.fillStyle = glow;
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);

  context.strokeStyle = "rgb(255 255 255 / 0.12)";
  context.lineWidth = 2;
  context.strokeRect(54, 54, COVER_SIZE - 108, COVER_SIZE - 108);

  context.fillStyle = `hsl(${hue} 92% 72%)`;
  context.font = '700 25px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.letterSpacing = "5px";
  context.fillText("RUN TEMPO · GENERATED COVER", 92, 120);
  context.letterSpacing = "0px";

  const title = input.title.trim() || "Untitled";
  const titleLayout = fitText(context, title, 816, 3, 104, 58);
  context.fillStyle = "#ffffff";
  context.font = `750 ${titleLayout.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif`;
  context.textBaseline = "top";
  titleLayout.lines.forEach((line, index) => {
    context.fillText(line, 92, 225 + index * titleLayout.fontSize * 1.12);
  });

  const artist = input.artist.trim();

  if (artist) {
    context.fillStyle = `hsl(${hue} 92% 68%)`;
    context.fillRect(92, 700, 86, 7);

    context.fillStyle = "rgb(255 255 255 / 0.68)";
    context.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText("ARTIST", 92, 752);

    context.fillStyle = "#ffffff";
    context.font = '650 49px -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif';
    context.fillText(artist, 92, 794, 620);
  }

  const bpmText = `${formatBpm(input.bpm)} BPM`;
  context.font = '750 38px ui-monospace, "SFMono-Regular", Menlo, monospace';
  const bpmWidth = context.measureText(bpmText).width + 54;
  roundRect(context, COVER_SIZE - 92 - bpmWidth, 775, bpmWidth, 76, 38);
  context.fillStyle = "rgb(255 255 255 / 0.13)";
  context.fill();
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(bpmText, COVER_SIZE - 92 - bpmWidth / 2, 813);
  context.textAlign = "start";
}

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  initialFontSize: number,
  minimumFontSize: number,
): { lines: string[]; fontSize: number } {
  for (
    let fontSize = initialFontSize;
    fontSize >= minimumFontSize;
    fontSize -= 4
  ) {
    context.font = `750 ${fontSize}px sans-serif`;
    const lines = wrapText(context, text, maxWidth);

    if (lines.length <= maxLines) {
      return { lines, fontSize };
    }
  }

  context.font = `750 ${minimumFontSize}px sans-serif`;
  const lines = wrapText(context, text, maxWidth).slice(0, maxLines);
  const lastIndex = lines.length - 1;

  if (lastIndex >= 0) {
    lines[lastIndex] = ellipsize(context, lines[lastIndex], maxWidth);
  }

  return { lines, fontSize: minimumFontSize };
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const tokens = text.includes(" ")
    ? text.trim().split(/\s+/).map((token, index) => (index === 0 ? token : ` ${token}`))
    : Array.from(text);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = `${current}${token}`;

    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current.trim());
      current = token.trimStart();
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current.trim());
  }

  return lines;
}

function ellipsize(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  let result = value;

  while (result && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }

  return `${result.trimEnd()}…`;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function hashText(value: string): number {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function resolveHue(input: GeneratedCoverInput): number {
  if (typeof input.hue === "number" && Number.isFinite(input.hue)) {
    return ((Math.round(input.hue) % 360) + 360) % 360;
  }

  return hashText(`${input.title}\u0000${input.artist}`) % 360;
}

function formatBpm(value: number): string {
  return String(Math.round(value * 10) / 10);
}
