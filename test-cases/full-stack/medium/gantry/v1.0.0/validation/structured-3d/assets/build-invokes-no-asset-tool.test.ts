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
// zero. Nothing short of running the build decides this half — a tool reached
// from a bundler plugin, a wrapper, or a command a script assembles is invisible
// to any reading of what the scripts say.
//
// THE INSTALL HALF IS READ OFF THE LIFECYCLE SCRIPTS. `npm ci` runs a package's
// install lifecycle scripts and nothing else of the package's own, so a tool
// hiding in one is the whole of how an install could invoke one, and the scripts
// say so without an install being run. A script that hands off to another with
// `npm run` is followed through, so a tool one step behind `postinstall` counts
// as one named in it. Reinstalling costs a minute of the grade's budget and the
// network besides, for a reading a parse gives directly.
//
// WHY THE BUILD RUNS IN A COPY. `npm run build` empties and rewrites `dist/` —
// the very directory this project reads the site's produced files out of while
// this suite runs. Running it in place would destroy the tree the rest of the
// grade is measured on. So the sources, the assets and the configuration are
// copied, the copy is built, and the workspace itself is never written to. The
// installed dependencies are shared by a symlink rather than copied: they are
// the same dependencies either way, and it is the build that is under test here
// rather than the install.
//
// WHY NOTHING HERE STANDS THE GAME UP. Every other point in this project drives
// the build and keeps the frame it drove as its evidence. This one is about a
// command rather than about a frame, a picture of the game would show a state
// nothing here posed, and standing the harness up costs a third of what this
// suite spends. So the readings themselves are painted into the panel this point
// leaves behind, and the game is never loaded.
//
// WHAT A PASS MEANS. No install lifecycle script reaches a tool, `npm run build`
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
import { createCanvas } from "@napi-rs/canvas";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { mediaDestination } from "../case-harness/media";

/** This validator project: this suite is staged at `<project>/assets/`. */
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The build workspace, which is where `package.json`, `assets/` and `dist/` sit. */
const WORKSPACE = dirname(PROJECT_ROOT);

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
 * The commands `script` runs that name one of the four tools, with the scripts
 * it hands off to followed through.
 *
 * A script is split on the shell's separators and only a command's OWN name
 * counts, so a script whose argument merely mentions `music.wav` is not a hit. A
 * command that runs another of the package's scripts — `npm run produce`, and
 * the `pnpm`/`yarn` spellings of it — is read on: what an install runs is the
 * whole chain rather than the one line that starts it. `seen` closes the loop a
 * pair of scripts naming each other would otherwise make.
 */
function toolCommands(
  scripts: Record<string, string>,
  script: string,
  trail: string,
  seen: Set<string>,
): string[] {
  const hits: string[] = [];
  for (const command of script.split(/&&|\|\||[;|\n]/)) {
    const words = command.trim().split(/\s+/);
    const name = (words[0] ?? "").split("/").pop() ?? "";
    if ((TOOLS as readonly string[]).includes(name)) {
      hits.push(`${trail}: ${command.trim()}`);
      continue;
    }
    const runner = ["npm", "pnpm", "yarn", "bun"].includes(name);
    if (!runner) continue;
    const rest = words.slice(1).filter((word) => !word.startsWith("-"));
    const next =
      rest[0] === "run" || rest[0] === "run-script" ? rest[1] : rest[0];
    if (next === undefined || seen.has(next)) continue;
    const handed = scripts[next];
    if (handed === undefined) continue;
    seen.add(next);
    hits.push(...toolCommands(scripts, handed, `${trail} → ${next}`, seen));
  }
  return hits;
}

/** The commands an install would run that reach one of the four tools. */
function lifecycleToolCommands(manifest: string): string[] {
  const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
  const scripts = parsed.scripts ?? {};
  const hits: string[] = [];
  for (const name of LIFECYCLE) {
    const script = scripts[name];
    if (script === undefined) continue;
    hits.push(...toolCommands(scripts, script, name, new Set([name])));
  }
  return hits;
}

/** The panel's width, in characters, before a listing folds onto a new line. */
const PANEL_COLUMNS = 96;

/**
 * `label` and what it holds, folded across as many panel rows as it takes.
 *
 * A listing of nothing reads `none`, which is what most of them read on a build
 * that honours the requirement.
 */
