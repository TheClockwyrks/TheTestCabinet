// Automated validation for core-run.save-blocked.
//
// The Save Pad refuses to save while the unstable Core Sample's timer is running. We try to save
// while carrying a live Sample (must be refused), then — as a control — start fresh with no Sample
// and confirm a normal save succeeds.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let unsavedBefore;
  let blocked;
  let allowed;

  return {
    id: "core-run.save-blocked",

    // A live Core Sample in the satchel, on the surface, with no save banked yet. Only the
    // PRECONDITION is posed here — the refusal itself belongs in `act`.
    async arrange(api) {
      await newRun(api); // a fresh expedition: no save of its own (specs/gameplay.md)
      await api.call("spawnCoreSample");
      // Record whether a save exists BEFORE anything is attempted, and assert it below.
      //
      // The refusal is read as "no save was written", which only means that if there was no save to
      // begin with. `specs/gameplay.md` guarantees there is not — "there is no autosave", and
      // "Starting a NEW EXPEDITION abandons any existing save" — so this is a spec-backed
      // precondition rather than an assumption about the reference. But it was never CHECKED, and a
      // build that writes a save when an expedition starts breaks it: its Save Pad then refuses
      // exactly as it should, `hasSave` is true anyway, and this item fails saying the refusal did
      // not happen. The blame lands on the one part of that build which was correct. Reading it
      // here means such a build fails on the sentence that names what it actually did — and
      // `modes.save-discipline` fails alongside, which is the item that owns the rule.
      unsavedBefore = (await api.snapshot()).hasSave;
    },

    // The refused save is the behavior this item is named for, so it happens HERE, where it is
    // filmed. It used to sit in `arrange`, which runs in both passes but is never recorded, so the
    // only thing the clip ever showed was the control save at the end — being ACCEPTED. A reviewer
    // opening "Saving is refused while the Sample is live" watched a save succeed, which is the
    // opposite of the claim, and no assertion was wrong so nothing flagged it.
    async act(api) {
      await api.call("save");
      blocked = (await api.snapshot()).hasSave;
      // A beat with the Sample still live and the refusal on screen, so the clip rests on it
      // before moving on. 30 ticks = 0.5 s.
      await api.advance(30);

      // Control: with no Sample, a surface save succeeds — proving the save path itself works, so
      // the refusal above is the timer's doing and not a save that never worked at all.
      // `startExpedition` is a control op, so it re-poses the run without the reset the runtime
      // forbids here.
      await api.call("startExpedition", "standard", "standard"); // fresh expedition, no Sample, save cleared
      await api.call("save");
      allowed = (await api.snapshot()).hasSave;
      await api.advance(30);
    },

    async assert(api, check) {
      // A HARD assert: if a save was already sitting there, the reading below cannot mean what this
      // item needs it to mean, so stop rather than go on to report a refusal that was never
      // measured. A build that autosaves then fails here with one assertion naming the autosave,
      // instead of two, the louder of which would accuse it of a broken Save Pad it does not have.
      check.assertEq(
        "the fresh expedition starts with nothing saved",
        unsavedBefore,
        false,
      );
      check.expectEq(
        "saving is refused while a Sample is live",
        blocked,
        false,
      );
      check.expectEq("a normal surface save succeeds", allowed, true);
    },
  };
}
