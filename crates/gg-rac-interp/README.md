# gg-rac-interp — the responses-as-code interpreter

The guest side of gg's **responses-as-code** sandbox. Under that capability a model
emits a small program — a **response as code** — instead of a batch of discrete tool
calls, and gg runs it in a wasmtime sandbox (the host lives in
[`crates/gg/src/rac.rs`](../gg/src/rac.rs)). This crate is the interpreter that runs
inside that sandbox.

Because a model cannot emit wasm directly, the faithful way to sandbox its arbitrary
control flow is a **trusted interpreter compiled to wasm**: this crate compiles to
`wasm32-unknown-unknown` and is loaded by the host under a wasmtime fuel + linear-memory
ceiling — the same pattern the [Foray](../foray-host) and [Lattice](../lattice-host)
hosts use for their guests, with one addition: the guest **imports** `gg.call_tool`, so
a tool call in a script reaches gg's real tools running in the container.

The document below is what a model is taught to emit.

## The language: `gg-script`

`gg-script` is a small imperative scripting language. Its runtime values are exactly
**JSON values** (`null`, booleans, numbers, strings, lists, maps), so a tool's
arguments and results flow through a program unchanged.

### Values

| Kind    | Literal examples                       |
| ------- | -------------------------------------- |
| null    | `null`                                 |
| bool    | `true`, `false`                        |
| number  | `42`, `3.14`, `0` (all IEEE-754 f64)   |
| string  | `"hello"`, `"a\nb"` (JSON escapes)     |
| list    | `[1, 2, 3]`, `[]`                      |
| map     | `{ path: "x", count: 3 }`, `{}`        |

Map keys may be bare identifiers or string literals; map literals and map iteration are
in **sorted key order** (deterministic).

### Statements

```
let name = expr;          // declare and bind a variable
name = expr;              // assign an existing variable
name[i] = expr;           // assign a list element
name.field = expr;        // assign a map field (creates the map if null)
expr;                     // evaluate for effect (e.g. a bare tool call)

if cond { .. } else { .. }        // else is optional; `else if` chains
while cond { .. }                 // repeat while cond is truthy
for item in iterable { .. }       // iterate a list, or a map's [key, value] pairs
return expr;   return;            // end the program with a value (or null)
```

`//` begins a line comment. Blocks are brace-delimited and introduce a scope.

### Expressions & operators

Precedence, lowest to highest: `||`, `&&`, `== !=`, `< <= > >=`, `+ -`, `* / %`, unary
`! -`, then postfix `f(x)` / `a[i]` / `a.b`.

- `+` adds two numbers, concatenates two strings (stringifying the other operand), or
  concatenates two lists.
- `- * / %` operate on numbers; `/ 0` and `% 0` fault.
- `== !=` are structural (numbers compared by value, so `1 == 1.0`); `< <= > >=` order
  numbers, or strings lexicographically.
- `&&` / `||` short-circuit and yield a boolean over **truthiness**: `false`, `null`,
  `0`, `""`, and empty lists/maps are falsy; everything else is truthy. `!x` negates
  truthiness.
- `a[i]` indexes a list (numeric, in range) or a map (string key; a missing key is
  `null`). `a.b` is sugar for `a["b"]`.

### Tool calls — the whole point

Any call whose name is **not a builtin** is a **tool call**, dispatched to the host:

```
let content = read_file({ path: "README.md" });
if content.ok {
    write_file({ path: "COPY.md", contents: content.output });
}
```

A tool call takes a **single map argument** (or none, meaning `{}`) and returns the
tool's result as a value of the shape

```
{ "ok": <bool>, "output": <string>, "summary": <string|null> }
```

so a program can branch on `result.ok` and read `result.output`. A tool **error** is an
ordinary value (`ok: false`) — it surfaces *into* the program rather than aborting it,
so a script can inspect it and recover. The exact tool names and argument shapes
available are the run's offered toolset, described to the model separately.

