// Deepcore — what a frame tells the player, beyond the state itself.
//
// A rule that fires does four kinds of thing besides changing the world: it
// leaves a short line on screen, it flinches the miner, it shakes the view, and
// it raises the one-time card explaining a hazard the player has just met. All
// four are written to the frame's draft here, so a rule says `note(d, "...")`
// rather than reaching into the state's shape, and every one of them is bounded
// — four notes at a time, one card at a time, and a shake that takes the
// stronger of what is already running.

import { HURT_TIME, NOTICE_DELAY } from "./constants";
import type { NoticeHazard } from "./constants";
import type { FxEvent, FxKind } from "./effects";
import type { Draft } from "./state";

/** Seconds a note stays on screen. */
export const NOTE_LIFE = 2.4;

/** The most notes shown at once; the newest is on top. */
const MAX_NOTES = 4;

/** Leave a short line of feedback on screen. */
export function note(d: Draft, text: string): void {
  d.notes.unshift({ text, t: NOTE_LIFE });
  if (d.notes.length > MAX_NOTES) d.notes.length = MAX_NOTES;
}

/** Arm the hurt animation state, which holds for `HURT_TIME` from the blow. */
export function hurt(d: Draft): void {
  d.hurtT = HURT_TIME;
}

/** Kick a render-only screen shake, taking the stronger of any already running. */
export function addShake(d: Draft, amp: number, time: number): void {
  d.shakeAmp = Math.max(d.shakeAmp, amp);
  d.shakeT = Math.max(d.shakeT, time);
}

/**
 * Raise the one-time notice for a hazard, at most once per expedition. The card
 * waits out `NOTICE_DELAY` so the blow lands before the explanation appears.
 */
export function raiseNotice(d: Draft, hazard: NoticeHazard): void {
  if (d.noticesFired[hazard] || d.notice) return;
  d.noticesFired[hazard] = true;
  d.notice = { hazard, shown: false, t: NOTICE_DELAY };
}

/** Dismiss the notice card on screen. */
export function dismissNotice(d: Draft): void {
  d.notice = null;
}

/** Ask for an effect burst at a world position. */
export function fx(
  d: Draft,
  kind: FxKind,
  x: number,
  y: number,
  scale?: number,
): void {
  const event: FxEvent = { kind, x, y, scale };
  d.fx.push(event);
}
