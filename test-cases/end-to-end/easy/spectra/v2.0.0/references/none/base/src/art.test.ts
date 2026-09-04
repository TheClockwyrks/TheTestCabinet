import { beforeAll, describe, expect, it } from "vitest";

import {
  classify,
  deriveArt,
  opaqueCount,
  prismCore,
  prismFull,
  singleBand,
  type ArtRasters,
  type Raster,
} from "./art";
import { SPRITE_SIZE } from "./constants";
import {
  loadSeededRasters,
  rgbDistance,
  silhouette,
} from "./harness.test-support";
import { BAND_RGB } from "./theme";

let sources: Record<string, Raster>;
let derived: ArtRasters;

beforeAll(async () => {
  sources = await loadSeededRasters();
  derived = deriveArt({
    fighter: sources.fighter as Raster,
    shard: sources.shard as Raster,
    flux: sources.flux as Raster,
    prism: sources.prism as Raster,
  });
});

/** Every distinct opaque colour of a raster. */
function palette(raster: Raster): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < raster.data.length; i += 4) {
    if ((raster.data[i + 3] ?? 0) === 0) continue;
    out.add(`${raster.data[i]},${raster.data[i + 1]},${raster.data[i + 2]}`);
  }
  return out;
}

/** The mean opaque colour of a raster, as the field would read it. */
function meanColor(raster: Raster): [number, number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < raster.data.length; i += 4) {
    if ((raster.data[i + 3] ?? 0) === 0) continue;
    r += raster.data[i] ?? 0;
    g += raster.data[i + 1] ?? 0;
    b += raster.data[i + 2] ?? 0;
    n += 1;
  }
  return n === 0 ? [0, 0, 0, 0] : [r / n, g / n, b / n, 255];
}

describe("classifying a seeded pixel", () => {
  it("reads the two band colours the seeded art carries", () => {
    expect(classify(...BAND_RGB.cyan)).toBe("cyan");
    expect(classify(...BAND_RGB.magenta)).toBe("magenta");
  });

  it("leaves the hull, the thruster and the dark disc neutral", () => {
    expect(classify(234, 240, 251)).toBe("none"); // the fighter's hull
    expect(classify(255, 255, 255)).toBe("none"); // a highlight
    expect(classify(255, 216, 107)).toBe("none"); // the fighter's thruster
    expect(classify(11, 16, 32)).toBe("none"); // the Prism's disc
    expect(classify(0, 0, 0)).toBe("none");
  });
});

describe("the seeded sprites", () => {
  it("are four 64-square rasters in straight alpha", () => {
    for (const name of ["fighter", "shard", "flux", "prism"]) {
      const raster = sources[name] as Raster;
      expect([raster.width, raster.height]).toEqual([SPRITE_SIZE, SPRITE_SIZE]);
      // Only drawn pixels are opaque, so each composites over the dark field.
      expect(opaqueCount(raster)).toBeGreaterThan(500);
      expect(opaqueCount(raster)).toBeLessThan(SPRITE_SIZE * SPRITE_SIZE);
    }
  });

  it("carry the bands each is said to depict", () => {
    expect(palette(sources.fighter as Raster)).toContain(
      BAND_RGB.cyan.join(","),
    );
    expect(palette(sources.shard as Raster)).toContain(
      BAND_RGB.magenta.join(","),
    );
    const flux = palette(sources.flux as Raster);
    expect(flux).toContain(BAND_RGB.cyan.join(","));
    expect(flux).toContain(BAND_RGB.magenta.join(","));
    const prism = palette(sources.prism as Raster);
    expect(prism).toContain(BAND_RGB.cyan.join(","));
    expect(prism).toContain(BAND_RGB.magenta.join(","));
  });
});

