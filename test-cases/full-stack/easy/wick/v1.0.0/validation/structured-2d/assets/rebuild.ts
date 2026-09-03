// assets/rebuild — rebuilding the committed workspace with the tools absent.
// CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. `specs/assets.md` makes
// production a one-time step: "The tools belong to this machine and are
// absent when the project is installed and rebuilt elsewhere, so the
// committed files are the assets: `npm ci` and `npm run build` invoke no
// tool, and the built site fetches nothing from outside its own `dist/`." It
// also has the loader resolve every path "relative to the page the build is
// served from", which is what keeps a built site running mounted under a
// sub-path.
//
// This module runs that rebuild FOR REAL, so what a check reads is what the
// build actually did rather than what its scripts appear to say: the
// committed tree is copied to a scratch directory, every generation tool on
// `PATH` is replaced by a shim that records being called, `npm run build`
// runs there, and what it emitted is read off the output.
//
// WHY A COPY. `vite build` rewrites the output directory, and the other
// suites in this project are concurrently driving the workspace, so the
// rebuild happens beside them and is thrown away. `node_modules` is shared by
// symlink: the dependencies are the installed ones either way, and
// reinstalling them is `npm ci`'s network, which a validator must not need.
// The `npm ci` half of the sentence is read statically instead, off the
// lifecycle scripts an install runs (see {@link installLifecycleToolCommands}).

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE } from "../harness";

/**
 * The generation tools `specs/assets.md` names: the five in its tool table,
 * and `particle-2d`, which "is on the `PATH` as well".
 */
export const TOOLS = [
  "draw",
  "draw-sheet",
  "sfx-synth",
  "sfx-sample",
  "music",
  "particle-2d",
] as const;

/**
 * What is never copied into the scratch workspace: the installed
 * dependencies (shared by symlink instead), any existing build output, this
 * validator project, and the scratch a run leaves beside the build.
 */
const EXCLUDED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "validation",
  "coverage",
  "test-results",
  "playwright-report",
  ".git",
  ".tcab",
]);

/** Where `npm run build` may put the site, in the order the runner looks. */
const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

/** How long the rebuild is given before it is called a failure. */
const BUILD_TIMEOUT_MS = 240_000;

export interface RebuildResult {
  /** `npm run build` exited 0. */
  completed: boolean;
  /** The build's failure output, when it did not complete. */
  failure: string | null;
  /** Generation tools the build invoked, by name; empty when none was. */
  toolsInvoked: string[];
  /** The rebuilt output directory existed and held files. */
  builtOutput: boolean;
  /** The output directory's name, or `null` where the build left none. */
  outputDir: string | null;
  /** Every `src`/`href` value in the rebuilt site's `index.html`. */
  htmlRefs: string[];
}

/** Every `src` and `href` the page names, in the order it names them. */
function pageRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );
}

/**
 * Copy the committed workspace, put a marker-writing shim for every
 * generation tool at the front of `PATH`, run `npm run build`, and report
 * what happened.
 */
export function rebuildWithoutTools(): RebuildResult {
  const scratch = mkdtempSync(join(tmpdir(), "wick-rebuild-"));
  try {
    for (const entry of readdirSync(WORKSPACE)) {
      if (EXCLUDED.has(entry)) continue;
      cpSync(join(WORKSPACE, entry), join(scratch, entry), { recursive: true });
    }
    symlinkSync(
      realpathSync(join(WORKSPACE, "node_modules")),
      join(scratch, "node_modules"),
      "dir",
    );

    const shims = join(scratch, ".tool-shims");
    mkdirSync(shims);
    for (const tool of TOOLS) {
      const shim = join(shims, tool);
      // Records the call and then fails, exactly as an absent tool would.
      writeFileSync(
        shim,
        `#!/bin/sh\ntouch "${shims}/invoked-${tool}"\nexit 127\n`,
      );
      chmodSync(shim, 0o755);
    }

    let completed = true;
    let failure: string | null = null;
    try {
      execFileSync("npm", ["run", "build"], {
        cwd: scratch,
        env: { ...process.env, PATH: `${shims}:${process.env.PATH ?? ""}` },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: BUILD_TIMEOUT_MS,
      });
    } catch (error) {
      completed = false;
      const raised = error as { stdout?: Buffer; stderr?: Buffer };
      failure = [raised.stdout, raised.stderr]
        .map((stream) => stream?.toString("utf8").trim() ?? "")
        .filter((text) => text !== "")
        .join("\n")
        .slice(-2000);
      if (failure === "") failure = String(error);
    }

    const toolsInvoked = TOOLS.filter((tool) =>
      existsSync(join(shims, `invoked-${tool}`)),
    );

    let builtOutput = false;
    let outputDir: string | null = null;
    const htmlRefs: string[] = [];
    for (const name of BUILD_OUTPUTS) {
      const output = join(scratch, name);
      if (!existsSync(output) || readdirSync(output).length === 0) continue;
      builtOutput = true;
      outputDir = name;
      const page = join(output, "index.html");
      if (existsSync(page))
        htmlRefs.push(...pageRefs(readFileSync(page, "utf8")));
      break;
    }

    return {
      completed,
      failure,
      toolsInvoked,
      builtOutput,
      outputDir,
      htmlRefs,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The commands the INSTALL half runs that name a generation tool.
 *
 * `npm ci` executes the package's install lifecycle scripts, so a tool hiding
 * in one would run — and fail — on the machine the project is reinstalled on.
 * Each script is split on shell separators and only a command's own name
 * counts, so an argument that merely mentions `music.wav` is not a hit.
 */
export function installLifecycleToolCommands(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(WORKSPACE, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const lifecycle = [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepack",
    "postprepare",
  ];
  const hits: string[] = [];
  for (const name of lifecycle) {
    const script = manifest.scripts?.[name];
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
