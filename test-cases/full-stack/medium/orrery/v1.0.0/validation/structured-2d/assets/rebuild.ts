// Orrery — rebuilding the committed workspace with the generation tools absent.
// CASE-PROVIDED, and the SAME FILE in all three engine projects.
//
// specs/assets.md makes production a one-time step: "The tools belong to this
// machine and are absent when the project is installed and rebuilt elsewhere,
// so the committed files are the assets: `npm ci` and `npm run build` invoke
// no tool, and the built site fetches nothing from outside its own `dist/`."
// This module runs that rebuild for real, in a scratch copy of the workspace,
// with every generation tool on `PATH` replaced by a shim that records being
// called — so "invokes no tool" is read off what the build actually did rather
// than off what its scripts appear to say.
//
// The copy is what keeps the check honest AND harmless: `vite build` rewrites
// the output directory, and the suites in this project are concurrently
// driving the one in the workspace, so the rebuild happens beside them and is
// thrown away. `node_modules` is shared by symlink — the dependencies are the
// installed ones either way, and reinstalling them is `npm ci`'s network,
// which a validator must not need. The `npm ci` half of the sentence is read
// statically instead: the lifecycle scripts an install runs must not invoke a
// tool (see `installLifecycleToolCommands`).

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
import { WORKSPACE } from "../media";

/** The six generation tools the table in specs/assets.md names. */
export const TOOLS = [
  "draw",
  "draw-sheet",
  "particle-2d",
  "sfx-synth",
  "sfx-sample",
  "music",
] as const;

/** What is never copied into the scratch workspace. */
const EXCLUDED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "validation",
  ".git",
  "coverage",
]);

/** Where `npm run build` may put the site, in the order the runner looks. */
const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

export interface RebuildResult {
  /** `npm run build` exited 0. */
  completed: boolean;
  /** The build's failure output, when it did not complete. */
  failure: string | null;
  /** Generation tools the build invoked, by name; empty when none was. */
  toolsInvoked: string[];
  /**
   * `src`/`href` values in the rebuilt site's `index.html` that name a
   * location outside the site itself: a URL with a scheme, or a
   * protocol-relative `//host` reference.
   */
  externalHtmlRefs: string[];
  /** The rebuilt output directory existed and held files. */
  builtOutput: boolean;
}

/**
 * Copy the committed workspace (sources, assets, configs — never the installed
 * dependencies, the existing output, or this validator project) to a scratch
 * directory, put a marker-writing shim for every generation tool at the front
 * of `PATH`, run `npm run build`, and report what happened.
 */
export function rebuildWithoutTools(): RebuildResult {
  const scratch = mkdtempSync(join(tmpdir(), "orrery-self-contained-"));
  try {
    for (const entry of readdirSync(WORKSPACE)) {
      if (EXCLUDED.has(entry) || entry.startsWith(".tcab-")) continue;
      cpSync(join(WORKSPACE, entry), join(scratch, entry), {
        recursive: true,
      });
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
        timeout: 240_000,
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
          const ref = match[1];
          if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) {
            externalHtmlRefs.push(ref);
          }
        }
      }
      break;
    }

    return { completed, failure, toolsInvoked, externalHtmlRefs, builtOutput };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The commands the INSTALL half runs that name a generation tool. `npm ci`
 * executes the package's install lifecycle scripts, so a tool hiding in one
 * would run — and fail — on the machine the project is reinstalled on. Each
 * script is split on shell separators and only a command's own name counts,
 * so an argument that merely mentions `music.wav` is not a hit.
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
