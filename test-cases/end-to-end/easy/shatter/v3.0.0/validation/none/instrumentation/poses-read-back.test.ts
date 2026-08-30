// SCAFFOLD STUB — NOT A VALIDATOR.
//
// instrumentation/poses-read-back — Every pose is reported by the snapshot
//
// Each pose's value is read back from the snapshot: the screen, the menu
// index, the score, the lives, the wave, the wave banner, the ship's position,
// velocity, angle, invulnerability and fire cooldown, a rock's velocity, the
// two world gates, the ship's contact gate, and the saucer's three faculties.
// Mute is not in the list: there is no setMuted.
//
// Declared by test-case.toml as validation.script "instrumentation/poses-read-
// back.test.ts", so the manifest resolves only while this file exists. The
// Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the none harness in validation/none/harness.ts and the spec-
// derived oracle in validation/none/geometry.ts — never against a reference
// build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/instrumentation/poses-read-back.test.ts is a scaffold stub and has not been written yet",
);
