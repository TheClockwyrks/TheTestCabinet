// SCAFFOLD STUB — NOT A VALIDATOR.
//
// screens/menu-selection-stays-in-range — A menu selection never leaves its entries
//
// Driving the menu move action ten times in each direction on every menu
// leaves menuIndex inside that menu's entry count throughout.
//
// Declared by test-case.toml as validation.script "screens/menu-selection-
// stays-in-range.test.ts", so the manifest resolves only while this file
// exists. The Validators stage of the v3.0.0 rework replaces it with the real
// suite, written against the none harness in validation/none/harness.ts and
// the spec-derived oracle in validation/none/geometry.ts — never against a
// reference build.
//
// It THROWS on import rather than passing, so a stub the Validators stage
// forgets fails loudly instead of silently scoring a point.

throw new Error(
  "Shatter v3.0.0: validation/none/screens/menu-selection-stays-in-range.test.ts is a scaffold stub and has not been written yet",
);
