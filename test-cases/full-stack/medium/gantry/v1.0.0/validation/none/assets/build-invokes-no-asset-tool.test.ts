// assets/build-invokes-no-asset-tool — installing and building invoke no asset
// tool.
//
// specs/assets.md, intro: "Production is a one-time step. The tools are
// development tools of this machine; the committed files are the assets, and
// the build bundles them, so `npm ci` and `npm run build` invoke no tool";
// specs/overview.md, "The build interface": "the produced files are committed,
// the build bundles them, and neither `npm ci` nor `npm run build` invokes a
// tool."
//
// THE BUILD HALF IS RUN FOR REAL. Four executables named `voxel`, `sfx-synth`,
// `sfx-sample` and `music` are put first on `PATH`; each records that it was
// invoked and exits non-zero. Every directory on `PATH` that carries a real tool
// of one of those names is then removed, so the shim is the only thing either
// name resolves to. A build that shells out to a tool therefore both FAILS and
// LEAVES A RECORD, and the two are read separately: a build that swallowed the
// tool's failure and carried on is caught by the record even though it exited
// zero.
//
// THE INSTALL HALF IS READ OFF THE LIFECYCLE SCRIPTS. `npm ci` runs a package's
// install lifecycle scripts and nothing else of the package's own, so a tool
// hiding in one is the whole of how an install could invoke one, and the scripts
// say so without an install being run. Reinstalling costs a second of the
// grade's budget for a reading a parse gives exactly, and this point stays
// inside the budget every validator is held to.
//
// WHY THE BUILD RUNS IN A COPY. `npm run build` empties and rewrites `dist/` —
// the very directory the harness is serving to every other suite in this project
// while this one runs. Running it in place would destroy the tree the rest of
// the grade is measured on. So the sources, the assets and the configuration are
// copied, the copy is built, and the workspace itself is never written to. The
// installed dependencies are shared by a symlink rather than copied: they are
// the same dependencies either way, and it is the build that is under test here
// rather than the install.
//
// WHAT A PASS MEANS. No install lifecycle script names a tool, `npm run build`
// exited zero with the four tools unreachable, no shim was invoked, and the
// build produced `dist/index.html` (specs/overview.md) carrying the same
// produced files the workspace's own `dist/` carries — so the committed files
// really are the assets and the build only bundles them.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The four tools `specs/assets.md` lists, which neither command may invoke. */
const TOOLS = ["voxel", "sfx-synth", "sfx-sample", "music"] as const;

/** The scripts `npm ci` runs, and so the ones an install could hide a tool in. */
const LIFECYCLE = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepack",
  "postprepare",
] as const;

/** What is not copied: installed, produced, or the case's own staged project. */
const NOT_COPIED = new Set(["node_modules", "dist", "validation", ".git"]);

/** The produced extensions whose presence in the built output is compared. */
const PRODUCED = /\.(glb|gltf|wav|mid)$/i;

/** How long the build is given. */
const BUDGET_MS = 240_000;

/** A file name with a bundler's content hash taken off: `crate-A1b2C3.glb`. */
function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot < 0 ? name : name.slice(0, dot);
  const extension = dot < 0 ? "" : name.slice(dot);
  return `${base.replace(/-[A-Za-z0-9_-]{6,}$/, "")}${extension}`;
}

/** Every file under `at`, as paths relative to it. */
function filesUnder(at: string, base = at, found: string[] = []): string[] {
  if (!existsSync(at)) return found;
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory()) filesUnder(path, base, found);
    else found.push(relative(base, path).split(sep).join("/"));
  }
  return found;
}

/**
 * The commands an install would run that name one of the four tools.
 *
 * Each script is split on the shell's separators and only a command's own name
 * counts, so a script whose argument merely mentions `music.wav` is not one.
 */
function lifecycleToolCommands(manifest: string): string[] {
  const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
  const hits: string[] = [];
  for (const name of LIFECYCLE) {
    const script = parsed.scripts?.[name];
    if (script === undefined) continue;
    for (const command of script.split(/&&|\|\||[;|\n]/)) {
      const word = command.trim().split(/\s+/)[0] ?? "";
      const base = word.split("/").pop() ?? "";
      if ((TOOLS as readonly string[]).includes(base)) {
        hits.push(`${name}: ${command.trim()}`);
      }
    }
  }
  return hits;
}

let h: Harness;
let scratch: string | null = null;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

