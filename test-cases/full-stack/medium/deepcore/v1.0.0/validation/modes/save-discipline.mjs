// Automated validation for modes.save-discipline.
//
// Saving is explicit and restricted (`specs/gameplay.md`): "the surface Save Pad building is the
// only way to save; there is no autosave and no saving underground", and "Starting a NEW
// EXPEDITION abandons any existing save". Both halves are about the same observable fact — after an
// expedition begins, there is no save until the player writes one at the pad — so both are read
// here off `hasSave` across a start, a pad save, and a restart.
//
// Why this is its own item. A build that quietly writes a save when an expedition starts breaks no
// assertion that names it, because nothing named it: `core-run.save-blocked` reads `hasSave` to
// decide whether a save attempt was refused, and a save that was already sitting there makes a
// perfectly correct refusal look like a save that went through. The refusal logic gets blamed for
// the autosave. That is the failure this item exists to name, so the diagnosis lands on the rule
// that was actually broken.

export default function item() {
  let atTitle;
  let afterStart;
  let afterPadSave;
  let afterRestart;

  return {
    id: "modes.save-discipline",

    // A clean title with nothing saved. `reset` is posing (it is how the title is reached) and
    // consumes no time, so it belongs here.
    async arrange(api) {
      await api.reset({ seed: 1 });
      atTitle = (await api.snapshot()).hasSave;
    },

    // Start, save at the pad, start again. Each step is an instant control op, so each gets a beat:
    // the clip is the save indicator appearing when — and only when — the pad is used.
    async act(api) {
      await api.call("startExpedition", "standard", "standard");
      await api.advance(60); // 60 ticks = 1 s of the fresh expedition, nothing saved
      afterStart = (await api.snapshot()).hasSave;

      await api.call("save"); // the Save Pad write, on the surface with no Sample live
      await api.advance(75); // 75 ticks = 1.25 s for whatever the build shows on a save
      afterPadSave = (await api.snapshot()).hasSave;

      await api.call("startExpedition", "standard", "standard"); // a NEW expedition
      await api.advance(90); // 90 ticks = 1.5 s on the fresh run the old save was abandoned for
      afterRestart = (await api.snapshot()).hasSave;
    },

    async assert(api, check) {
      check.expectEq("nothing is saved at a clean title", atTitle, false);
      // The no-autosave half: beginning an expedition writes nothing by itself.
      check.expectEq(
        "starting an expedition does not write a save — there is no autosave",
        afterStart,
        false,
      );
      // The control: the pad DOES save, so the reading above is the absence of an autosave rather
      // than a save path that never works at all.
      check.expectEq("saving at the pad writes the slot", afterPadSave, true);
      // The abandon half: with a save now present, a new expedition discards it.
      check.expectEq(
        "starting a new expedition abandons the existing save",
        afterRestart,
        false,
      );
    },
  };
}
