# `gg-sandbox-jvm`

**What both JVM program languages compile.** Not a package with a build of its own: each arm's
`build.sh` reads these two trees and compiles them into its own SDK jar.

| | |
| --- | --- |
| [`src/gg/internal/Abi.java`](src/gg/internal/Abi.java) | the canonical ABI for `test-cabinet:gg/wire`, and the arena rule that makes it safe under a compacting collector |
| [`src/gg/internal/Value.java`](src/gg/internal/Value.java) | one value on the wire: the small alphabet records, variants, enums, options and lists are written in |
| [`src/gg/internal/Frames.java`](src/gg/internal/Frames.java) | the request and response frames, and the encoding that travels inside them |
| [`src/gg/internal/MathImports.java`](src/gg/internal/MathImports.java) | the TeaVM transformer that points `java.lang.Math` at gg's own host |
| [`vendor/`](vendor/) | one TeaVM runtime class, kept under its own licence, changed so an uncaught exception prints what was thrown as well as where |

## Why it is shared rather than translated

A [Java](../gg-sandbox-java/) and a [Kotlin](../gg-sandbox-kotlin/) program are both compiled to
bytecode and then to a WebAssembly component by TeaVM, and both reach gg through one imported
function — there is no `wit-bindgen` for the JVM. The canonical ABI under that door and the encoding
inside it are decided by gg's own WIT rather than by which compiler wrote the bytecode, so a second
copy would be a second implementation of one contract to keep in step, forever, by hand.

What is **not** here is the one function above the frames that raises a failure. Each arm's
`ApiError` is a model-facing class with its own documentation and its own catalogue entry, so
`gg.internal.Coding` on the Java side and `gg.internal.ggCall` on the Kotlin side are each that
arm's own.

Everything here is `gg.internal`, which no catalogue describes and no prompt names. See
`Abi.java`'s class note for what that does and does not mean.
