#!/usr/bin/env bash
# Install the Java program language's toolchain — a JDK and TeaVM's jars — so a machine
# running gg's test suite has the same compiler a gg run container does
# (containers/gg-toolchains/Dockerfile). Pinned to the versions in
# packages/gg-sandbox-java/java-version.sh, so every machine agrees.
#
# WHY A DIRECTORY RATHER THAN A BINARY ON PATH. gg's other installed arm, PureScript, is
# two executables and goes to $HOME/.local/bin, where PATH finds it. This arm is a JDK
# *and* ~29 MB of jars that have to be named on a classpath, and there is no PATH lookup
# for a directory — so it installs under one prefix and `crates/gg` looks there by name
# (see `find_toolchain` in crates/gg/src/sandbox/language/java.compile.rs). That is what
# keeps the arm's tests green on a machine that has merely run this script.
#
# The jars are fetched straight from Maven Central rather than resolved by Maven. An
# install step that runs a dependency resolver is an install step whose result depends on
# the day it ran, and this arm's whole point is that two runs differ in the language and
# in nothing else.
#
# Idempotent: a matching version already installed (a developer's machine, a cache
# restore) is left alone.
#
# Usage:
#   scripts/ci/install-java.sh                          # -> $HOME/.local/share/gg-java
#   JAVA_INSTALL_DIR=/opt/gg/toolchains/java scripts/ci/install-java.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-java/java-version.sh
source "$ROOT/packages/gg-sandbox-java/java-version.sh"

INSTALL_DIR="${JAVA_INSTALL_DIR:-$HOME/.local/share/gg-java}"
mkdir -p "$INSTALL_DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

case "$(uname -m)" in
x86_64) JDK_ARCH="x64" ;;
aarch64 | arm64) JDK_ARCH="aarch64" ;;
*)
	echo "error: no pinned Temurin build for $(uname -m)." >&2
	echo "       gg's Java arm's tests need one; see java-version.sh." >&2
	exit 1
	;;
esac

# --- the JDK ----------------------------------------------------------------
# A full JDK rather than a JRE: gg compiles the model's program with
# `javax.tools.JavaCompiler`, which is javac, which a JRE does not have.
JDK_DIR="$INSTALL_DIR/jdk"
if [ -x "$JDK_DIR/bin/javac" ] && "$JDK_DIR/bin/java" -version 2>&1 | grep -qF "${JDK_VERSION%%+*}"; then
	echo "Temurin $JDK_VERSION already installed"
else
	echo "Installing Temurin JDK $JDK_VERSION ($JDK_ARCH) -> $JDK_DIR"
	JDK_TAG="jdk-${JDK_VERSION/+/%2B}"
	JDK_FILE="OpenJDK${JDK_VERSION%%.*}U-jdk_${JDK_ARCH}_linux_hotspot_${JDK_VERSION/+/_}.tar.gz"
	curl -sSfL \
		"https://github.com/adoptium/temurin${JDK_VERSION%%.*}-binaries/releases/download/${JDK_TAG}/${JDK_FILE}" \
		-o "$WORK/jdk.tar.gz"
	rm -rf "$JDK_DIR"
	mkdir -p "$JDK_DIR"
	# One leading component, because the tarball's top level is the release directory.
	tar -xzf "$WORK/jdk.tar.gz" -C "$JDK_DIR" --strip-components=1
	"$JDK_DIR/bin/java" -version
fi

# --- TeaVM ------------------------------------------------------------------
LIB_DIR="$INSTALL_DIR/libs"
STAMP="$LIB_DIR/.teavm-version"
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$TEAVM_VERSION" ]; then
	echo "TeaVM $TEAVM_VERSION already installed"
else
	echo "Installing TeaVM $TEAVM_VERSION -> $LIB_DIR"
	rm -rf "$LIB_DIR"
	mkdir -p "$LIB_DIR"
	while read -r COORDINATE; do
		[ -n "$COORDINATE" ] || continue
		GROUP="${COORDINATE%%:*}"
		REST="${COORDINATE#*:}"
		ARTIFACT="${REST%%:*}"
		VERSION="${REST#*:}"
		curl -sSfL \
			"https://repo1.maven.org/maven2/${GROUP//./\/}/${ARTIFACT}/${VERSION}/${ARTIFACT}-${VERSION}.jar" \
			-o "$LIB_DIR/${ARTIFACT}-${VERSION}.jar"
	done <<<"$TEAVM_JARS"
	echo "$TEAVM_VERSION" >"$STAMP"
	echo "$(find "$LIB_DIR" -name '*.jar' | wc -l) jars"
fi
