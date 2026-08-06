// Emit the two COMMITTED artifacts gg compiles a Ruby program with.
//
// A gg Ruby program is compiled to JavaScript BEFORE it crosses the membrane, by Opal, on the host:
// `crates/gg/src/sandbox/language/ruby.compile.rs` runs this bundle over the model's reply and hands
// the result to the Ruby guest. That compile happens INSIDE THE RUN CONTAINER, where the only things
// gg can rely on are the `node` every run image already ships and gg's own single copied-in binary.
// So the compiler travels with gg, exactly as the TypeScript checker does:
//
//   opal-runtime/src/opal.js          --this script-->  checkers/ruby.opal.cjs
//   opal-compiler/src/opal-builder.js --this script-->  (the same file; it is one bundle)
//                                     --this script-->  checkers/ruby.compiler.json
//
// under `crates/gg/src/sandbox/`, where `ruby.compile.rs` embeds both with `include_str!`. Committed
// rather than fetched, for the reason every other guest artifact is: a run container has no npm and
// may have no network, and a compiler resolved from the workspace would be whatever version the
// model happened to install.
//
// # Why Opal ships as one file, and why that file is CommonJS
//
// Opal's self-hosted compiler is Ruby compiled to JavaScript, and it needs Opal's runtime to run at
// all — the compiler is an Opal program like any other. Two files would mean two writes, two opens
// and an ordering rule; one concatenation is the same bytes with none of that. The extension is
// `.cjs` rather than `.js` so the file is CommonJS wherever it is written, whatever a `package.json`
// somewhere above it happens to say about module type: the shared toolchain directory it is placed
// in is not a package, and a bundle that is read as an ES module cannot use `require` and does not
// run.
//
// The driver at the end of the bundle is what makes it a command rather than a library. gg invokes
// `node ruby.opal.cjs <input.rb> <output.js> ` and reads the exit code:
//
//   0   compiled; the JavaScript is at <output.js>
//   20  Ruby the parser rejected; the diagnostic is on stdout
//   21  a compilation Opal refused for another reason; the diagnostic is on stdout
//   any other code  the compiler could not finish, which is NOT the model's failure
//
// That split is the one gg's prepare step cannot infer for itself, so the driver states it: exit
// status alone cannot tell "your program has an error" from "I could not run", and reporting the
// second as the first sends a model rewriting a program nothing ever read.
//
// # Usage
//
//   packages/gg-sandbox-ruby/compiler.sh
//
// which vendors the pinned npm packages first and then runs this. Its outputs are committed with the
// change that motivated them, and `scripts/ci/contract-drift.sh` regenerates them to prove they are
// current.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "crates", "gg", "src", "sandbox", "checkers");

/** Where `compiler.sh` vendored the pinned packages. */
const VENDOR = process.env.GG_RUBY_VENDOR ?? path.join(PACKAGE_DIR, ".build", "node_modules");

/**
 * The two sources the bundle is made of, in load order.
 *
 * `opal.js` is the runtime — the corelib, the method dispatch, the exception hierarchy — and
 * `opal-builder.js` is Opal's own compiler, itself compiled by Opal. Neither can be loaded second.
 */
const SOURCES = [
  path.join(VENDOR, "opal-runtime", "src", "opal.js"),
  path.join(VENDOR, "opal-compiler", "src", "opal-builder.js"),
  path.join(VENDOR, "opal-compiler", "src", "opal-source-maps.js"),
];

/**
 * What has to be `require`d out of `opal-builder.js` before the compiler can be used.
 *
 * `opal-builder.js` *defines* Opal's modules; it does not run them. `opal/compiler` is the one gg
 * uses, and `corelib/string/unpack` is a real dependency of the lexer rather than a precaution — the
 * parser calls `String#unpack` on its source buffer, and without this line the first compilation
 * fails with "To use String#unpack, you must first require 'corelib/string/unpack'", which is a
 * toolchain failure that looks exactly like a broken program.
 *
 * `opal/source_map` is what makes a run-time error point at the model's own line: see {@link DRIVER}.
 */
const REQUIRES = ["corelib/string/unpack", "opal/compiler", "opal/source_map"];

/**
 * The command half of the bundle: read a Ruby file, write the JavaScript, and say which of the three
 * things happened in the exit code.
 *
 * `enable_source_location` is on. It costs about a tenth of the output's size and it is the only
 * thing that puts the Ruby file and line into the artifact at all — `Method#source_location` inside
 * a program answers truthfully with it and lies without it.
 *
 * **A source map is appended to every compile**, and it is what makes a run-time error point at the
 * line the model wrote. The guest evaluates JavaScript, so a raise carries a position in the
 * *compiled* file; the Ruby guest reads this map back — lazily, only when something raised — and
 * reports the Ruby line instead. Measured at 0.4 ms to produce. `sourcesContent` is dropped before
 * it is encoded: the guest never needs the Ruby back, gg already holds the program, and it is by
 * far the largest thing in the map.
 *
 * The file a diagnostic is located in is the input's own base name, so the host decides what the
 * model sees (`program.rb`, `module.rb`) and this file decides nothing.
 */
