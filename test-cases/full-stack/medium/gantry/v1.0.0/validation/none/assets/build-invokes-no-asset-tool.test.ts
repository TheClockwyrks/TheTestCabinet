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
// HOW THE TOOLS ARE WITHHELD. Four executables named `voxel`, `sfx-synth`,
// `sfx-sample` and `music` are put first on `PATH`; each records that it was
// invoked and exits non-zero. Every directory on `PATH` that carries a real tool
// of one of those names is then removed, so the shim is the only thing either
// name resolves to. A build that shells out to a tool therefore both FAILS and
// LEAVES A RECORD, and the two are read separately: a build that swallowed the
// tool's failure and carried on is caught by the record even though it exited
// zero.
//
// WHY THE COMMANDS RUN IN A COPY. `npm ci` deletes and reinstalls
// `node_modules`, and `npm run build` empties and rewrites `dist/` — the very
// directory the harness is serving to every other suite in this project while
// this one runs. Running either in place would destroy the tree the rest of the
// grade is measured on. So the repository is copied, the copy is installed and
// built, and the workspace itself is never written to.
//
// THE COPY IS PLACED SO THAT A `file:` DEPENDENCY STILL RESOLVES. A workspace
// may depend on a package by relative path — `@clockwyrks/voxel-runtime` is
// one, under this engine — and such a path is relative to the package's own
// directory, so a copy elsewhere would break the install for a reason that has
// nothing to do with the build. The copy is therefore placed deep enough inside
// a scratch root for every `..` in such a specifier to land inside it, and each
// one is linked to the directory it names from the real workspace.
//
// WHAT A PASS MEANS. Both commands exited zero with the tools unreachable, no
// shim was invoked, and the build produced `dist/index.html`
// (specs/overview.md) carrying the same produced files the workspace's own
// `dist/` carries — so the committed files really are the assets and the build
// only bundles them.

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
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The four tools `specs/assets.md` lists, which neither command may invoke. */
const TOOLS = ["voxel", "sfx-synth", "sfx-sample", "music"] as const;

/** What is not copied: installed, produced, or the case's own staged project. */
const NOT_COPIED = new Set(["node_modules", "dist", "validation", ".git"]);

/** The produced extensions whose presence in the built output is compared. */
const PRODUCED = /\.(glb|gltf|wav|mid)$/i;

/** How long the install and the build are given, together. */
const BUDGET_MS = 480_000;

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

/** One dependency a package.json declares by relative path. */
interface Linked {
  /** The package's name, so the installed tree can be asked where it really is. */
  name: string;
  /** The path after `file:`, relative to the package that declares it. */
  spec: string;
}

/** The `file:` dependencies a package.json declares. */
function fileDependencies(manifest: string): Linked[] {
  const parsed = JSON.parse(manifest) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const groups = [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.optionalDependencies,
  ];
  const linked: Linked[] = [];
  for (const group of groups) {
    for (const [name, value] of Object.entries(group ?? {})) {
      if (typeof value === "string" && value.startsWith("file:")) {
        linked.push({ name, spec: value.slice("file:".length) });
      }
    }
  }
  return linked;
}

/**
 * The directory a `file:` dependency really names.
 *
 * Its own path first, and the installed tree second: a workspace that has been
 * moved since it was installed — which is what the runner does when it stages
 * this project — still carries a link to the real directory under
 * `node_modules`, and that link is the authority on where the package is.
 */
