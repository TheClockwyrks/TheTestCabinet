// Facet — what has to be in place before a suite's own imports are evaluated.
// CASE-PROVIDED.
//
// SHARED FILE. Byte-identical in `validation/simple-2d/` and
// `validation/structured-2d/`, the two directories a headless engine run lives
// in. It installs the shims `dom-shim.ts` holds, which are themselves shared
// between those two directories, so it is copied between them rather than
// re-derived. An edit belongs in both copies at once; two copies that differ
// are a defect in the case.
//
// This file is a `setupFiles` entry, and that is the whole point of it: vitest
// evaluates a setup file BEFORE the test file's own imports, which is the only
// moment the browser shims can be installed before `../src/game` — and, through
// it, the engine and whatever the build imports at module scope — is loaded.
//
// `dom-shim.ts` says what each shim is for and why the case owns it. In short:
// without them a Facet build's produced gems never load and the engine's audio
// bus never declares a cue, after which its `play` throws from inside the
// build's own update. Every check in this directory would then fail over a
// fault this harness created rather than over anything the build did.

import { afterAll } from "vitest";
import { installDomShims } from "./dom-shim";

const restore = installDomShims();

afterAll(() => {
  restore();
});
