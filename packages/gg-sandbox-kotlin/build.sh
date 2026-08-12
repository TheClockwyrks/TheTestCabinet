#!/usr/bin/env bash
# Compile the Kotlin program language's SDK into the jar gg carries inside its own binary:
# `$GG_ARTIFACTS_OUT_DIR/kotlin.sdk.jar`.
#
# WHY A JAR. Kotlin reaches a library through the classpath, so gg puts this one on the classpath of
# both compilers a program passes through — the Kotlin compiler's, so a model's `fs.readFile("x")`
# type-checks, and TeaVM's, so the bytecode behind it is translated. A jar is the only shape a
# classpath entry can take that is one file.
#
# WHY IT RIDES INSIDE gg's BINARY rather than being installed beside TeaVM in the toolchain image,
# which is the same argument PureScript's library tarball and the Java arm's SDK make: the image is
# built separately from the binary that runs in it, so an SDK living there could be a different
# vintage from the gg describing it — and a model shown one surface in its prompt and compiled
# against another is the failure this whole seam is built to prevent. Built here, the jar is compiled
# out of the same `src/` that `crates/gg/build.rs` reflects this arm's catalogue from, on the same
# build, so the library and the description of it cannot be two vintages.
#
# TWO FLAGS THAT ARE GATES RATHER THAN SETTINGS.
#
#   -Xexplicit-api=strict  Kotlin's own public-API completeness check: every declaration a model can
#                          see must state its visibility and its return type. It is this language's
#                          nearest thing to javac's `-Xdoclint`, and it is what stops an inferred
#                          return type from reaching the catalogue as whatever the reflector guessed.
#   -Werror                because everything the compiler warns about in this SDK — an unused
#                          parameter, a deprecated call — would be a defect in a surface a model
#                          reads.
#
# `-jvm-target 21` for the reason `crates/gg/src/sandbox/checkers/kotlin.compiler.java` compiles a
# model's program with it: TeaVM reads class files with a bundled ASM, and a newer class-file version
# fails with a message no model could act on. The Java arm's `build.sh` writes the same number as a
# literal, for the same reason, beside the same pin.
#
# REPRODUCIBLE. `jar --date` fixes every entry's timestamp and the file list is sorted, so two builds
# of identical sources produce identical bytes. That is a nice property and it is no longer
# load-bearing: it existed so that CI could re-cut this jar and diff it against a committed copy,
# and there is no committed copy — see the Java arm's `build.sh`, whose committed jar was provably
# stale when that gate was deleted.
#
# NOBODY HAS TO REMEMBER TO RUN THIS. `crates/gg-sandbox-artifacts/kotlin` runs it as part of
# building `test-cabinet-gg`, whenever this package's `src/`, this script or `kotlin-version.sh`
# moves. Running it by hand is for reading what it emitted.
#
# Usage:
#   scripts/gg-artifacts.sh                                      # every arm, into one directory
#   GG_ARTIFACTS_OUT_DIR=<dir> packages/gg-sandbox-kotlin/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# The destination, which is required and has no default — see the file itself for why.
# shellcheck source=scripts/gg-artifacts-out-dir.sh
source "$ROOT/scripts/gg-artifacts-out-dir.sh"
OUT="$GG_ARTIFACTS_OUT_DIR/kotlin.sdk.jar"

KOTLIN_DIR="${KOTLIN_INSTALL_DIR:-$HOME/.local/share/gg-kotlin}"
JAVA_DIR="${JAVA_INSTALL_DIR:-$HOME/.local/share/gg-java}"
JAVA="${TCAB_GG_JAVA:-$JAVA_DIR/jdk/bin/java}"
JAR="${TCAB_GG_JAR:-$JAVA_DIR/jdk/bin/jar}"
KOTLIN_LIBS="${TCAB_GG_KOTLIN_LIBS:-$KOTLIN_DIR/libs}"
TEAVM_LIBS="${TCAB_GG_TEAVM:-$JAVA_DIR/libs}"

if [ ! -x "$JAVA" ]; then
	echo "error: no java at $JAVA — run scripts/ci/install-kotlin.sh" >&2
	exit 1
fi
if [ ! -d "$KOTLIN_LIBS" ]; then
	echo "error: no Kotlin jars at $KOTLIN_LIBS — run scripts/ci/install-kotlin.sh" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

COMPILER="$(find "$KOTLIN_LIBS" -name '*.jar' | sort | tr '\n' ':')"
# What the SDK is compiled AGAINST: the standard library a model's program also gets, plus TeaVM's
# annotations and JavaScript types, which is what the bridge is written in and what a program never
# sees. Deliberately not the compiler's own classpath — this SDK must be reachable from exactly what
# a program is compiled against, and nothing else.
STDLIB="$(find "$KOTLIN_LIBS" -name 'kotlin-stdlib-*.jar' | head -n1)"
TEAVM="$(find "$TEAVM_LIBS" -name '*.jar' | sort | tr '\n' ':')"

mapfile -t SOURCES < <(find "$HERE/src" -name '*.kt' | sort)
"$JAVA" -cp "$COMPILER" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
	-classpath "$STDLIB:$TEAVM" \
	-d "$WORK/classes" \
	-jvm-target 21 \
	-module-name gg \
	-no-stdlib -no-reflect \
	-Xexplicit-api=strict \
	-Werror \
	"${SOURCES[@]}"

# A fixed timestamp and a sorted entry list: two builds of the same sources are the same bytes.
#
# EVERY file rather than every `.class`, and that is not tidiness. Kotlin writes
# `META-INF/gg.kotlin_module` beside the class files, and it is what tells the compiler which facade
# class a package's TOP-LEVEL declarations live in — so a jar without it compiles, ships, and answers
# every `fs.readFile` in every program with `Unresolved reference 'fs'`. `-module-name` pins its name,
# because the default is the compiler's own idea of the module and would move.
mapfile -t ENTRIES < <(cd "$WORK/classes" && find . -type f | sed 's|^\./||' | sort)
"$JAR" --create --file "$WORK/gg-sdk.jar" --date "2026-01-01T00:00:00Z" \
	-C "$WORK/classes" "${ENTRIES[0]}" >/dev/null
for ENTRY in "${ENTRIES[@]:1}"; do
	"$JAR" --update --file "$WORK/gg-sdk.jar" --date "2026-01-01T00:00:00Z" \
		-C "$WORK/classes" "$ENTRY" >/dev/null
done

mv "$WORK/gg-sdk.jar" "$OUT"
echo "wrote $OUT ($(wc -c <"$OUT") bytes, ${#ENTRIES[@]} entries)"
