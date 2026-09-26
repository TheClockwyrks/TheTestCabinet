// Where a case's own init scripts stand relative to the harness's, and why the
// order is not a preference.
//
// Both of a case's lists run before a line of the BUILD's own script, which is
// all most of them need. What separates them is the harness's instrumentation
// sitting between the two: `recorder-init.js` replaces
// `HTMLCanvasElement.prototype.getContext` with one that hands back a recording
// proxy, so a case script that must hold the page's REAL `getContext` — spectra's
// `raster-init.js` takes it for the probe it measures a fill's opacity on — has
// to have run first. Run in the other order such a script is not broken loudly;
// it is broken quietly, and what it costs is a still that takes fifteen seconds
// instead of a quarter of one.
//
// The two probe scripts in `scripts/` record what was standing when each of them
// ran, so one reading off the page says which position each occupied.

import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, createScriptedHarness, type Harness } from "./fixture";

/** What each probe script recorded, in the order the scripts ran. */
interface InitProbe {
  name: string;
  /** Whether the harness's recorder was already installed when it ran. */
  sawRecorder: boolean;
  /** Whether the harness's audio probe was. */
  sawAudio: boolean;
  /** Whether the `getContext` it captured is still the one on the prototype. */
  heldLiveGetContext: boolean;
}

/** Read the probe log back off the page, with the identity check made in it. */
function readProbes(h: Harness): Promise<InitProbe[]> {
  return h.page.evaluate(() => {
    const log = (
      window as unknown as {
        __initProbe?: {
          name: string;
          sawRecorder: boolean;
          sawAudio: boolean;
          getContext: unknown;
        }[];
      }
    ).__initProbe;
    return (log ?? []).map((entry) => ({
      name: entry.name,
      sawRecorder: entry.sawRecorder,
      sawAudio: entry.sawAudio,
      // Compared IN THE PAGE, because a function cannot cross out of it: the live
      // `getContext` is the recorder's proxy, so holding it means having run
      // after the instrumentation and not holding it means having run before.
      heldLiveGetContext:
        entry.getContext === HTMLCanvasElement.prototype.getContext,
    }));
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createScriptedHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a case's scripts on either side of the harness's own", async () => {
  const probes = await readProbes(h);

  // Three positions, and the middle one is the package's.
  expect(probes.map((probe) => probe.name)).toEqual(["pre", "post"]);

  // `preInitScripts` stands ahead of the instrumentation: neither of the
  // harness's globals is up yet, and the `getContext` it captured is the page's
  // own rather than the recording proxy that replaced it.
  expect(probes[0]).toMatchObject({
    sawRecorder: false,
    sawAudio: false,
    heldLiveGetContext: false,
  });

  // `extraInitScripts` stands behind it, which is exactly where it always stood:
  // both globals are installed, and the `getContext` it captured is the proxy.
  expect(probes[1]).toMatchObject({
    sawRecorder: true,
    sawAudio: true,
    heldLiveGetContext: true,
  });
});

it("leaves the build itself ahead of neither", async () => {
  // The guarantee both lists share, and the one that has not changed: every one
  // of the three ran before a line of the build's script, so the surface the
  // build installed is whole and the harness drives it exactly as it drives a
  // page carrying no case script at all.
  expect(h.surfaceFault).toBeNull();
  expect((await h.step(3)).frames).toBe(3);
  expect((await h.frameCalls()).length).toBeGreaterThan(0);
});

it("keeps a kit's scripts to that kit's own pages", async () => {
  // A context is instrumented once, when it is opened, and every later harness of
  // the same key gets the one already standing — so two kits of one case that
  // differ only in what they inject must not share a context, or the second kit's
  // scripts would never run while everything looked exactly like they had.
  const plain = await createHarness();
  try {
    expect(await readProbes(plain)).toEqual([]);
    expect(plain.surfaceFault).toBeNull();
  } finally {
    await plain.dispose();
  }

  // And the scripted kit is unaffected by the plain one having opened a page of
  // the same shape beside it.
  const again = await createScriptedHarness();
  try {
    expect((await readProbes(again)).map((probe) => probe.name)).toEqual([
      "pre",
      "post",
    ]);
  } finally {
    await again.dispose();
  }
});
