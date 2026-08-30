# Reference — base on `none`

**SCAFFOLD PLACEHOLDER — there is no reference build here yet.** This directory
exists so `variants/base.toml`'s `[reference_implementation]` resolves while
Spectra v2.0.0 is being built out. The reference stage replaces this file with the
complete, conformant build.

When it lands, this is a buildable web project that carries its own runtime layer — the frame loop and its delta time, the canvas fit, keyboard input, audio, the debug overlay, and the `window.__spectra` surface. It is built
out-of-band with the case's own `[build]` commands run from this directory, held
to the same four `[toolchain]` gates a run is, and **never seeded into a run** —
handing a model the finished game would defeat the test.

Its `package.json` depends on the repository's own packages by relative `file:`
paths, eight levels up from here, and `@test-cabinet/run-record` is declared even
though nothing in Spectra imports it: `@test-cabinet/particle-runtime` re-exports a
type from it, so a `file:` install of the runtime otherwise leaves `tsc` reaching
for a package npm would try to fetch from the registry. Build the repository's
packages first (`npm ci && npm run build:packages` at the repository root).