### Builtins (pure, run in-guest)

| Builtin                    | Meaning                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `len(x)`                   | length of a string / list / map                             |
| `keys(m)` / `values(m)`    | a map's keys (sorted) / values                              |
| `has(c, k)`                | whether a map has key `k` (or a list has index `k`)         |
| `get(c, k, default?)`      | safe access, returning `default` (or `null`) if absent      |
| `push(list, v)`            | a **new** list with `v` appended                            |
| `range(n)` / `range(a, b)` | `[0..n)` / `[a..b)` as a list of numbers                    |
| `contains(hay, needle)`    | substring test (strings) or membership test (lists)         |
| `str(x)` / `num(x)`        | stringify a value / parse a string (or number) to a number  |
| `type(x)`                  | the value's type name (`"number"`, `"list"`, …)             |
| `print(x)`                 | append a line to the program's log (returned for telemetry) |

### Worked example

```
// Read every source file, keep the ones that mention "TODO", and report them.
let files = list_dir({ path: "src" });
let flagged = [];
for entry in files.output {
    let f = read_file({ path: entry });
    if f.ok && contains(f.output, "TODO") {
        flagged = push(flagged, entry);
    }
}
print("flagged " + str(len(flagged)) + " files");
return flagged;
```

## Semantics & guarantees

- **Deterministic**: no clock, no randomness; map order is sorted. The same program and
  the same tool results always produce the same run.
- **Terminating**: every statement and loop iteration spends one step against a step
  budget; exhausting it stops the program with a `step_limit` failure. The host
  additionally caps the whole run with a wasmtime **fuel** ceiling and a linear-memory
  cap, so even a program that ignored the step budget cannot run away.
- **Never traps on a program bug**: a lexer/parser/runtime error is reported as a
  structured [outcome](#the-abi), not a wasm trap.

## The ABI

The guest is a plain `wasm32-unknown-unknown` core module (not a component).

Exports:

- `memory` — linear memory (emitted automatically for a `cdylib`).
- `alloc(len: i32) -> i32` — reserve `len` bytes in a guest-owned transfer buffer and
  return a pointer the host writes into. Used both to hand in the request and to hand
  back each tool result; the guest copies bytes out before the next `alloc`.
- `run_program(ptr: i32, len: i32) -> i64` — read the `len`-byte request JSON at `ptr`,
  run it, and return the outcome JSON's location packed as `(out_ptr << 32) | out_len`.

Import (module `gg`):

- `call_tool(name_ptr, name_len, args_ptr, args_len) -> i64` — the host reads the tool
  `name` and its `args` JSON out of guest memory, performs the call, writes the result
  JSON back into guest memory (via the guest's own `alloc`), and returns its packed
  `(ptr << 32) | len`.

The **request** is `{ "source": "<program>", "stepLimit"?: <u64> }`. The **outcome** is:

```jsonc
{
  "ok": true,                 // false on any failure
  "result": <value>,          // the program's return value (null on failure)
  "error": "<message>",       // present only on failure
  "failure": "lex" | "parse" | "runtime" | "step_limit",  // present only on failure
  "logs": ["<print output>", ...],
  "steps": <number>
}
```

The *tool calls* a program made are recorded by the **host** (it sees every
`call_tool`), so they are not repeated in the outcome.

## Building the committed `.wasm`

The host embeds the committed artifact at `crates/gg/src/rac/gg_rac_interp.wasm`.
Rebuild and re-commit it whenever anything under `src/` that affects the guest changes:

```sh
rustup target add wasm32-unknown-unknown   # once
crates/gg-rac-interp/build.sh              # builds --release for wasm and copies the artifact
```

Commit the refreshed `.wasm` together with the source change, exactly as the
`foray-ref-*` / `lattice-ref-*` guests are committed. The crate also builds natively as
an `rlib`, which is how the pure interpreter (lexer/parser/tree-walk) is unit-tested
against a mock tool host — no wasm toolchain and no network required.
