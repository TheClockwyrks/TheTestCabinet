// assets/rebuild — rebuilding the committed workspace with the asset tools
// absent. CASE-PROVIDED.
//
// NOT A `.test.ts`. `specs/assets.md` makes production a one-time step:
// "Production is a one-time step. The tools belong to this machine and are
// absent when the project is installed and rebuilt elsewhere, so the committed
// files are the assets: `npm ci` and `npm run build` invoke no tool, and the
// built site fetches nothing from outside its own `dist/`." This module runs
// that rebuild for real, in a scratch copy of the workspace, with every asset
// tool on `PATH` replaced by a shim that records being called, so "invokes no
// tool" is read off what the build actually did rather than off what its
// scripts appear to say.
//
// THE COPY IS WHAT KEEPS THE CHECK HONEST AND HARMLESS. `vite build` rewrites
// the output directory and the other suites of this project are driving the
// build in the workspace at the same time, so the rebuild happens beside them
// and is thrown away. `node_modules` is shared by symlink: the dependencies are
// the installed ones either way, and reinstalling them is `npm ci`'s network,
// which a validator must not need. The `npm ci` half of the sentence is read
// statically instead, off the lifecycle scripts an install would run.

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

/** The six asset tools the table in `specs/assets.md` names, `particle-2d` included. */
export const TOOLS = [
  "draw",
  "draw-sheet",
  "sfx-synth",
  "sfx-sample",
  "music",
  "particle-2d",
] as const;

/** What is never copied into the scratch workspace. */
const EXCLUDED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "validation",
  "coverage",
  ".git",
  "test-results",
  "playwright-report",
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
  /** Asset tools the build invoked, by name; empty when none was. */
  toolsInvoked: string[];
  /** The rebuilt output directory existed and held files. */
  builtOutput: boolean;
  /**
   * `src` and `href` values in the rebuilt `index.html` that name a location
   * outside the site itself: a URL carrying a scheme other than `data:`, or a
   * protocol-relative `//host` reference. A `data:` reference carries its own
   * content in the attribute and fetches nothing.
   */
  externalHtmlRefs: string[];
}

/**
 * Copy the committed workspace (sources, assets, configuration; never the
 * installed dependencies, the existing output, or this validator project) to a
 * scratch directory, put a marker-writing shim for every asset tool at the
 * front of `PATH`, run `npm run build`, and report what happened.
 */
export function rebuildWithoutTools(): RebuildResult {
  const scratch = mkdtempSync(join(tmpdir(), "wick-self-contained-"));
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
      writeFileSync(
        shim,
        `#!/bin/sh\ntouch "${shims}/invoked-${tool}"\nexit 1\n`,
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
    const externalHtmlRefs: string[] = [];
    for (const name of BUILD_OUTPUTS) {
      const output = join(scratch, name);
      if (!existsSync(output) || readdirSync(output).length === 0) continue;
      builtOutput = true;
      const page = join(output, "index.html");
      if (existsSync(page)) {
        const html = readFileSync(page, "utf8");
        for (const match of html.matchAll(
          /(?:src|href)\s*=\s*["']([^"']+)["']/gi,
        )) {
          const reference = match[1];
          if (
            (/^[a-z][a-z0-9+.-]*:/i.test(reference) &&
              !/^data:/i.test(reference)) ||
            reference.startsWith("//")
          ) {
            externalHtmlRefs.push(reference);
          }
        }
      }
      break;
    }

    return { completed, failure, toolsInvoked, builtOutput, externalHtmlRefs };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The commands the INSTALL half runs that name an asset tool.
 *
 * `npm ci` executes the package's install lifecycle scripts, so a tool hiding
 * in one would run, and fail, on the machine the project is reinstalled on.
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