function linkedDirectory(workspace: string, linked: Linked): string | null {
  const own = resolve(workspace, linked.spec);
  if (existsSync(own)) return own;
  const installed = join(workspace, "node_modules", ...linked.name.split("/"));
  try {
    return existsSync(installed) ? realpathSync(installed) : null;
  } catch {
    return null;
  }
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

it(
  "installs and builds with the four asset tools unreachable",
  async () => {
    const manifestPath = join(WORKSPACE, "package.json");
    assertTrue(
      existsSync(manifestPath),
      "a `package.json` at the repository root, whose `npm ci` and " +
        "`npm run build` are the build interface (specs/overview.md)",
    );
    const manifest = readFileSync(manifestPath, "utf8");
    const linked = fileDependencies(manifest);

    // Deep enough for every `..` in a relative `file:` specifier to land inside
    // the scratch root rather than above it.
    const ups = linked.reduce((deepest, one) => {
      const climbs = one.spec.split("/").filter((part) => part === "..").length;
      return Math.max(deepest, climbs);
    }, 0);

    scratch = mkdtempSync(join(tmpdir(), "gantry-build-"));
    const copy = join(scratch, ...Array.from({ length: ups }, (_, i) => `d${i}`), "workspace");
    mkdirSync(copy, { recursive: true });

    for (const entry of readdirSync(WORKSPACE, { withFileTypes: true })) {
      if (NOT_COPIED.has(entry.name)) continue;
      cpSync(join(WORKSPACE, entry.name), join(copy, entry.name), {
        recursive: true,
        dereference: false,
      });
    }

    // Each relative `file:` dependency, linked from the copy to the directory it
    // names from the real workspace.
    for (const one of linked) {
      const target = linkedDirectory(WORKSPACE, one);
      const at = resolve(copy, one.spec);
      if (target === null) {
        fail(
          `the \`file:\` dependency \`${one.name}\` to name a directory this ` +
            "point can link into the copy it installs, so `npm ci` runs there " +
            "as it runs in the workspace",
          `\`${one.spec}\` names nothing, and nothing is installed under ` +
            `\`node_modules/${one.name}\``,
        );
      }
      if (existsSync(at)) continue;
      mkdirSync(dirname(at), { recursive: true });
      symlinkSync(target, at);
    }

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

    const run = (
      command: string,
      args: readonly string[],
    ): { code: number | null; output: string } => {
      const done = spawnSync(command, [...args], {
        cwd: copy,
        env: { ...process.env, PATH: path, CI: "1" },
        encoding: "utf8",
        timeout: BUDGET_MS,
        maxBuffer: 64 * 1024 * 1024,
      });
      const output = `${done.stdout ?? ""}${done.stderr ?? ""}`;
      return { code: done.status, output: output.slice(-2000) };
    };

    const installed = run("npm", ["ci", "--no-audit", "--no-fund"]);
    await h.capture("build", "The build run with the asset tools withheld");

    if (installed.code !== 0) {
      fail(
        "`npm ci` to exit 0 with `voxel`, `sfx-synth`, `sfx-sample` and " +
          "`music` unreachable, since it invokes no tool (specs/assets.md, " +
          "specs/overview.md)",
        `it exited ${String(installed.code)}:\n${installed.output}`,
      );
    }

    const built = run("npm", ["run", "build"]);
    if (built.code !== 0) {
      fail(
        "`npm run build` to exit 0 with `voxel`, `sfx-synth`, `sfx-sample` " +
          "and `music` unreachable, since the committed files are the assets " +
          "and the build only bundles them (specs/assets.md)",
        `it exited ${String(built.code)}:\n${built.output}`,
      );
    }

    const invoked = existsSync(record)
      ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean)
      : [];
    assertEqual(
      invoked.join(", "),
      "",
      "neither `npm ci` nor `npm run build` to invoke `voxel`, `sfx-synth`, " +
        "`sfx-sample` or `music` (specs/assets.md) — these were invoked",
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
        .filter((path) => PRODUCED.test(path))
        .map(stem),
    );
    const rebuilt = new Set(
      filesUnder(dist)
        .filter((path) => PRODUCED.test(path))
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
        `  npm ci exited ${String(installed.code)}\n` +
        `  npm run build exited ${String(built.code)}\n` +
        `  shims invoked: none\n` +
        `  produced files emitted: ${[...rebuilt].sort().join(", ")}`,
    );
  },
  600_000,
);
