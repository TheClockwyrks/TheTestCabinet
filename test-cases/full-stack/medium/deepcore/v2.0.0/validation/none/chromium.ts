// Deepcore — finding and launching Chromium. CASE-PROVIDED, over the shared harness.
//
// Locating a browser is the same problem on every host these validators run on —
// the devcontainer, CI, and the worker that runs a case's toolchain after a run's
// container has exited — and it is not a problem this case has an opinion about,
// so the search, the anti-throttling launch arguments and the connect live in the
// shared validator harness. The project's own `globalSetup.ts` reaches them
// through `makeGlobalSetup`, and the harness's worker-side browser reaches
// `connectChromium` itself.
//
// The file stays so the case's validator project still NAMES the browser it
// drives: a case author opening this directory should be able to see that these
// checks run in Chromium and where that comes from, without reading the package.

export * from "./case-harness/chromium";
