#!/usr/bin/env bash
# Reflect the Java program language's signature catalogue out of the SDK's own Javadoc, and write
# it to crates/gg/src/sandbox/guests/java.signatures.json.
#
# WHY JAVADOC. Everything a model reads about this surface is written on the declaration it
# describes — a function's description in its doc comment, an argument's in that argument's
# `@param`, a record component's in the `@param` on the record, an enum constant's in the comment
# above it, an API object's on the field of `gg.Gg` that holds it — and the JDK's own doclet API
# is what reads all of it. Nothing here is prose typed into a table: the doclet refuses to emit a
# catalogue with a blank in it, so a missing `@param` is an error on the author rather than a gap
# a model discovers.
#
# `build.sh` compiles the same sources with `-Xdoclint:all -Werror`, which is the JDK's own
# completeness check over the same comments — an undocumented parameter, a `@param` naming an
# argument that is not there, a broken `{@link}` — so two independent readings have to agree
# before anything a model reads is written. (It lives there rather than here because doclint is a
# javac and standard-doclet option, and this runs a doclet of gg's own.)
#
# Usage:
#   packages/gg-sandbox-java/signatures.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/crates/gg/src/sandbox/guests/java.signatures.json"

# shellcheck source=packages/gg-sandbox-java/java-version.sh
source "$HERE/java-version.sh"

INSTALL_DIR="${JAVA_INSTALL_DIR:-$HOME/.local/share/gg-java}"
JAVAC="${TCAB_GG_JAVAC:-$INSTALL_DIR/jdk/bin/javac}"
JAVADOC="${TCAB_GG_JAVADOC:-$INSTALL_DIR/jdk/bin/javadoc}"
LIBS="${TCAB_GG_TEAVM:-$INSTALL_DIR/libs}"

if [ ! -x "$JAVADOC" ]; then
	echo "error: no javadoc at $JAVADOC — run scripts/ci/install-java.sh" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CLASSPATH="$(find "$LIBS" -name '*.jar' | sort | tr '\n' ':')"

# The doclet itself, compiled into a directory javadoc is pointed at. It is gg's own code and it
# runs on the developer's machine rather than in a run container, so there is nothing to commit.
"$JAVAC" -d "$WORK/doclet" "$HERE/tools/GgSignatures.java" "$HERE/tools/GgCatalogue.java"

"$JAVADOC" \
	-doclet tools.GgSignatures \
	-docletpath "$WORK/doclet" \
	-classpath "$CLASSPATH" \
	-sourcepath "$HERE/src" \
	-quiet \
	-o "$WORK/java.signatures.json" \
	--libraries "$HERE/libraries.txt" \
	gg

mv "$WORK/java.signatures.json" "$OUT"
echo "wrote $OUT ($(wc -c <"$OUT") bytes)"
