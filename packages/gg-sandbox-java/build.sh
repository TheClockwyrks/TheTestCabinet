#!/usr/bin/env bash
# Compile the Java program language's SDK and commit it as the jar gg carries inside its own
# binary: crates/gg/src/sandbox/checkers/java.sdk.jar.
#
# WHY A JAR, AND WHY COMMITTED. Java reaches a library through the classpath, so gg puts this
# one on the classpath of both compilers a program passes through — javac's, so a model's
# `fs.readFile("x")` type-checks, and TeaVM's, so the bytecode behind it is translated. A jar is
# the only shape a classpath entry can take that is one file.
#
# It is committed rather than installed beside TeaVM in the toolchain image for the reason
# PureScript's library tarball is committed rather than shipped in the image: the image is built
# separately from the binary that runs in it, so an SDK living there could be a different vintage
# from the gg describing it — and a model shown one surface in its prompt and compiled against
# another is the failure this whole seam is built to prevent. Committed, the SDK and the
# catalogue reflected from it move in one diff.
#
# REPRODUCIBLE. `jar --date` fixes every entry's timestamp and the file list is sorted, so two
# builds of identical sources produce identical bytes and `scripts/ci/contract-drift.sh` can
# rebuild this and diff it like every other generated artifact.
#
# Usage:
#   packages/gg-sandbox-java/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/crates/gg/src/sandbox/checkers/java.sdk.jar"

# shellcheck source=packages/gg-sandbox-java/java-version.sh
source "$HERE/java-version.sh"

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
# The source list is sorted so the compile — and therefore the class files — do not depend on the
# order the filesystem happened to hand them back.
mapfile -t SOURCES < <(find "$HERE/src" -name '*.java' | sort)
"$JAVAC" -Xlint:all -Werror -g --release 21 -cp "$CLASSPATH" -d "$WORK/classes" "${SOURCES[@]}"

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
