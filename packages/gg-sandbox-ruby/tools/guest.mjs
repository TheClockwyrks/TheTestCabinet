// Compile the two Ruby halves of the guest into the JavaScript `componentize-js` bakes:
//
//   src/gg/**.rb   --this script-->  .build/gg.js         gg's hand-written Ruby SDK
//   src/library.rb --this script-->  .build/libraries.js  the libraries a program may `require`
//
// Both are compiled by the SAME pinned Opal that compiles a model's program on the host, out of
// `packages/gg-sandbox-ruby/opal-version.sh`, because a program and the SDK it calls have to be
// lowered by one compiler against one runtime. `build.sh` vendors that Opal (from npm) and the
// Ruby sources of the libraries (from the Opal gem of the same release) before running this.
//
// # What `library.rb` decides
//
// The library set is a **bake-time fact about this artifact**, exactly as it is for the Python
// guest: what a program can `require` is what was compiled into `libraries.js` here, and nothing
// else. `src/library.rb` is the one file that says which, and it says it as ordinary `require`
// lines under `# --- Heading ---` comments — which `tools/signatures.rb` reads back out as the
// catalogue's `libraries` section, so what a model is told it may require is read off the file
// that decides it.
//
// A library's own dependencies are resolved by **running** the require rather than by scanning for
// one: each declared module is compiled, then loaded into a clean Opal in a fresh `vm` context, and
// a `LoadError` naming something that is not there is answered by compiling that too. The loop
// stops when everything the manifest declares loads. That is why a bump to the pinned Opal cannot
// quietly leave a library half-baked: it either loads here or the build fails.
//
// # Usage
//
//   packages/gg-sandbox-ruby/build.sh
//
// which vendors both sets of sources first.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = path.join(PACKAGE_DIR, ".build");

/** Where `build.sh` vendored the pinned npm packages (Opal's runtime and its self-hosted compiler). */
const VENDOR = process.env.GG_RUBY_VENDOR ?? path.join(BUILD_DIR, "node_modules");

/** Where `build.sh` unpacked the Opal gem of the same release, for the libraries' Ruby sources. */
const SOURCES = process.env.GG_OPAL_SOURCES ?? path.join(BUILD_DIR, "opal-gem");

/**
 * gg's SDK, in load order.
 *
 * Concatenated rather than compiled file by file, because Opal's `require` resolves against a
 * module registry this build has no reason to populate: the SDK is one unit and its files have one
 * order. `scope.rb` is last because it names every other module at load.
 */
const SDK = [
  "gg/value.rb",
  "gg/errors.rb",
  "gg/types.rb",
  "gg/wire.rb",
  "gg/catalogue.rb",
  "gg/lib.rb",
  "gg/helpers.rb",
  "gg/session.rb",
  "gg/tools/shell.rb",
  "gg/tools/files.rb",
  "gg/tools/skills.rb",
  "gg/tools/memories.rb",
  "gg/tools/tasks.rb",
  "gg/tools/board.rb",
  "gg/tools/context.rb",
  "gg/tools/delegation.rb",
  "gg/tools/views.rb",
  "gg/tools/programs.rb",
  "gg/tools/docs.rb",
  "gg/scope.rb",
];

/**
 * Corelib that is baked AND loaded, rather than left for a program to require.
 *
 * `case … in` is Ruby 3 syntax rather than a library, and Opal lowers it to a call into
 * `PatternMatching` — which the npm runtime bundle does not carry. Without this a model that wrote
 * an ordinary Ruby 3 pattern would get `uninitialized constant PatternMatching`, which is a
 * sentence about gg's build rather than about its program. Nothing else belongs here: a library a
 * Ruby programmer requires should be required.
 */
const PRELOADED = ["corelib/pattern_matching"];