function listing(label: string, items: readonly string[]): string[] {
  const rows: string[] = [];
  let row = `${label}:`;
  for (const [index, item] of items.entries()) {
    const one = index === items.length - 1 ? item : `${item},`;
    const next = `${row} ${one}`;
    if (next.length > PANEL_COLUMNS && row !== `${label}:`) {
      rows.push(row);
      row = `  ${one}`;
    } else {
      row = next;
    }
  }
  rows.push(items.length === 0 ? `${label}: none` : row);
  return rows;
}

/**
 * Paint `rows` as this point's `build` output.
 *
 * WHAT THIS POINT SHOWS A REVIEWER is the readings it decided on, because there
 * is no frame to show: a build ran with four names taken off the machine, and
 * what it did is text. Nothing painted here is ever read by an assertion, and a
 * panel that cannot be written is a fact about the host rather than about the
 * build, so a failed write warns and the point still reaches its verdict.
 */
function showPanel(
  outputId: string,
  title: string,
  rows: readonly string[],
): void {
  const destination = mediaDestination(PROJECT_ROOT, outputId, "png");
  if (destination === null) return;
  const canvas = createCanvas(1100, 64 + Math.max(1, rows.length) * 26);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e8ecf2";
  ctx.font = "17px sans-serif";
  ctx.fillText(title, 20, 30);
  ctx.fillStyle = "#c9d4e4";
  ctx.font = "14px monospace";
  rows.forEach((row, index) => {
    ctx.fillText(row, 20, 62 + index * 26);
  });
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`gantry: could not write ${destination}: ${String(error)}`);
  }
}

it("installs and builds with the four asset tools unreachable", () => {
  const manifestPath = join(WORKSPACE, "package.json");
  assertTrue(
    existsSync(manifestPath),
    "a `package.json` at the repository root, whose `npm ci` and " +
      "`npm run build` are the build interface (specs/overview.md)",
  );
  const manifest = readFileSync(manifestPath, "utf8");
  const lifecycle = lifecycleToolCommands(manifest);

  const scratch = mkdtempSync(join(tmpdir(), "gantry-build-"));
  try {
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
      "the workspace's dependencies to be installed, since `npm run build` " +
        "is run over them (specs/overview.md)",
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

    // `PATH` with the shims first and every directory carrying a real tool of
    // one of those names taken out, so a shim is the only resolution.
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

    const invoked = existsSync(record)
      ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean)
      : [];
    const dist = join(copy, "dist");
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

    showPanel("build", "The build run with the asset tools withheld", [
      ...listing("tools withheld", [...TOOLS]),
      ...listing("install lifecycle commands reaching a tool", lifecycle),
      `npm run build exited: ${String(done.status)}`,
      ...listing("tools the build invoked", invoked),
      `dist/index.html: ${existsSync(join(dist, "index.html")) ? "present" : "absent"}`,
      ...listing("produced files emitted", [...rebuilt].sort()),
      ...listing("produced files missing", missing),
    ]);

    assertEqual(
      lifecycle.join("; "),
      "",
      "`npm ci` to invoke none of `voxel`, `sfx-synth`, `sfx-sample` and " +
        "`music` (specs/assets.md) — these install scripts reach one",
    );

    if (done.status !== 0) {
      fail(
        "`npm run build` to exit 0 with `voxel`, `sfx-synth`, `sfx-sample` " +
          "and `music` unreachable, since the committed files are the assets " +
          "and the build only bundles them (specs/assets.md)",
        `it exited ${String(done.status)}:\n${output}`,
      );
    }

    assertEqual(
      invoked.join(", "),
      "",
      "`npm run build` to invoke none of `voxel`, `sfx-synth`, `sfx-sample` " +
        "and `music` (specs/assets.md) — these were invoked",
    );

    assertTrue(
      existsSync(join(dist, "index.html")),
      "the build to produce `dist/index.html` at the root of the output " +
        "directory, which is the entry point of the complete static site " +
        "(specs/overview.md)",
    );

    // And the produced files came through the bundle rather than out of a tool:
    // whatever the workspace's own `dist/` carries under a produced extension,
    // this one carries too, by the same name with the bundler's hash taken off.
    assertEqual(
      missing.join(", "),
      "",
      "the build run with the tools withheld to emit every produced file the " +
        "site loads, since the committed files are the assets " +
        "(specs/assets.md) — these are missing from its output",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
