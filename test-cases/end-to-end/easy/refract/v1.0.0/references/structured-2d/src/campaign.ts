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
  [".t.", ".tT", "T.."],
  [".T.", "t.T", "tt."],
  ["tT..", "t.tT", ".t.."],
  [".t..", "t.tT", ".tTt"],
  ["..t.", ".tt.", ".tTt", "T..t"],
  [".t.T", "t.t.", "tt..", "tTt."],
  // ---- Set B: boards 7 to 12 — a second channel, first crystals ----------
  ["...S", "tTs.", "t.Ss", ".tTs"],
  ["..t..", "tt.t.", "TS.Ts", "..ssS"],
  ["T...", "t.T.", ".t1t", "...t"],
  ["Tt...", "Sstt.", "..2.T", ".Ss.."],
  [".Tt2S", "ttst.", "Ss.T.", "s...."],
  [".Tttt", "s2St.", ".st..", "..sT.", "..S.."],
  // ---- Set C: boards 13 to 18 — wider, a third channel, more crystals ----
  [".sS..", "2S.T.", "ss..t", ".tttt", "..T.t"],
  ["..tt2t", ".tTt.t", "Ts....", ".2S...", "sssS.."],
  ["Sssdd", "s.2Sd", ".t.DD", "Tt...", "tttT."],
  ["..dd..", ".T.Dd.", "ttT2dS", "2.sDs.", "tt.ssS"],
  ["..Tss.", ".ts..S", "t.t2s.", "2t.Ts.", "tt..sS"],
  ["t2Tt.D", ".tttd.", "..Tdd2", ".SsdsS", "...sDs", "....s."],
  // ---- Set D: boards 19 to 24 — the largest boards, crowded crystals -----
  ["ssddd.", "s2Sd.d", ".2..Dd", "..SttD", ".T.tt.", ".tttTt"],
  [".D2dt.t", "Sd2DTtt", "2s..Tt.", "s2...tt", ".Ss...t"],
  ["....Tss", "t..t.sS", "22t.s..", "t3t..ss", "Tt...S2", ".....ss"],
  ["Ss..Dd.", "ss.DdTt", "s2s2..t", "..s2d.t", ".S.Tdt2", "....t2t"],
  ["Tss.S..", "ts.s.Dd", "t.ss.dS", ".t.322T", "tD2d2.t", "tt.d..."],
  ["S2ss.S.", "Ts2.s.d", "ssD2ddd", "ssTt.d2", "tt.tDd.", "t2t...."],
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
