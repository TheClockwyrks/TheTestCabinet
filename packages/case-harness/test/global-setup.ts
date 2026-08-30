// The package's own suite is a validator project like any other: one static
// server and one browser, started once, handed to the workers as addresses.
//
// Imported by the deep specifier rather than through the barrel, which is what a
// case's `globalSetup.ts` does and why the barrel does not re-export this.

import { makeGlobalSetup } from "../src/global-setup";

export default makeGlobalSetup({ slug: "case-harness" });
