// Floe — the engineless validator project's global setup. SCAFFOLD STUB.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real setup: build the produced site, serve it, launch the one Chromium the
// whole project shares, and hand each suite worker a page onto it. Carom
// v3.0.0's `validation/none/globalSetup.ts` is the worked example.
//
// Until then it THROWS, which fails the whole engineless project before any
// suite runs. That is deliberate: a setup that quietly did nothing would leave
// every stub in this directory reporting its own failure and hide the fact that
// the browser scaffolding was never written at all.

export default function setup(): never {
  throw new Error(
    "Floe: validation/none/globalSetup.ts is a scaffold stub and has not been " +
      "implemented. The Validators stage replaces it.",
  );
}
