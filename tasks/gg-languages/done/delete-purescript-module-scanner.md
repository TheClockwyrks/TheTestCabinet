# Delete The PureScript Module Scanner

The PureScript arm reads a response's module header with a hand-written scanner.
Delete it and derive the module name from what `purs` emitted.

## Why it exists

`purs` files a module's compiled JavaScript under the module's own name, so the
esbuild entry point needs that name:

```rust
// purescript.compile.rs
let target = format!("./{OUTPUT_DIR}/{module}/index.js");
format!("import {{ main }} from {target:?};\n\nmain();\n")
```

gg leaves the header the model wrote in place so that every coordinate in a
diagnostic belongs to the model, then reads the name back out with
`module_name`, `module_name_span` and `skip_trivia`.

## Faults

`skip_trivia` advances a byte at a time and re-slices `source[scan..]`, which
panics on the first multi-byte character inside a leading `{- -}` comment. An
em-dash, an accented letter or an emoji in a comment is enough:

```
OK    {- fine -}
PANIC {- Snake — grid -}
PANIC {- naïve -}
PANIC {- ship it 🚀 -}
```

`compile_program` calls `refuse_a_program_taking_a_modules_name` before `purs`
runs, so the panic arrives as `SandboxError::Host`, which `is_host_fault` routes
to `FatalFault::HostFault`. The run ends and the model is told nothing.

`is_module_name_byte` accepts ASCII identifier bytes only, so a Unicode module
name that `purs` accepted raises a fatal `PrepareFailure::Toolchain` afterwards.

## Design

Identify the response's module from the output tree. gg ships the library set
pre-compiled in `LIBRARIES_TAR_GZ` and links that output directory into the
workspace, so the module directory `purs` writes for the response is the one the
library set does not already claim.

Derive the entry point from that directory. The header stays the model's, and
nothing reads it.

## Module names repeat freely

The same module name is valid across responses, and across a response and a
loaded code module. Remove `refuse_a_program_taking_a_modules_name` and the
instruction it emits, and remove the collision paragraph from
`apps/docs/src/content/docs/gg/languages/purescript.md`.

Clearing the previous response's build output each turn is what keeps a repeated
name unambiguous. See `tasks/gg-sandbox/done/workspace-per-agent.md`.

## Done when

- [x] `module_name`, `module_name_span`, `skip_trivia` and `is_module_name_byte` are gone.
- [x] The esbuild entry point is derived from the output tree.
- [x] A response reusing a module name from an earlier response compiles and runs.
- [x] A response whose leading block comment holds non-ASCII text compiles and runs.
- [x] The unique-module-name instruction is gone from the arm and from the docs.
- [x] Gates green.