const DRIVER = `
// --- gg's compile driver ----------------------------------------------------
// Generated by packages/gg-sandbox-ruby/tools/compiler.mjs. See its header for the protocol.
(function () {
  "use strict";
  var fs = require("fs");
  var path = require("path");
  var input = process.argv[2];
  var output = process.argv[3];
  if (!input || !output) {
    process.stderr.write("usage: node ruby.opal.cjs <input.rb> <output.js>\\n");
    process.exit(64);
  }
  var file = path.basename(input);
  var source = fs.readFileSync(input, "utf8");
  var Opal = globalThis.Opal;
  var Compiler = Opal.const_get_qualified(Opal.const_get_relative([], "Opal"), "Compiler");

  // The line a diagnostic points at, out of the first frame of the Ruby backtrace
  // ("program.rb:2:in \\\`y = 2 +* 3'"). Opal's message carries no coordinates of its own.
  function locate(thrown) {
    var backtrace;
    try { backtrace = thrown.$backtrace(); } catch (ignored) { return 0; }
    if (!backtrace || !backtrace.length) return 0;
    var match = /^([^:]+):(\\d+)(?::|$)/.exec(String(backtrace[0]));
    if (!match || match[1] !== file) return 0;
    return Number(match[2]);
  }

  // What the model reads: the compiler's own message at the compiler's own coordinates, with the
  // offending line of the model's own text under it.
  function diagnose(thrown, line) {
    var message;
    try { message = String(thrown.message); } catch (ignored) { message = String(thrown); }
    if (line <= 0) return file + ": " + message + "\\n";
    var text = source.split("\\n")[line - 1];
    var rendered = file + ":" + line + ": " + message + "\\n";
    if (text !== undefined) rendered += "  " + text.replace(/\\s+$/, "") + "\\n";
    return rendered;
  }

  // The map that turns a position in the compiled JavaScript back into the model's own line,
  // appended as a data URL. A map that cannot be produced costs the location and nothing else.
  function sourceMappingURL(compiler) {
    try {
      var map = JSON.parse(String(compiler.$source_map().$to_json()));
      delete map.sourcesContent;
      var encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64");
      return "\\n//# sourceMappingURL=data:application/json;charset=utf-8;base64," + encoded + "\\n";
    } catch (ignored) {
      return "";
    }
  }

  var compiled;
  try {
    var compiler = Compiler.$new(source, Opal.hash({ file: file, enable_source_location: true }));
    compiled = String(compiler.$compile()) + sourceMappingURL(compiler);
  } catch (thrown) {
    // A throw with no Ruby class is the compiler itself breaking, not the program being rejected.
    // Rethrowing it makes node exit non-zero with the stack on stderr, which is exactly what gg
    // reads as a toolchain failure — the one band that is never shown to the model as its own.
    if (!thrown || !thrown.$$class) throw thrown;
    process.stdout.write(diagnose(thrown, locate(thrown)));
    process.exit(thrown.$$class.$$name === "SyntaxError" ? 20 : 21);
  }
  fs.writeFileSync(output, compiled);
  process.exit(0);
})();
`;

/** One vendored source, or a readable failure naming what to run. */
function read(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} is missing — run packages/gg-sandbox-ruby/compiler.sh, which vendors it first`,
    );
  }
  return fs.readFileSync(file, "utf8");
}

const bundle = [
  "// The Opal compiler gg compiles a Ruby program with, cut from the pinned npm packages by",
  "// packages/gg-sandbox-ruby/tools/compiler.mjs. Do not edit: it is regenerated and diffed by",
  "// scripts/ci/contract-drift.sh.",
  ...SOURCES.map((file) => read(file) + "\n;\n"),
  REQUIRES.map((name) => `Opal.require(${JSON.stringify(name)});`).join("\n"),
  DRIVER,
].join("\n");

// Ask the bundle what Opal it is rather than reading a version out of a package manifest: the
// artifact is what compiles a model's program, so the artifact is what has to be recorded.
const context = vm.createContext({ console, process });
vm.runInContext(bundle.slice(0, bundle.indexOf(DRIVER)), context, { filename: "ruby.opal.cjs" });
const opal = context.Opal;
const version = String(
  opal.const_get_qualified(opal.const_get_relative([], "Opal"), "VERSION"),
);
const rubyVersion = String(opal.const_get_relative([], "RUBY_VERSION"));

const manifest = {
  language: "ruby",
  opal: version,
  rubyVersion,
  opalCompilerPackage: JSON.parse(read(path.join(VENDOR, "opal-compiler", "package.json"))).version,
  opalRuntimePackage: JSON.parse(read(path.join(VENDOR, "opal-runtime", "package.json"))).version,
  generatedFrom: "packages/gg-sandbox-ruby/tools/compiler.mjs",
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "ruby.opal.cjs"), bundle);
fs.writeFileSync(path.join(OUT_DIR, "ruby.compiler.json"), `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(
  `Wrote ${path.join(OUT_DIR, "ruby.opal.cjs")} (${bundle.length} bytes, Opal ${version}).\n`,
);
