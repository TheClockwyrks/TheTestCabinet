// The faces a headless 2D frame is drawn in: generic families resolve to the
// host's faces and a glyph no named face carries falls through to one that does.

import { expect, it } from "vitest";
import { createRecordingCanvas } from "../src/engine/canvas";
import {
  createHostCanvas,
  fallbackFaces,
  hostFace,
  resolveFont,
} from "../src/engine/fonts";
import { setsOf } from "../src/draw-calls";

/** The family list of a resolved shorthand past its `prefix`, unquoted. */
function familiesOf(font: string, prefix: string): string[] {
  expect(font.startsWith(prefix)).toBe(true);
  return font
    .slice(prefix.length)
    .split(",")
    .map((name) => name.trim().replace(/^"|"$/g, ""));
}

const mono = hostFace("mono");
const sans = hostFace("sans");
const serif = hostFace("serif");

it("keeps the shorthand's prefix and puts the host's face where a generic family stood", () => {
  const resolved = resolveFont("italic 700 21px/1.4 ui-monospace, monospace");
  const [first] = familiesOf(resolved, "italic 700 21px/1.4 ");
  expect(first).toBe(mono ?? "ui-monospace");
});

it("leaves the families a build named first, in its order, and appends the fallback tail", () => {
  const resolved = resolveFont('12px "Press Start 2P", Lato, sans-serif');
  const families = familiesOf(resolved, "12px ");
  expect(families.slice(0, 2)).toEqual(["Press Start 2P", "Lato"]);
  expect(families[2]).toBe(sans ?? "sans-serif");
  for (const face of fallbackFaces()) expect(families).toContain(face);
  // No face twice, whichever list it came from.
  expect(new Set(families.map((f) => f.toLowerCase())).size).toBe(
    families.length,
  );
});

it("maps every generic family to a role of the host's", () => {
  expect(familiesOf(resolveFont("10px serif"), "10px ")[0]).toBe(
    serif ?? "serif",
  );
  expect(familiesOf(resolveFont("10px system-ui"), "10px ")[0]).toBe(
    sans ?? "system-ui",
  );
  expect(familiesOf(resolveFont("10px cursive"), "10px ")[0]).toBe(
    sans ?? "cursive",
  );
});

it("returns a string with no font-size token as it is", () => {
  expect(resolveFont("monospace")).toBe("monospace");
  expect(resolveFont("bold")).toBe("bold");
});

it("reports the font a build set, resolves what the context draws with, and records the build's own string", () => {
  const surface = createRecordingCanvas({
    cssWidth: 40,
    cssHeight: 20,
    dpr: 1,
  });
  const ctx = surface.element.getContext("2d") as CanvasRenderingContext2D;
  ctx.font = "700 21px ui-monospace, monospace";
  expect(ctx.font).toBe("700 21px ui-monospace, monospace");
  expect(setsOf(surface.calls, "font")).toEqual([
    "700 21px ui-monospace, monospace",
  ]);
  // The raw context under the recorder answers the same.
  expect(surface.ctx.font).toBe("700 21px ui-monospace, monospace");
  // A save/restore round trip hands the build's string back too.
  ctx.save();
  ctx.font = "12px serif";
  ctx.restore();
  expect(ctx.font).toBe("700 21px ui-monospace, monospace");
});

it("ignores an invalid font string and leaves the font in force, as a page does", () => {
  const surface = createRecordingCanvas({
    cssWidth: 40,
    cssHeight: 20,
    dpr: 1,
  });
  const ctx = surface.element.getContext("2d") as CanvasRenderingContext2D;
  ctx.font = "16px sans-serif";
  expect(() => {
    ctx.font = "not a font";
  }).not.toThrow();
  expect(ctx.font).toBe("16px sans-serif");
});

it("starts a context under the page's default font, resolved", () => {
  const surface = createRecordingCanvas({
    cssWidth: 40,
    cssHeight: 20,
    dpr: 1,
  });
  expect(surface.ctx.font).toBe("10px sans-serif");
});

/** The pixels of a 60 x 30 patch after `text` is drawn in `font`, as one string. */
function rasterOf(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  text: string,
  font: string,
): string {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 60, 30);
  ctx.fillStyle = "#fff";
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, 15);
  return Buffer.from(ctx.getImageData(0, 0, 60, 30).data).toString("base64");
}

it.skipIf(sans === undefined)(
  "draws a symbol glyph under a generic family as its own glyph, not the missing-glyph box",
  () => {
    const { ctx } = createRecordingCanvas({
      cssWidth: 60,
      cssHeight: 30,
      dpr: 1,
    });
    const font = "700 21px ui-monospace, monospace";
    const filled = rasterOf(ctx, "◆", font);
    const open = rasterOf(ctx, "◇", font);
    const missing = rasterOf(ctx, "￿", font);
    expect(filled).not.toBe(open);
    expect(filled).not.toBe(missing);
    expect(open).not.toBe(missing);
  },
);

it("hands a build's off-screen canvas a context that resolves the same way", () => {
  const scratch = createHostCanvas(8, 8);
  const ctx = scratch.getContext("2d");
  ctx.font = "14px monospace";
  expect(ctx.font).toBe("14px monospace");
  // A second getContext is the same context, installed once.
  expect(scratch.getContext("2d")).toBe(ctx);
});
