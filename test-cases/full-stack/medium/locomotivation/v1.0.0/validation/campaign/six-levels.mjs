// Campaign: the six levels of specs/levels.md load in order, each with its own name. Each
// is entered through the debug API and its number/name read back; the level-select screen
// is captured for the reviewer.

const NAMES = [
  "First Shift",
  "The Yard",
  "Trestle",
  "Interchange",
  "Rush Hour",
  "Last Train Out",
];

export default function item() {
  // The campaign size, the screen PLAY reached, and each level as it loaded.
  let levelCount;
  let selectScreen;
  const levels = [];

  return {
    id: "campaign.six-levels",

    // Everything that needs a `reset` happens here, because `reset` is arrange-only —
    // it hands the build back its manual clock, which mid-act would silently freeze the
    // recording. Reading the campaign size and walking the title menu to level-select
    // are both instant, so both belong here too.
    async arrange(api) {
      await api.reset();
      levelCount = (await api.snapshot()).campaign.levelCount;

      await api.call("press", "Enter"); // PLAY → level-select
      selectScreen = (await api.snapshot()).screen;
    },

    // Capture the level-select screen, then tour all six levels. The old script's second
    // `reset` is what forced the level walk to come first; with the reset lifted into
    // arrange the order flips, and the tour becomes the clip — a reviewer watching it
    // sees each of the six yards in turn rather than a single static menu.
    async act(api) {
      await api.settle(150); // let the level-select screen paint before capturing it
      await api.screenshot("levels");

      for (let n = 1; n <= 6; n++) {
        await api.call("startLevel", n); // a control op — no clock involvement, legal mid-act
        levels.push((await api.snapshot()).level);
        await api.advance(12); // 12 ticks (0.2s) per level, purely so the clip lingers on each
      }
    },

    async assert(api, check) {
      check.expectEq("the campaign has six levels", levelCount, 6);

      for (let n = 1; n <= 6; n++) {
        const lvl = levels[n - 1];
        check.expectEq(`level ${n} loads in order`, lvl.number, n);
        check.expectEq(
          `level ${n} is named "${NAMES[n - 1]}"`,
          lvl.name,
          NAMES[n - 1],
        );
      }

      check.expectEq(
        "the level-select screen is reached",
        selectScreen,
        "level-select",
      );
    },
  };
}