/** One vendored file, or a readable failure naming what to run. */
function read(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing — run packages/gg-sandbox-ruby/build.sh, which vendors it`);
  }
  return fs.readFileSync(file, "utf8");
}

/** Opal's compiler, loaded once in this process. */
function opalCompiler() {
  const load = (file) => vm.runInThisContext(read(path.join(VENDOR, file)), { filename: file });
  load("opal-runtime/src/opal.js");
  load("opal-compiler/src/opal-builder.js");
  globalThis.Opal.require("corelib/string/unpack");
  globalThis.Opal.require("opal/compiler");
  const Opal = globalThis.Opal;
  return Opal.const_get_qualified(Opal.const_get_relative([], "Opal"), "Compiler");
}

const Compiler = opalCompiler();

/**
 * Compile one Ruby source. `requirable` wraps it as an `Opal.modules[name]` a `require` can find.
 *
 * The options match the ones the HOST compiles a model's program with, in
 * `tools/compiler.mjs`'s driver, and they have to: a program and the SDK it calls are lowered by
 * one compiler against one runtime, so a promise that holds on one side and not the other is worse
 * than no promise. `arity_check` in particular is what makes `fs.read_file()` with no argument
 * `ArgumentError: [GG::Files.read_file] wrong number of arguments (given 0, expected 1)` instead of
 * a `nil` path that crosses the membrane and comes back as
 * `TypeError: expected a string, received [undefined]` — a sentence about the wire, for a mistake
 * in the program.
 *
 * It is on for the libraries too, not only for gg's SDK, so the rule has no exception a model has
 * to learn: **everything gg compiles is arity-checked**. What gg does not compile is Opal's own
 * corelib — `Array`, `Hash`, `String`, `Integer` arrive precompiled inside `opal-runtime`'s
 * `opal.js` and are checked by whatever Opal built them with, which is nothing. That boundary is
 * recorded for the model in `apps/docs/src/content/docs/gg/program-languages.md` beside the other
 * Opal divergences rather than papered over here.
 */
function compile(source, file, requirable) {
  const options = { file, enable_source_location: true, arity_check: true };
  if (requirable) options.requirable = true;
  return String(Compiler.$new(source, globalThis.Opal.hash(options)).$compile());
}

/** Where a library's Ruby source lives in the unpacked gem: `stdlib/` for a library, `opal/` for corelib. */
function librarySource(name) {
  for (const root of ["stdlib", "opal"]) {
    const file = path.join(SOURCES, root, `${name}.rb`);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return undefined;
}

/**
 * The manifest: each `# --- Heading ---` and the `require`s filed under it.
 *
 * Deliberately strict. A `require` before any heading, a duplicate, or anything other than a plain
 * string literal fails the build rather than landing in the catalogue ungrouped — the reader of
 * that section is a model, and "everything else in the file" is not a group.
 */
function manifest() {
  const source = read(path.join(PACKAGE_DIR, "src", "library.rb"));
  const groups = [];
  const seen = new Set();
  let current;
  for (const line of source.split("\n")) {
    const heading = /^#\s*---\s*(.+?)\s*---\s*$/.exec(line);
    if (heading) {
      current = { group: heading[1], modules: [] };
      groups.push(current);
      continue;
    }
    const required = /^require\s+"([^"]+)"\s*$/.exec(line);
    if (!required) {
      if (/^\s*require/.test(line)) throw new Error(`src/library.rb: unreadable require: ${line}`);
      continue;
    }
    if (current === undefined) {
      throw new Error(`src/library.rb: \`require "${required[1]}"\` sits under no --- heading ---`);
    }
    if (seen.has(required[1])) throw new Error(`src/library.rb: ${required[1]} is required twice`);
    seen.add(required[1]);
    current.modules.push(required[1]);
  }
  if (groups.length === 0) throw new Error("src/library.rb declares no libraries at all");
  return groups;
}

/**
 * Compile every declared library, and everything each of them requires, by loading the result into
 * a clean Opal and answering each `LoadError` with another compile.
 */
function libraries(declared) {
  const compiled = new Map();
  const want = [...declared];
  for (let attempt = 0; attempt < 64; attempt += 1) {
    for (const name of want) {
      if (compiled.has(name)) continue;
      const source = librarySource(name);
      if (source === undefined) {
        throw new Error(`no Ruby source for \`require "${name}"\` in the vendored Opal gem`);
      }
      compiled.set(name, compile(source, `${name}.rb`, true));
    }
    const missing = unresolved(compiled, declared);
    if (missing.length === 0) return compiled;
    for (const name of missing) if (!want.includes(name)) want.push(name);
  }
  throw new Error("the library set did not settle after 64 rounds of dependency resolution");
}

/** Every module a clean Opal could not find while requiring `declared`, one round's worth. */
function unresolved(compiled, declared) {
  const context = vm.createContext({ console });
  vm.runInContext(read(path.join(VENDOR, "opal-runtime/src/opal.js")), context, {
    filename: "opal.js",
  });
  for (const source of compiled.values()) vm.runInContext(source, context, { filename: "lib.js" });
  const missing = new Set();
  for (const name of [...declared, ...PRELOADED]) {
    try {
      context.Opal.require(name);
    } catch (thrown) {
      const message = String(thrown && thrown.message);
      const match = /cannot load such file -- (\S+)/.exec(message);
      if (!match) throw new Error(`\`require "${name}"\` failed in a clean Opal: ${message}`);
      missing.add(match[1]);
    }
  }
  return [...missing];
}

const declared = manifest().flatMap((group) => group.modules);
const compiled = libraries([...declared, ...PRELOADED]);

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(
  path.join(BUILD_DIR, "libraries.js"),
  [
    "// The libraries a gg Ruby program may require, compiled by packages/gg-sandbox-ruby/tools/guest.mjs",
    "// from the set packages/gg-sandbox-ruby/src/library.rb declares. Do not edit.",
    ...compiled.values(),
    // Loaded rather than merely defined: see PRELOADED above.
    ...PRELOADED.map((name) => `Opal.require(${JSON.stringify(name)});`),
    "",
  ].join("\n"),
);

const sdk = SDK.map((file) => read(path.join(PACKAGE_DIR, "src", file))).join("\n");
fs.writeFileSync(
  path.join(BUILD_DIR, "gg.js"),
  [
    "// gg's Ruby SDK, compiled by packages/gg-sandbox-ruby/tools/guest.mjs from",
    "// packages/gg-sandbox-ruby/src/gg/. Do not edit: it is generated.",
    compile(sdk, "gg.rb", false),
    "",
  ].join("\n"),
);

process.stdout.write(
  `Wrote .build/libraries.js (${compiled.size} modules) and .build/gg.js (${SDK.length} sources).\n`,
);
