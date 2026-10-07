// Refract — the campaign's twenty-four boards.
//
// `specs/campaign-boards.md` is authoritative for every layout below, and each
// is transcribed EXACTLY as written there, in the notation `specs/board.md`
// defines and `src/board.ts` parses: one string per row, one character per
// cell. Do not edit a board; a changed character is a different puzzle.
//
// The boards fall into four sets of six — A through D, in play order — which
// the select screen shows and labels. A set is a grouping alone: the unlock
// rule in `src/flow.ts` is the only thing that governs what a player can
// enter.

/* cspell:disable */

import { CAMPAIGN_LENGTH } from "./constants";
import { parseBoard } from "./board";
import type { BoardState } from "./game";

/** Every board, in play order, boards `1`–`24` at indices `0`–`23`. */
export const CAMPAIGN_BOARDS: readonly (readonly string[])[] = [
  // ---- Set A: boards 1 to 6 — one channel, no crystals -------------------
  [".Tt", "ttT", ".tt"],
  [".tt", "TtT", "tt."],
  ["tTtt", "ttTt", "ttt."],
  ["Tt.t", "tTtt", ".ttt"],
  [".tTt", ".ttt", "ttTt", "tttt"],
  ["tttT", "ttt.", "t.tt", "ttTt"],
  // ---- Set B: boards 7 to 12 — a second channel, first crystals ----------
  ["STtt", "sstt", "ssTt", "Sss."],
  ["Sst..", "stTtt", "ssttt", "SsstT"],
  ["tSss", "2tss", "Ttss", "tTS."],
  ["Tt.T.", "ttt..", "t2sSs", "tSsss"],
  ["..t.s", "ttT2s", "ttS2S", "t.Tss"],
  ["Tttt.", "ttsSt", ".22t.", "ssST."],
  // ---- Set C: boards 13 to 18 — a third channel, crystals multiply -------
  [".Ddd", "tTdD", "t22.", "tsSs", "T.S."],
  ["..tT.", "t2dD.", "T2t.s", "d2sss", "DSssS"],
  [".T.2t", "sDttt", "sS2Td", "ss22D", ".S.d."],
  ["..ttt", ".S2tt", "DsTsT", "d22d.", "SddD."],
  ["...ttd", "S2Ttdd", "t32Ddd", "Tss2d.", "sS.dD."],
  ["T.....", "ttDsss", "dd3222", ".dt3Ss", "DddTSs"],
  // ---- Set D: boards 19 to 24 — the summit: dense, contested boards ------
  [".Dttt", ".dd3t", ".d2TT", "S2s2D", ".sSss"],
  [".S.tT.", "s2ttDd", "s2T2.d", "s22d3.", "ssSddD"],
  ["S2D..T", "d2ssts", ".D3S3s", ".dT32t", ".d2tt."],
  [".tt2d.", ".t2t2d", "t1DdSd", "2.S3dD", "TT2sd.", ".ssss."],
  ["s2SST..", "2232.t.", "stTsttt", "..t.t.t", "d22ttdD", "dD2dddd"],
  ["ssdd.d.", "2S.dd2d", "ssD..d.", "t2ttTdd", ".t323Dd", "ttT2sS."],
];

/** The four sets the select screen labels, in row order. */
export const CAMPAIGN_SETS = ["A", "B", "C", "D"] as const;

/**
 * The parsed board at a campaign index (`0`–`23`). Parsed on entry rather than
 * held parsed, so the notation above stays the single written form of every
 * board.
 */
export function campaignBoard(index: number): BoardState {
  if (!Number.isInteger(index) || index < 0 || index >= CAMPAIGN_LENGTH) {
    throw new RangeError(
      `Refract: campaign board index ${index} is outside 0..${
        CAMPAIGN_LENGTH - 1
      }`,
    );
  }
  return parseBoard(CAMPAIGN_BOARDS[index]);
}
