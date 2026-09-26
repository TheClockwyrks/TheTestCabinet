// Spectra — loading the seeded files, page-relative.

import { afterEach, describe, expect, it, vi } from "vitest";
import { BURST_SYSTEM, SPRITES } from "./constants";
import { assetUrl, loadParticleSystem } from "./images";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assetUrl", () => {
  it("resolves against the page rather than the origin root", () => {
    // With no document, the base is a bare origin, so the shape is visible: the
    // URL is relative and carries no leading slash of its own.
    expect(assetUrl(SPRITES.shard)).toBe("http://localhost/assets/shard.png");
    expect(assetUrl(BURST_SYSTEM).endsWith(`assets/${BURST_SYSTEM}`)).toBe(
      true,
    );
  });
});

describe("loadParticleSystem", () => {
  it("parses the system a fetch hands back", async () => {
    const system = { dimensions: 2, emitters: [] };
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => system,
    }));
    await expect(loadParticleSystem(BURST_SYSTEM)).resolves.toEqual(system);
  });

  it("degrades to none where the file is missing or the fetch fails", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => ({}) }));
    await expect(loadParticleSystem(BURST_SYSTEM)).resolves.toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await expect(loadParticleSystem(BURST_SYSTEM)).resolves.toBeNull();
  });
});
