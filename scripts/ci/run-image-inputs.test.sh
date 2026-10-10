#!/usr/bin/env bash
# Table test for run-image-inputs.sh. Run it directly:
# scripts/ci/run-image-inputs.test.sh
#
# A copy of the script runs in a throwaway git repository holding a small
# containers/ tree: a base, a tools builder that copies the whole context, an asset
# image, a gg variant and a gg-toolchains builder. The subject is what moves each
# image's digest and what does not.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_differs() { # label a b
	if [ "$2" != "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected a different digest from: $2"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/containers"/{base,base-wasm,tools,sprite,gg,gg-toolchains,blender} \
	"$repo/crates/a" "$repo/docs" "$repo/packages/gg-sandbox-rust" "$repo/scripts/ci"
cp "$CI_DIR/run-image-inputs.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/containers/image-names.sh" <<'NAMES'
#!/usr/bin/env bash
printf '%s\n' base base-wasm base-wasm-gg sprite sprite-gg blender blender-gg
NAMES
chmod +x "$repo/containers/image-names.sh"
# The `${...}` below are the Dockerfiles' own build-arg references, not shell expansions.
# shellcheck disable=SC2016
{
echo 'FROM node:24' >"$repo/containers/base/Dockerfile"
printf 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nRUN true\n' >"$repo/containers/base-wasm/Dockerfile"
printf 'FROM rust:1 AS build\nWORKDIR /src\nCOPY . .\nRUN cargo build\nFROM scratch\nCOPY --from=build /out /out\n' >"$repo/containers/tools/Dockerfile"
printf 'ARG TOOLS_IMAGE\nARG BASE_IMAGE\nFROM ${TOOLS_IMAGE} AS tools\nFROM ${BASE_IMAGE}\nCOPY --from=tools /out/draw /usr/local/bin/draw\n' >"$repo/containers/sprite/Dockerfile"
printf 'ARG BASE_IMAGE\nARG GG_TOOLCHAINS_IMAGE\nFROM ${GG_TOOLCHAINS_IMAGE} AS ggtools\nFROM ${BASE_IMAGE}\nCOPY --link --from=ggtools /opt /opt\n' >"$repo/containers/gg/Dockerfile"
printf 'FROM debian AS build\nCOPY scripts/ci/install-java.sh \\\n  /tmp/install-java.sh\nRUN sh /tmp/install-java.sh\nFROM scratch\nCOPY --from=build /opt/gg /opt/gg\n' >"$repo/containers/gg-toolchains/Dockerfile"
printf 'FROM ubuntu:26.04\n# COPY not-a-source /x\nCOPY containers/blender/export.py /opt/export.py\n' >"$repo/containers/blender/Dockerfile"
}
echo 'print("export")' >"$repo/containers/blender/export.py"
echo 'echo java' >"$repo/scripts/ci/install-java.sh"
echo 'fn main() {}' >"$repo/crates/a/main.rs"
echo 'prose' >"$repo/docs/page.md"
echo 'RUST=1' >"$repo/packages/gg-sandbox-rust/rust-version.sh"
echo '[toolchain]' >"$repo/rust-toolchain.toml"
printf '*\n!/crates\n!/Cargo.toml\n!/packages/gg-sandbox-rust\n!/sub/crates\n' >"$repo/.dockerignore"
echo '[workspace]' >"$repo/Cargo.toml"
# A submodule the allowlist reaches into, as the index holds one: a gitlink and
# none of its files. The pins are made-up commit ids; nothing fetches them.
readonly PIN_A=1111111111111111111111111111111111111111
readonly PIN_B=2222222222222222222222222222222222222222
(cd "$repo" && git init -q && git add -A && git update-index --add --cacheinfo "160000,${PIN_A},sub" \
	&& git -c user.name=t -c user.email=t@t commit -q -m init)

run() { (cd "$repo" && scripts/ci/run-image-inputs.sh "$@" 2>&1); }
digest() { run "$1" | awk '{print $2}'; }
# Stages a change so the index, which the digest reads, sees it. Only that file: the
# submodule has no checkout, which `git add -A` would stage as its removal.
change() { (cd "$repo" && printf '%s\n' "$2" >>"$1" && git add -- "$1"); }
revert() { (cd "$repo" && git checkout -q -- . && git reset -q --hard HEAD); }

out="$(run)"
check_equal "lists tools, gg-toolchains and every run image" \
	"tools gg-toolchains base base-wasm base-wasm-gg sprite sprite-gg blender blender-gg" \
	"$(awk '{print $1}' <<<"$out" | tr '\n' ' ' | sed 's/ $//')"
check_equal "a digest is 32 hex characters" "9" "$(grep -cE '^[a-z0-9-]+ [0-9a-f]{32} ' <<<"$out")"
check_equal "parents: base has none" "base $(digest base) -" "$(run base)"
check_equal "parents: an asset image is from base and tools" "base,tools" "$(run sprite | awk '{print $3}')"
check_equal "parents: a gg variant is from its image and gg-toolchains" "sprite,gg-toolchains" "$(run sprite-gg | awk '{print $3}')"
check_equal "the table is deterministic" "$out" "$(run)"

base0="$(digest base)"; wasm0="$(digest base-wasm)"; tools0="$(digest tools)"; sprite0="$(digest sprite)"
spritegg0="$(digest sprite-gg)"; blender0="$(digest blender)"; ggtc0="$(digest gg-toolchains)"; wasmgg0="$(digest base-wasm-gg)"

change containers/base/Dockerfile 'RUN echo changed'
check_differs "the Dockerfile moves the image" "$base0" "$(digest base)"
check_differs "and every image below it: base-wasm" "$wasm0" "$(digest base-wasm)"
check_differs "sprite" "$sprite0" "$(digest sprite)"
check_differs "sprite-gg" "$spritegg0" "$(digest sprite-gg)"
check_equal "but not blender, which is not from it" "$blender0" "$(digest blender)"
check_equal "nor tools" "$tools0" "$(digest tools)"
revert

change crates/a/main.rs '// a change under crates'
check_differs "an allowlisted context file moves the image that copies the context" "$tools0" "$(digest tools)"
check_differs "and the images built out of it" "$sprite0" "$(digest sprite)"
check_equal "but not base" "$base0" "$(digest base)"
check_equal "nor gg-toolchains" "$ggtc0" "$(digest gg-toolchains)"
revert

(cd "$repo" && git update-index --cacheinfo "160000,${PIN_B},sub")
check_differs "a submodule pin the allowlist reaches into moves the image that copies the context" "$tools0" "$(digest tools)"
check_differs "and the images built out of it" "$sprite0" "$(digest sprite)"
check_equal "but not base" "$base0" "$(digest base)"
revert

change docs/page.md 'more prose'
check_equal "a file the allowlist excludes moves nothing: tools" "$tools0" "$(digest tools)"
check_equal "sprite" "$sprite0" "$(digest sprite)"
revert

change .dockerignore '!/docs'
check_differs "the allowlist itself is an input of a context copy" "$tools0" "$(digest tools)"
revert

change containers/blender/export.py 'print("more")'
check_differs "a named COPY source moves its image" "$blender0" "$(digest blender)"
check_equal "and nothing else" "$sprite0" "$(digest sprite)"
revert

change scripts/ci/install-java.sh 'echo more'
check_differs "a continued COPY line's source moves gg-toolchains" "$ggtc0" "$(digest gg-toolchains)"
check_differs "and every gg variant" "$wasmgg0" "$(digest base-wasm-gg)"
check_equal "but not the variant's parent" "$wasm0" "$(digest base-wasm)"
revert

change rust-toolchain.toml 'channel = "x"'
check_differs "the Rust pin moves gg-toolchains" "$ggtc0" "$(digest gg-toolchains)"
revert

(cd "$repo" && sed -i 's/^schema=.*//; s/^readonly INPUTS_SCHEMA=.*/readonly INPUTS_SCHEMA="v2"/' scripts/ci/run-image-inputs.sh)
check_differs "a schema bump moves every image" "$base0" "$(digest base)"
(cd "$repo" && sed -i 's/^readonly INPUTS_SCHEMA=.*/readonly INPUTS_SCHEMA="v1"/' scripts/ci/run-image-inputs.sh)
check_equal "and back" "$base0" "$(digest base)"

out="$(run nothing)"
check_equal "an unknown name fails" "1" "$?"
check_contains "naming it" "no Dockerfile for 'nothing'" "$out"

echo
echo "run-image-inputs.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
