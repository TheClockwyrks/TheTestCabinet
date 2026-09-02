// assets/build-invokes-no-asset-tool — the committed files are the assets.
//
// THE RULE, from the opening of `specs/assets.md`: "Production is a one-time
// step. The tools belong to this machine and are absent when the project is
// installed and rebuilt elsewhere, so the committed files are the assets: `npm
// ci` and `npm run build` invoke no tool, and the built site fetches nothing from
// outside its own `dist/`. A build that shells out to a generation tool fails
// wherever the tools are absent, even though the game is complete."
//
// WHY IT IS ASKED. `draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`
// and `music` are on THIS machine's `PATH` and nowhere else. A project that
// regenerates its art or its sound as part of its build is a project that cannot
// be built by anyone who receives it, however complete the game inside it is.
//
// WHAT IT READS, in both halves of the sentence.
//
//   1. `npm run build` IS RUN FOR REAL, in a scratch copy of the committed
//      workspace, with every one of the six generation tools replaced on the
//      `PATH` by a shim that records being called and then fails. The build must
//      complete, must leave an output directory, and must have called none of the
//      six. This is read off what the build actually DID rather than off what its
//      scripts appear to say, so a tool reached through a wrapper, a script, or a
//      generated command is caught the same way a plain invocation is.
//   2. `npm ci` IS READ STATICALLY, through the install lifecycle scripts a fresh
//      install would run — `preinstall`, `install`, `postinstall`, `prepare` and
//      their neighbours. A tool hiding in one of those runs, and fails, on the
//      machine the project is reinstalled on. It is read rather than run because
//      a real `npm ci` needs the network, which a validator must not.
//
// WHY A SCRATCH COPY. `vite build` rewrites its output directory and the other
// checks in this project are driving the one in the workspace, so the rebuild
// happens beside them and is thrown away. The installed dependencies are shared
// by symlink: they are the same dependencies either way, and reinstalling them is
// the network `npm ci` needs.
//
// WHAT THIS POINT DOES NOT DECIDE. Whether the produced files are there, and
// whether they are what the specification asked for, are the points about each of
// them; whether the BUILT SITE reaches outside its own output is
// `built-site-fetches-nothing-external`.
//
// THE EVIDENCE is what the rebuild reported: whether it completed, what it left,
// and which of the six tools — if any — it called.

import { it } from "vitest";
import { assertLength, assertTrue, fail } from "../assert";
import {
  TOOLS,
  installLifecycleToolCommands,
  rebuildWithoutTools,
} from "./rebuild";
import { showPanel } from "./readouts";

it("rebuilds with no generation tool on the PATH", () => {
  const lifecycle = installLifecycleToolCommands();
  const rebuilt = rebuildWithoutTools();

  showPanel("rebuild", "The rebuild with no tool on the PATH", [
    `tools shimmed: ${TOOLS.join(", ")}`,
    `npm run build completed: ${rebuilt.completed}`,
    `an output directory was left: ${rebuilt.builtOutput}`,
    `generation tools invoked: ${rebuilt.toolsInvoked.length === 0 ? "none" : rebuilt.toolsInvoked.join(", ")}`,
    `install lifecycle scripts naming a tool: ${lifecycle.length === 0 ? "none" : lifecycle.join(" | ")}`,
    "",
    ...(rebuilt.completed
      ? []
      : (rebuilt.failure ?? "").split("\n").slice(-12)),
  ]);

  assertLength(
    lifecycle,
    0,
    "commands in the install lifecycle scripts that name a generation tool, which an npm ci elsewhere would run",
  );
  assertLength(
    rebuilt.toolsInvoked,
    0,
    "generation tools the build invoked, of the six specs/assets.md names",
  );
  if (!rebuilt.completed) {
    fail(
      "npm run build to complete with no generation tool on the PATH",
      rebuilt.failure,
    );
  }
  assertTrue(
    rebuilt.builtOutput,
    "the rebuild left an output directory holding files, so the project really rebuilt",
  );
});
