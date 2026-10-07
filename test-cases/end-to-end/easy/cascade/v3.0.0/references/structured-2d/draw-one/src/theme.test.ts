// The palette this build chose, held to the legibility table in
// `specs/overview.md`.
//
// The specification fixes no palette, so what is checked here is not a color
// but a MARGIN: every pair a player has to tell apart is far enough apart in
// RGB to be told apart, and the margins are stated so a later change to the
// palette cannot quietly close one of them.

import { describe, expect, it } from "vitest";
import { COLOR, LAYER, font, rgbDistance, rgbOf, withAlpha } from "./theme";

describe("the palette", () => {
  it("tells the two suit colors apart", () => {
    expect(rgbDistance(COLOR.suitRed, COLOR.suitBlack)).toBeGreaterThan(90);
  });

  it("reads a card of either face apart from the table", () => {
    expect(rgbDistance(COLOR.cardFace, COLOR.felt)).toBeGreaterThan(90);
    expect(rgbDistance(COLOR.suitRed, COLOR.felt)).toBeGreaterThan(90);
    expect(rgbDistance(COLOR.suitBlack, COLOR.felt)).toBeGreaterThan(90);
    expect(rgbDistance(COLOR.cardBack, COLOR.felt)).toBeGreaterThan(60);
    expect(rgbDistance(COLOR.cardBackLattice, COLOR.felt)).toBeGreaterThan(60);
    expect(rgbDistance(COLOR.cardBackEmblem, COLOR.felt)).toBeGreaterThan(60);
  });

  it("reads a card back apart from a card face, wherever either is read", () => {
    for (const back of [
      COLOR.cardBack,
      COLOR.cardBackLattice,
      COLOR.cardBackEmblem,
    ]) {
      for (const face of [COLOR.cardFace, COLOR.suitRed, COLOR.suitBlack]) {
        expect(rgbDistance(back, face), `${back} ${face}`).toBeGreaterThan(90);
      }
    }
  });

  it("reads an empty slot apart from the bare table", () => {
    expect(rgbDistance(COLOR.slot, COLOR.felt)).toBeGreaterThan(30);
    expect(rgbDistance(COLOR.slotEdge, COLOR.felt)).toBeGreaterThan(30);
  });

  it("reads the drop highlight apart from everything it rings", () => {
    for (const under of [
      COLOR.felt,
      COLOR.slot,
      COLOR.cardFace,
      COLOR.cardBack,
    ]) {
      expect(rgbDistance(COLOR.highlight, under), under).toBeGreaterThan(60);
    }
  });

  it("reads every piece of text against what it sits on", () => {
    for (const behind of [COLOR.hud, COLOR.panel]) {
      expect(rgbDistance(COLOR.text, behind), behind).toBeGreaterThan(60);
      expect(rgbDistance(COLOR.dim, behind), behind).toBeGreaterThan(60);
      expect(rgbDistance(COLOR.highlight, behind), behind).toBeGreaterThan(60);
    }
  });
});

describe("the layer table", () => {
  it("puts the painted trail under the piles and the flyers over them", () => {
    expect(LAYER.felt).toBeLessThan(LAYER.trail);
    expect(LAYER.trail).toBeLessThan(LAYER.piles);
    expect(LAYER.piles).toBeLessThan(LAYER.drag);
    expect(LAYER.drag).toBeLessThan(LAYER.highlight);
    expect(LAYER.highlight).toBeLessThan(LAYER.flyers);
    expect(LAYER.flyers).toBeLessThan(LAYER.hud);
    expect(LAYER.hud).toBeLessThan(LAYER.screens);
  });
});

describe("the helpers", () => {
  it("builds a font string, an alpha and an rgb triple", () => {
    expect(font(24)).toContain("24px");
    expect(font(24, 800).startsWith("800 ")).toBe(true);
    expect(withAlpha("#112233", 1)).toBe("#112233ff");
    expect(withAlpha("#112233", 0)).toBe("#11223300");
    expect(withAlpha("#112233", 2)).toBe("#112233ff");
    expect(rgbOf("#0a141e")).toEqual([10, 20, 30]);
    expect(rgbDistance("#000000", "#000000")).toBe(0);
  });
});
