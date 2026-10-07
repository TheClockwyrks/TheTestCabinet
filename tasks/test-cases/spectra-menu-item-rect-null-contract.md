# Spectra Grades The `menuItemRect` Null Contract

`test-cases/end-to-end/easy/spectra/v2.0.0` decides both halves of the `null`
contract `specs/instrumentation.md` gives `menuItemRect`.

## Current behaviour

`specs/instrumentation.md` states that `menuItemRect` returns `null` on the four
screens that show no menu, `howto`, `stageIntro`, `inWave`, and `stageCleared`,
and when `index` names no item of the menu the current screen shows. The
`instrumentation` category grades the rest of the debug surface and carries no
item for either half.

The `pointer` and `touch` categories call `menuItemRect` on the three menu
screens for indices that name a real item, so the reading is graded only where it
returns a rect. A build that answers a zero rect, the first item's rect, or a
stale rect from the previous screen for either null case scores full marks.

That reading is the one every pointer and touch point drives the input at, so a
build whose answer is wrong outside the graded range hands a reviewer a debug
surface the rest of the checklist trusted.

## Design

An item reads `menuItemRect` past the end of the menu the current screen shows
and asserts `null`. An item reads it on a screen that shows no menu and asserts
`null`, posed to whichever of the four screens the harness reaches most directly,
since the claim is about a screen showing no menu rather than about that
screen's contents.

Both sit in the `instrumentation` category beside the other readings of the debug
surface, and each declares the domains, the `failure_cap` from the guide's table,
and one image output, with a script under every engine project and captured
baselines.

## Done when

- [ ] An item decides that `menuItemRect` answers `null` past the end of a menu.
- [ ] An item decides that `menuItemRect` answers `null` on a screen that shows no menu.
- [ ] Each new item has a script under every engine project and captured baselines.
- [ ] Every count the case states about its own checklist matches the manifest.
- [ ] Gates green.
