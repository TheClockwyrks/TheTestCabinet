// SCAFFOLD STUB — NOT A VALIDATOR.
//
// saucer/despawns-after-12s — A saucer leaves after 12 seconds
//
// A saucer added with its mind and gun off is still up at 11.5 s of game time
// and gone by 12.5 s.
//
// Declared by test-case.toml as validation.script "saucer/despawns-
// after-12s.test.ts", so the manifest resolves only while this file exists.
// The Validators stage of the v3.0.0 rework replaces it with the real suite,
// written against the simple-2d harness in validation/simple-2d/harness.ts and
// the spec-derived oracle in validation/simple-2d/geometry.ts — never against
// a reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/simple-2d/saucer/despawns-after-12s.test.ts is a scaffold stub and has not been written yet",
);