describe("deriving the other band-state", () => {
  it("keeps the seeded silhouette, pixel for pixel", () => {
    const pairs: Array<[Raster, Raster]> = [
      [sources.fighter as Raster, derived.fighter.cyan],
      [sources.fighter as Raster, derived.fighter.magenta],
      [sources.shard as Raster, derived.shard.cyan],
      [sources.shard as Raster, derived.shard.magenta],
      [sources.flux as Raster, derived.fluxHeld.cyan],
      [sources.flux as Raster, derived.fluxHeld.magenta],
      [sources.prism as Raster, derived.prismFull.cyan],
      [sources.prism as Raster, derived.prismFull.magenta],
    ];
    for (const [source, band] of pairs) {
      expect(silhouette(band)).toEqual(silhouette(source));
    }
  });

  it("gives both band-states of one sprite the same silhouette", () => {
    expect(silhouette(derived.fighter.cyan)).toEqual(
      silhouette(derived.fighter.magenta),
    );
    expect(silhouette(derived.shard.cyan)).toEqual(
      silhouette(derived.shard.magenta),
    );
    expect(silhouette(derived.prismFull.cyan)).toEqual(
      silhouette(derived.prismFull.magenta),
    );
    expect(silhouette(derived.prismCore.cyan)).toEqual(
      silhouette(derived.prismCore.magenta),
    );
  });

  it("paints a band-carrying pixel in the band's own colour only", () => {
    const cyan = singleBand(sources.shard as Raster, "cyan");
    for (let i = 0; i < cyan.data.length; i += 4) {
      if ((cyan.data[i + 3] ?? 0) === 0) continue;
      const family = classify(
        cyan.data[i] ?? 0,
        cyan.data[i + 1] ?? 0,
        cyan.data[i + 2] ?? 0,
      );
      expect(family).not.toBe("magenta");
    }
  });

  it("reads the two band-states far enough apart to tell at a glance", () => {
    // The bands' own colours are far apart out of the 441 the cube spans.
    expect(
      rgbDistance([...BAND_RGB.cyan, 255], [...BAND_RGB.magenta, 255]),
    ).toBeGreaterThan(120);
    // And so are the two derived states of one silhouette.
    expect(
      rgbDistance(
        meanColor(derived.shard.cyan),
        meanColor(derived.shard.magenta),
      ),
    ).toBeGreaterThan(60);
  });

  it("uses the seeded Flux art, both bands at once, for the shimmer", () => {
    expect(derived.fluxShimmer).toBe(sources.flux);
    const shimmer = palette(derived.fluxShimmer);
    expect(shimmer).toContain(BAND_RGB.cyan.join(","));
    expect(shimmer).toContain(BAND_RGB.magenta.join(","));
    // And a held Flux carries one band alone, so the two states differ.
    const held = palette(derived.fluxHeld.cyan);
    expect(held).not.toContain(BAND_RGB.magenta.join(","));
  });
});

describe("the Prism's two layers", () => {
  it("keys the intact Prism by its shell's band and the core by the other", () => {
    const cyanShell = prismFull(sources.prism as Raster, "cyan");
    const magentaShell = prismFull(sources.prism as Raster, "magenta");
    // The seeded art is a cyan shell around a magenta core, so keying the shell
    // cyan leaves the art as it was.
    expect(palette(cyanShell)).toEqual(palette(sources.prism as Raster));
    expect(palette(magentaShell)).toEqual(palette(sources.prism as Raster));
    // The two differ pixel by pixel even though their palettes match.
    let differences = 0;
    for (let i = 0; i < cyanShell.data.length; i += 4) {
      if (cyanShell.data[i] !== magentaShell.data[i]) differences += 1;
    }
    expect(differences).toBeGreaterThan(500);
  });

  it("draws only the core once the shell is broken", () => {
    const core = prismCore(sources.prism as Raster, "magenta");
    const whole = prismFull(sources.prism as Raster, "cyan");
    expect(opaqueCount(core)).toBeGreaterThan(200);
    expect(opaqueCount(core)).toBeLessThan(opaqueCount(whole) * 0.6);
    // Every remaining pixel is inside the core's own radius.
    const centre = (SPRITE_SIZE - 1) / 2;
    for (let i = 0; i < core.data.length; i += 4) {
      if ((core.data[i + 3] ?? 0) === 0) continue;
      const px = (i / 4) % SPRITE_SIZE;
      const py = Math.floor(i / 4 / SPRITE_SIZE);
      expect(Math.hypot(px - centre, py - centre)).toBeLessThanOrEqual(18);
    }
  });

  it("carries no shell-band pixel once only the core is left", () => {
    const core = prismCore(sources.prism as Raster, "magenta");
    for (let i = 0; i < core.data.length; i += 4) {
      if ((core.data[i + 3] ?? 0) === 0) continue;
      expect(
        classify(
          core.data[i] ?? 0,
          core.data[i + 1] ?? 0,
          core.data[i + 2] ?? 0,
        ),
      ).not.toBe("cyan");
    }
  });
});
