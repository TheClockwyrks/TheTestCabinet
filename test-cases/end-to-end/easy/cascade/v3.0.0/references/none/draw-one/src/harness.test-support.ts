// Cascade — shared scaffolding for this build's own tests.
//
// Not part of the game: nothing under `src/` imports it but a `*.test.ts`, so
// it never reaches the bundle. It exists so every test poses a table the same
// way and none of them re-derives what a "board with an Ace showing" means.
//
// The tests run in Node with no DOM, so the painted layer comes from
// `@napi-rs/canvas` rather than from the platform, which is exactly the seam
// `src/trail.ts` leaves open for it.

import { createCanvas } from "@napi-rs/canvas";
import type { AudioPort } from "./audio-bus";
import { makeCard } from "./board";
import { STAGE_H, STAGE_W } from "./constants";
import { createState, type CascadeState } from "./state";
import type { TrailSurface } from "./trail";
import type { Card, PileName, Suit } from "./types";

/** A stage-sized surface backed by a real 2D context, with no browser. */
export function nodeTrail(width: number, height: number): TrailSurface {
  const canvas = createCanvas(width, height);
  return {
    image: canvas as unknown as CanvasImageSource,
    ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
    width,
    height,
  };
}

/** A 2D context of the stage's own size, for a test that reads pixels. */
export function stageContext(): {
  ctx: CanvasRenderingContext2D;
  pixel(x: number, y: number): [number, number, number];
} {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    pixel(x, y) {
      const data = ctx.getImageData(x, y, 1, 1).data;
      return [data[0], data[1], data[2]];
    },
  };
}

/** An audio port that records what it was asked to play. */
export class RecordingAudio implements AudioPort {
  readonly played: string[] = [];
  private mutedFlag = false;

  play(cue: string): void {
    this.played.push(cue);
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
  }

  muted(): boolean {
    return this.mutedFlag;
  }
}

/** A fresh state with a real painted layer behind it. */
export function testState(): CascadeState {
  return createState({ trail: nodeTrail });
}

/** Add one card to the top of a pile and hand it back. */
export function put(
  state: CascadeState,
  pile: PileName,
  index: number,
  suit: Suit,
  rank: number,
  faceUp = true,
): Card {
  const card = makeCard(state, suit, rank, faceUp);
  const target = pileFor(state, pile, index);
  target.push(card);
  return card;
}

function pileFor(state: CascadeState, pile: PileName, index: number): Card[] {
  switch (pile) {
    case "stock":
      return state.stock;
    case "waste":
      return state.waste;
    case "foundation":
      return state.foundations[index];
    case "tableau":
      return state.tableau[index];
  }
}

/** The stage's own dimensions, so a test never restates them. */
export const STAGE = { w: STAGE_W, h: STAGE_H } as const;
