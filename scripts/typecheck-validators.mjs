// Type-checks every test case's validator projects.
//
// A case that supports engines ships one validator project per engine under
// `<version>/validation/<engine>/`, each with a `tsconfig.json` of its own. This
// walks the checkout for those configs and runs `tsc --noEmit` over each, so a
// validator that does not compile is caught here rather than in a run, where a
// broken suite costs the run every point it decides.
//
// The projects resolve two things that only exist in the STAGED tree — the
// build's `../src/*` and the harness copied in as `./case-harness/*` — through
// the `rootDirs` each project's config declares. See the header comment on any
// `validation/tsconfig.json`.
//
// A config names the harness's source where this checkout held it when the
// version was written, `packages/case-harness/src`, and a version with runs
// recorded against it is frozen, so its config cannot follow the package to the
// engines repository, checked out at `engines/`. A project whose `rootDirs` name a
// path in MOVED is checked through a derived config instead: written outside the
// test cases, extending the project's own, with that path mapped to where it lives
// now and every other option the project's.
//
// Projects are independent, so they run concurrently, one `tsc` per project up
// to the core count. Every failing project is reported before the exit, because
// fixing one at a time across fifty-odd projects is the slow way round.

import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const ts = require("typescript");

/** Paths a project's `rootDirs` may name, relative to the repository, and where each is now. */
const MOVED = new Map([
  ["packages/case-harness/src", "engines/packages/case-harness/src"],
]);

// Under the workspace's node_modules rather than the system's temporary directory:
// a config's `types` are looked up in the `node_modules/@types` above the config
// file, so a derived config must sit below the repository's.
const cacheDir = join(repoRoot, "node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
// The harness's source now sits in the engines checkout, and a module it imports is
// looked up in the `node_modules` nearest that file first, which is the engines
// workspace's own once it is installed (scripts/repos/link-packages.sh installs it).
// The harness augments `vitest`'s provided context, so the suites and the harness
// must see one `vitest`: a derived config sends it to the root workspace's.
const SHARED_TYPES = {
  vitest: [join(repoRoot, "node_modules", "vitest")],
  "vitest/*": [join(repoRoot, "node_modules", "vitest", "*")],
};

const derivedDir = mkdtempSync(join(cacheDir, "typecheck-validators-"));
process.on("exit", () => rmSync(derivedDir, { recursive: true, force: true }));

/**
 * The config `tsc -p` is given for a project: its own `tsconfig.json`, or, when its
 * `rootDirs` name a path in MOVED, a derived one that maps that path.
 */
function configFor(project) {
  const own = join(project, "tsconfig.json");
  const { config, error } = ts.readConfigFile(own, ts.sys.readFile);
  if (error || !Array.isArray(config?.compilerOptions?.rootDirs)) return own;
  let moved = false;
  const rootDirs = config.compilerOptions.rootDirs.map((dir) => {
    const absolute = resolve(project, dir);
    const now = MOVED.get(
      relative(repoRoot, absolute).split(/[\\/]/).join("/"),
    );
    if (now === undefined) return absolute;
    moved = true;
    return join(repoRoot, now);
  });
  if (!moved) return own;
  const derived = join(
    derivedDir,
    `${relative(repoRoot, project).replace(/[\\/]/g, "__")}.json`,
  );
  const include = (config.include ?? ["."]).map((entry) =>
    resolve(project, entry),
  );
  writeFileSync(
    derived,
    JSON.stringify({
      extends: own,
      compilerOptions: { rootDirs, paths: SHARED_TYPES },
      include,
    }),
  );
  return derived;
}

/** Every `validation/<engine>/` directory that carries a `tsconfig.json`. */
function findProjects() {
  const projects = [];
  const casesRoot = join(repoRoot, "test-cases");
  // test-cases/<type>/<difficulty>/<slug>/<version>/validation/<engine>
  const dirs = (path) =>
    existsSync(path)
      ? readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(path, entry.name))
      : [];
  for (const type of dirs(casesRoot)) {
    for (const difficulty of dirs(type)) {
      for (const slug of dirs(difficulty)) {
        for (const version of dirs(slug)) {
          for (const engine of dirs(join(version, "validation"))) {
            if (existsSync(join(engine, "tsconfig.json")))
              projects.push(engine);
          }
        }
      }
    }
  }
  return projects.sort();
}

/** `tsc -p project`, resolving to its output rather than throwing on a failure. */
function typecheck(project) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [tsc, "-p", configFor(project)],
      { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ project, ok: !error, output: `${stdout}${stderr}`.trim() });
      },
    );
  });
}

const projects = findProjects();
if (projects.length === 0) {
  console.error("no validator projects found under test-cases/");
  process.exit(1);
}

const queue = [...projects];
const failures = [];
const workers = Array.from(
  { length: Math.min(availableParallelism(), queue.length) },
  async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await typecheck(next);
      const name = relative(repoRoot, result.project);
      if (result.ok) {
        console.log(`ok   ${name}`);
      } else {
        console.log(`FAIL ${name}`);
        failures.push(result);
      }
    }
  },
);
await Promise.all(workers);

if (failures.length > 0) {
  console.error(
    `\n${failures.length} of ${projects.length} projects failed:\n`,
  );
  for (const failure of failures) {
    console.error(`--- ${relative(repoRoot, failure.project)}`);
    console.error(failure.output);
    console.error("");
  }
  process.exit(1);
}

console.log(`\n${projects.length} validator projects type-check.`);
