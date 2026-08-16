#!/usr/bin/env bash
# Compile the Java program language's SDK into the jar gg carries inside its own binary:
# `$GG_ARTIFACTS_OUT_DIR/java.sdk.jar`.
#
# WHY A JAR. Java reaches a library through the classpath, so gg puts this one on the classpath
# of both compilers a program passes through — javac's, so a model's `fs.readFile("x")`
# type-checks, and TeaVM's, so the bytecode behind it is translated. A jar is the only shape a
# classpath entry can take that is one file.
#
# WHY IT RIDES INSIDE gg's BINARY rather than being installed beside TeaVM in the toolchain image,
# which is the same argument PureScript's library tarball makes: the image is built separately
# from the binary that runs in it, so an SDK living there could be a different vintage from the gg
# describing it — and a model shown one surface in its prompt and compiled against another is the
# failure this whole seam is built to prevent. Built here, the jar is compiled out of the same
# `src/gg/` that `crates/gg/build.rs` reflects this arm's catalogue from, on the same build, so the
# library and the description of it cannot be two vintages.
#
# REPRODUCIBLE. `jar --date` fixes every entry's timestamp and the file list is sorted, so two
# builds of identical sources produce identical bytes. That is a nice property and it is no longer
# load-bearing: it existed so that CI could re-cut this jar and diff it against a committed copy,
# and there is no committed copy. (That gate is worth remembering rather than mourning. It was RED,
# on the commit that added `@throws` prose to three SDK files without re-cutting the jar — which is
# precisely the failure it was built to catch, caught after the fact, by a check somebody had to
# run. Cutting the jar inside `cargo build` makes the state unreachable instead.)
#
# NOBODY HAS TO REMEMBER TO RUN THIS. `crates/gg-sandbox-artifacts/java` runs it as part of building
# `test-cabinet-gg`, whenever this package's `src/`, this script or `java-version.sh` moves.
# Running it by hand is for reading what it emitted.
#
# Usage:
#   scripts/gg-artifacts.sh                                    # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-java/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"
OUT="$GG_ARTIFACTS_OUT_DIR/java.sdk.jar"

# shellcheck source=packages/gg-sandbox-java/java-version.sh
source "$HERE/java-version.sh"
# shellcheck source=scripts/gg-downloads.sh
source "$ROOT/scripts/gg-downloads.sh"

INSTALL_DIR="${JAVA_INSTALL_DIR:-$HOME/.local/share/gg-java}"
JAVAC="${TCAB_GG_JAVAC:-$INSTALL_DIR/jdk/bin/javac}"
JAR="${TCAB_GG_JAR:-$INSTALL_DIR/jdk/bin/jar}"
LIBS="${TCAB_GG_TEAVM:-$INSTALL_DIR/libs}"

if [ ! -x "$JAVAC" ]; then
	echo "error: no javac at $JAVAC — run scripts/ci/install-java.sh" >&2
	exit 1
fi
if [ ! -d "$LIBS" ]; then
	echo "error: no TeaVM jars at $LIBS — run scripts/ci/install-java.sh" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CLASSPATH="$(find "$LIBS" -name '*.jar' | sort | tr '\n' ':')"

# `--release 21` for the reason `crates/gg/src/sandbox/checkers/java.compiler.java` compiles a
# model's program with it: TeaVM reads class files with a bundled ASM, and a newer class-file
# version fails with a message no model could act on. `-g` so a stack frame inside the SDK still
# carries a line number.
#
# Each source list is sorted so the compile — and therefore the class files — do not depend on the
# order the filesystem happened to hand them back.
#
# TWO PASSES, because `vendor/` is not gg's text. It holds one third-party runtime class, kept under
# its own licence and changed in exactly one place so that an uncaught exception says WHAT was thrown
# as well as where; it is compiled into this jar because the jar is what goes on TeaVM's program
# classpath, AHEAD of TeaVM's own jars (see `java.compile.rs`). `-Xlint:all -Werror` is gg's gate on
# gg's own sources and is not applied to it: upstream text is kept as upstream wrote it rather than
# edited to satisfy a lint. The file's own header carries the whole argument.
mapfile -t OWN < <(find "$HERE/src" -name '*.java' | sort)
mapfile -t VENDORED < <(find "$HERE/vendor" -name '*.java' | sort)
"$JAVAC" -Xlint:all -Werror -g --release 21 -cp "$CLASSPATH" -d "$WORK/classes" "${OWN[@]}"
"$JAVAC" -nowarn -g --release 21 -cp "$CLASSPATH" -d "$WORK/classes" "${VENDORED[@]}"

# A second pass over the MODEL-FACING package alone, with the JDK's own documentation checker on:
# an undocumented parameter, a `@param` naming an argument the method does not take, a missing
# `@return`, a broken `{@link}`. Those comments are what `signatures.sh` reflects the catalogue
# from, so two independent readings of them have to agree before anything a model reads is
# written — and the reflector refuses to emit a blank, so between them a gap lands on the author.
#
# `gg.internal` is deliberately outside it: nothing there is model-facing, and it is resolved from
# the class files the pass above produced rather than from source, which is what keeps doclint off
# it. The file list is found rather than globbed, because the model-facing surface is twelve
# packages deep and a flat `src/gg/*.java` would have quietly stopped checking eleven of them.
# `-d` throws the second pass's output away; the jar is built from the first.
mapfile -t DOCUMENTED < <(find "$HERE/src/gg" -name '*.java' -not -path "$HERE/src/gg/internal/*" | sort)
"$JAVAC" -Xdoclint:all/protected -Werror -g --release 21 \
	-cp "$CLASSPATH:$WORK/classes" -d "$WORK/lint" "${DOCUMENTED[@]}"

# A fixed timestamp and a sorted entry list: two builds of the same sources are the same bytes.
mapfile -t ENTRIES < <(cd "$WORK/classes" && find . -name '*.class' | sed 's|^\./||' | sort)
"$JAR" --create --file "$WORK/gg-sdk.jar" --date "2026-01-01T00:00:00Z" \
	-C "$WORK/classes" "${ENTRIES[0]}" >/dev/null
for ENTRY in "${ENTRIES[@]:1}"; do
	"$JAR" --update --file "$WORK/gg-sdk.jar" --date "2026-01-01T00:00:00Z" \
		-C "$WORK/classes" "$ENTRY" >/dev/null
done

mv "$WORK/gg-sdk.jar" "$OUT"
echo "wrote $OUT ($(wc -c <"$OUT") bytes, ${#ENTRIES[@]} classes)"

# java.adapter.wasm — COPIED FROM A CACHE, NOT DOWNLOADED on a machine an installer has touched.
# TeaVM's `WEBASSEMBLY_WASI` backend emits a core module importing the preview1 snapshot (four
# functions: `clock_time_get`, `args_sizes_get`, `args_get`, `fd_write`); this is what implements
# them in terms of the preview 2 interfaces gg's linker provides. Without it the component would
# import a WASI generation the host does not have. See `jvm.rs`.
cp "$(gg_wasmtime_adapter "$GG_WASMTIME_ADAPTER_VERSION" "$(gg_wasmtime_adapter_url)")" \
	"$GG_ARTIFACTS_OUT_DIR/java.adapter.wasm"
test -s "$GG_ARTIFACTS_OUT_DIR/java.adapter.wasm"
echo "wrote $GG_ARTIFACTS_OUT_DIR/java.adapter.wasm (adapter $GG_WASMTIME_ADAPTER_VERSION)"
