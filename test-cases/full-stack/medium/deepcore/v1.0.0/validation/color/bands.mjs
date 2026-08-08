// Automated validation for color.bands.
//
// The four band rocks each render in a distinct, visible color, so the band a player is in reads from
// the world. We sample a plain rock tile in each band (from the pixels the build actually paints) and
// confirm the four colors span a visible range, none are identical, and each stands apart from the
// dark tunnel behind the miner.

import {
  standAt,
  newRun,
  solid,
  sampleTile,
  settleTiles,
  colorDistance,
  SPAWN_COL,
  TOPSOIL_ROW,
  ROCKBED_ROW,
  DEEPSTONE_ROW,
  CORESHELL_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const rows = [TOPSOIL_ROW, ROCKBED_ROW, DEEPSTONE_ROW, CORESHELL_ROW];
  const colors = [];
  const bgs = [];

  return {
    id: "color.bands",

    async arrange(api) {
      await newRun(api);
    },

    // Sampling reads what the build actually PAINTED, so the whole tour of the four bands runs
    // here: the validate pass advances time instantly and never produces a frame of its own, and
    // settling is the one real pause that lets the canvas repaint. That tour is also the clip, and
    // it is a CLIP rather than a still precisely because the item is about four colors: a single
    // frame can only ever show the band the camera happens to be in (the four are 125 rows apart,
    // so no one framing holds them all), which leaves a reviewer looking at one rock and a verdict
    // about four. The clip visits each band in turn, so what the numbers claim is what is on screen.
    //
    // The settle POLLS until the band has actually been painted rather than pausing a fixed guess.
    // A guess that comes up short on a loaded host reads the PREVIOUS band's frame — or the
    // surface, before the first teleport lands — and two bands sampled from the same stale frame
    // return the same color, which is reported as "no two bands render the same color: 0" against
    // a build whose four bands are plainly different.
    async act(api) {
      for (const row of rows) {
        // Stood on a floor rather than dropped into open space, so the miner holds still through
        // the dwell below instead of falling out of the band the clip is meant to be showing.
        await standAt(api, col, row);
        await solid(api, col + 2, row); // a guaranteed plain rock tile to sample
        await settleTiles(api, [
          [col + 2, row],
          [col, row],
        ]);
        colors.push(await sampleTile(api, col + 2, row));
        // The carved tunnel the miner stands in, read in EVERY band: the assertion below is that
        // each band's rock stands apart from the dark tunnel cut through THAT band, so comparing
        // the deep bands against the topsoil tunnel would be answering a different question.
        bgs.push(await sampleTile(api, col, row));
        // Hold on this band before moving to the next. Settling only waits as long as the repaint
        // needs — a few frames — so without a dwell the record pass flicks through the first three
        // bands inside a second and rests on the fourth, which is the same "one band on screen for
        // a verdict about four" problem a still had. `advance` is instant in the validate pass, so
        // the dwell costs the check nothing and buys the clip the thing it exists to show.
        // 45 ticks = 0.75 s.
        await api.advance(45);
      }
    },

    async assert(api, check) {
      let maxPair = 0;
      let minPair = Infinity;
      for (let i = 0; i < colors.length; i += 1) {
        check.expectGt(
          `band ${i} stands apart from the dark tunnel`,
          colorDistance(colors[i], bgs[i]),
          25,
        );
        for (let j = i + 1; j < colors.length; j += 1) {
          const d = colorDistance(colors[i], colors[j]);
          if (d > maxPair) maxPair = d;
          if (d < minPair) minPair = d;
        }
      }
      check.expectGt("the four band colors span a visible range", maxPair, 30);
      check.expectGt("no two bands render the same color", minPair, 12);
    },
  };
}