it("installs and builds with the four asset tools unreachable", async () => {
  const manifestPath = join(WORKSPACE, "package.json");
  assertTrue(
    existsSync(manifestPath),
    "a `package.json` at the repository root, whose `npm ci` and " +
      "`npm run build` are the build interface (specs/overview.md)",
  );
  const manifest = readFileSync(manifestPath, "utf8");

  const lifecycle = lifecycleToolCommands(manifest);
  assertEqual(
    lifecycle.join("; "),
    "",
    "`npm ci` to invoke none of `voxel`, `sfx-synth`, `sfx-sample` and " +
      "`music` (specs/assets.md) — these install scripts run one",
  );

  scratch = mkdtempSync(join(tmpdir(), "gantry-build-"));
  const copy = join(scratch, "workspace");
  mkdirSync(copy, { recursive: true });

  for (const entry of readdirSync(WORKSPACE, { withFileTypes: true })) {
    if (NOT_COPIED.has(entry.name)) continue;
    cpSync(join(WORKSPACE, entry.name), join(copy, entry.name), {
      recursive: true,
      dereference: false,
    });
  }

  // The installed dependencies, shared rather than reinstalled. The link is to
  // the real directory, so every relative link npm wrote inside it — a `file:`
  // dependency is one — still names what it named.
  const installed = join(WORKSPACE, "node_modules");
  assertTrue(
    existsSync(installed),
    "the workspace's dependencies to be installed, since `npm run build` is " +
      "run over them (specs/overview.md)",
  );
  symlinkSync(realpathSync(installed), join(copy, "node_modules"), "dir");

  // The shims, and the record they leave.
  const shimDir = join(scratch, "shims");
  const record = join(scratch, "invoked.log");
  mkdirSync(shimDir, { recursive: true });
  for (const tool of TOOLS) {
    const shim = join(shimDir, tool);
    writeFileSync(
      shim,
      `#!/bin/sh\nprintf '%s\\n' "${tool} $*" >> ${JSON.stringify(record)}\nexit 1\n`,
    );
    chmodSync(shim, 0o755);
  }

  // `PATH` with the shims first and every directory carrying a real tool of one
  // of those names taken out, so a shim is the only resolution.
  const carriesTool = (directory: string): boolean => {
    try {
      const names = new Set(readdirSync(directory));
      return TOOLS.some((tool) => names.has(tool));
    } catch {
      return false;
    }
  };
  const path = [
    shimDir,
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter((one) => one !== "" && one !== shimDir && !carriesTool(one)),
  ].join(delimiter);

  const done = spawnSync("npm", ["run", "build"], {
    cwd: copy,
    env: { ...process.env, PATH: path, CI: "1" },
    encoding: "utf8",
    timeout: BUDGET_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${done.stdout ?? ""}${done.stderr ?? ""}`.slice(-2000);

  await h.advance(1);
  await h.capture("build", "The build run with the asset tools withheld");

  if (done.status !== 0) {
    fail(
      "`npm run build` to exit 0 with `voxel`, `sfx-synth`, `sfx-sample` " +
        "and `music` unreachable, since the committed files are the assets " +
        "and the build only bundles them (specs/assets.md)",
      `it exited ${String(done.status)}:\n${output}`,
    );
  }

  const invoked = existsSync(record)
    ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean)
    : [];
  assertEqual(
    invoked.join(", "),
    "",
    "`npm run build` to invoke none of `voxel`, `sfx-synth`, `sfx-sample` " +
      "and `music` (specs/assets.md) — these were invoked",
  );

  const dist = join(copy, "dist");
  assertTrue(
    existsSync(join(dist, "index.html")),
    "the build to produce `dist/index.html` at the root of the output " +
      "directory, which is the entry point of the complete static site " +
      "(specs/overview.md)",
  );

  // And the produced files came through the bundle rather than out of a tool:
  // whatever the workspace's own `dist/` carries under a produced extension,
  // this one carries too, by the same name with the bundler's hash taken off.
  const wanted = new Set(
    filesUnder(join(WORKSPACE, "dist"))
      .filter((one) => PRODUCED.test(one))
      .map(stem),
  );
  const rebuilt = new Set(
    filesUnder(dist)
      .filter((one) => PRODUCED.test(one))
      .map(stem),
  );
  const missing = [...wanted].filter((one) => !rebuilt.has(one)).sort();
  assertEqual(
    missing.join(", "),
    "",
    "the build run with the tools withheld to emit every produced file the " +
      "site loads, since the committed files are the assets " +
      "(specs/assets.md) — these are missing from its output",
  );

  console.log(
    "gantry: the build run with the asset tools withheld —\n" +
      `  install lifecycle scripts naming a tool: none\n` +
      `  npm run build exited ${String(done.status)}\n` +
      `  shims invoked: none\n` +
      `  produced files emitted: ${[...rebuilt].sort().join(", ")}`,
  );
});
