import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function block(selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(CSS);
  if (!m) throw new Error(`no ${selector} block in globals.css`);
  return m[1];
}
function hues(scope: string): [string, number, number, number][] {
  const out: [string, number, number, number][] = [];
  for (const m of scope.matchAll(/--(sub-[1-8]):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out.push([m[1], Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100]);
  }
  return out;
}
function inkMix(scope: string): number {
  const m = /--sub-ink-mix:\s*([\d.]+)%/.exec(scope);
  if (!m) throw new Error("--sub-ink-mix is not declared");
  return Number(m[1]) / 100;
}

// Derived from --card. Asserted below so a change to --card fails here rather
// than silently invalidating every ratio in this file.
const CARD_LIGHT: RGB = [255, 255, 255];
const CARD_DARK: RGB = [12, 22, 38];

type RGB = [number, number, number];

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t: RGB =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
}
const toLinear = (v: number) => {
  const n = v / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
};
const fromLinear = (lin: number) => {
  const enc = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, enc * 255));
};
const luminance = (c: RGB) =>
  0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const composite = (fg: RGB, bg: RGB, a: number): RGB =>
  [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as RGB;

/**
 * color-mix(in oklab, C, black P%) scales oklab L, a and b by (1 - P). Each of
 * l, m, s is a cube of a linear combination of those, so all three scale by
 * (1 - P)^3 - and linear RGB, being a linear combination of l, m, s, scales by
 * (1 - P)^3 too. So the mix is exactly a scale in linear light.
 */
const mixTowardBlack = (c: RGB, p: number): RGB =>
  c.map((v) => fromLinear(toLinear(v) * Math.pow(1 - p, 3))) as RGB;

const FILL_ALPHA = 0.16; // must match blockColors' bg in TimetableGrid.tsx

describe("subject block ink meets WCAG AA on its own fill", () => {
  it("globals.css still declares the --card values these ratios assume", () => {
    expect(block(":root")).toContain("--card: oklch(1.0000 0.0000 89.88)");
    expect(block("\\.dark")).toContain("--card: oklch(0.2000 0.0350 259.00)");
  });

  for (const [scope, card] of [[":root", CARD_LIGHT], ["\\.dark", CARD_DARK]] as const) {
    const theme = scope === ":root" ? "light" : "dark";
    it(`every hue reaches 4.5:1 in ${theme}`, () => {
      const scoped = block(scope);
      const list = hues(scoped);
      expect(list).toHaveLength(8);
      const p = inkMix(scoped);
      for (const [name, h, s, l] of list) {
        const hue = hslToRgb(h, s, l);
        const ratio = contrast(mixTowardBlack(hue, p), composite(hue, card, FILL_ALPHA));
        expect(ratio, `${name} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("would fail without the mix, which is why it exists", () => {
    const [, h, s, l] = hues(block(":root")).find(([n]) => n === "sub-8")!;
    const hue = hslToRgb(h, s, l);
    expect(contrast(hue, composite(hue, CARD_LIGHT, FILL_ALPHA))).toBeLessThan(4.5);
  });
});
