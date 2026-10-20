#!/usr/bin/env bash
# Table test for run-image-inputs.sh. Run it directly:
# scripts/ci/run-image-inputs.test.sh
#
# A copy of the script runs in a throwaway git repository holding a small
# containers/ tree: a base, a tools builder that copies the whole context, an asset
# image built out of it, one that copies from the tool-sprite image, one that copies
# from the tool-paint image, one that copies from the tool-particle image, a full-stack
# image that copies from both the tools builder and the tool-particle image, and gg
# variants, with the driver's gg pin and the tool-sprite, tool-paint and tool-particle
# gitlinks beside them. The subject is what moves each image's digest and what does not.
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
mkdir -p "$repo/scripts/ci" "$repo/containers"/{base,base-wasm,tools,sprite,ui,particle-3d,full-stack-2d,voxel,gg,blender} \
	"$repo/crates/a" "$repo/crates/driver" "$repo/docs" "$repo/scripts/ci"
cp "$CI_DIR/run-image-inputs.sh" "$CI_DIR/gg-release.sh" "$CI_DIR/tool-images.sh" "$CI_DIR/tcab-lib.sh" \
	"$repo/scripts/ci/"
echo '0.7.1' >"$repo/crates/driver/gg-release-version"
cat >"$repo/containers/image-names.sh" <<'NAMES'
#!/usr/bin/env bash
printf '%s\n' base base-wasm base-wasm-gg sprite sprite-gg ui particle-3d full-stack-2d voxel blender blender-gg
NAMES
chmod +x "$repo/containers/image-names.sh"
# The `${...}` below are the Dockerfiles' own build-arg references, not shell expansions.
# shellcheck disable=SC2016
{
echo 'FROM node:24' >"$repo/containers/base/Dockerfile"
printf 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nRUN true\n' >"$repo/containers/base-wasm/Dockerfile"
printf 'FROM rust:1 AS build\nWORKDIR /src\nCOPY . .\nRUN cargo build\nFROM scratch\nCOPY --from=build /out /out\n' >"$repo/containers/tools/Dockerfile"
printf 'ARG TOOL_SPRITE_IMAGE\nARG BASE_IMAGE\nFROM ${TOOL_SPRITE_IMAGE} AS tool-sprite\nFROM ${BASE_IMAGE}\nCOPY --from=tool-sprite /usr/local/bin/draw /usr/local/bin/draw\n' >"$repo/containers/sprite/Dockerfile"
printf 'ARG TOOL_PAINT_IMAGE\nARG BASE_IMAGE\nFROM ${TOOL_PAINT_IMAGE} AS tool-paint\nFROM ${BASE_IMAGE}\nCOPY --from=tool-paint /usr/local/bin/ui /usr/local/bin/ui\n' >"$repo/containers/ui/Dockerfile"
printf 'ARG TOOL_PARTICLE_IMAGE\nARG BASE_IMAGE\nFROM ${TOOL_PARTICLE_IMAGE} AS tool-particle\nFROM ${BASE_IMAGE}\nCOPY --from=tool-particle /usr/local/bin/particle-3d /usr/local/bin/particle-3d\n' >"$repo/containers/particle-3d/Dockerfile"
printf 'ARG BASE_IMAGE\nARG TOOLS_IMAGE\nARG TOOL_PARTICLE_IMAGE\nFROM ${TOOLS_IMAGE} AS tools\nFROM ${TOOL_PARTICLE_IMAGE} AS tool-particle\nFROM ${BASE_IMAGE}\nCOPY --from=tool-particle /usr/local/bin/particle-2d /usr/local/bin/particle-2d\nCOPY --from=tools /out/music /usr/local/bin/music\n' >"$repo/containers/full-stack-2d/Dockerfile"
printf 'ARG TOOLS_IMAGE\nARG BASE_IMAGE\nFROM ${TOOLS_IMAGE} AS tools\nFROM ${BASE_IMAGE}\nCOPY --from=tools /out/voxel /usr/local/bin/voxel\n' >"$repo/containers/voxel/Dockerfile"
printf 'ARG BASE_IMAGE\nARG GG_TOOLCHAINS_IMAGE\nFROM ${GG_TOOLCHAINS_IMAGE} AS ggtools\nFROM ${BASE_IMAGE}\nCOPY --link --from=ggtools /opt /opt\n' >"$repo/containers/gg/Dockerfile"
printf 'FROM ubuntu:26.04\n# COPY not-a-source /x\nCOPY scripts/ci/install-java.sh \\\n  /tmp/install-java.sh\nCOPY containers/blender/export.py /opt/export.py\n' >"$repo/containers/blender/Dockerfile"
}
echo 'print("export")' >"$repo/containers/blender/export.py"
echo 'echo java' >"$repo/scripts/ci/install-java.sh"
echo 'fn main() {}' >"$repo/crates/a/main.rs"
echo 'prose' >"$repo/docs/page.md"
printf '*\n!/crates\n!/Cargo.toml\n!/sub/crates\n' >"$repo/.dockerignore"
echo '[workspace]' >"$repo/Cargo.toml"
# A submodule the allowlist reaches into, as the index holds one: a gitlink and
# none of its files. The pins are made-up commit ids; nothing fetches them.
readonly PIN_A=1111111111111111111111111111111111111111
readonly PIN_B=2222222222222222222222222222222222222222
# tool-sprite's gitlink, the commit whose image the sprite image copies from.
readonly SPRITE_PIN_A=3333333333333333333333333333333333333333
readonly SPRITE_PIN_B=4444444444444444444444444444444444444444
# tool-paint's gitlink, the commit whose image the ui image copies from.
readonly PAINT_PIN_A=5555555555555555555555555555555555555555
readonly PAINT_PIN_B=6666666666666666666666666666666666666666
# tool-particle's gitlink, the commit whose image the particle-3d and full-stack-2d
# images copy from.
readonly PARTICLE_PIN_A=7777777777777777777777777777777777777777
readonly PARTICLE_PIN_B=8888888888888888888888888888888888888888
(cd "$repo" && git init -q && git add -A && git update-index --add --cacheinfo "160000,${PIN_A},sub" \
	&& git update-index --add --cacheinfo "160000,${SPRITE_PIN_A},tool-sprite" \
	&& git update-index --add --cacheinfo "160000,${PAINT_PIN_A},tool-paint" \
	&& git update-index --add --cacheinfo "160000,${PARTICLE_PIN_A},tool-particle" \
	&& git -c user.name=t -c user.email=t@t commit -q -m init)

run() { (cd "$repo" && scripts/ci/run-image-inputs.sh "$@" 2>&1); }
digest() { run "$1" | awk '{print $2}'; }
# Stages a change so the index, which the digest reads, sees it. Only that file: the
# submodule has no checkout, which `git add -A` would stage as its removal.
change() { (cd "$repo" && printf '%s\n' "$2" >>"$1" && git add -- "$1"); }
revert() { (cd "$repo" && git checkout -q -- . && git reset -q --hard HEAD); }

out="$(run)"
check_equal "lists tools and every run image" \
	"tools base base-wasm base-wasm-gg sprite sprite-gg ui particle-3d full-stack-2d voxel blender blender-gg" \
	"$(awk '{print $1}' <<<"$out" | tr '\n' ' ' | sed 's/ $//')"
check_equal "a digest is 32 hex characters" "12" "$(grep -cE '^[a-z0-9-]+ [0-9a-f]{32} ' <<<"$out")"
check_equal "parents: base has none" "base $(digest base) -" "$(run base)"
check_equal "parents: an asset image is from base and tools" "base,tools" "$(run voxel | awk '{print $3}')"
check_equal "parents: the sprite image is from base alone, tool-sprite being no image built here" "base" \
	"$(run sprite | awk '{print $3}')"
check_equal "parents: the ui image is from base alone, tool-paint being no image built here" "base" \
	"$(run ui | awk '{print $3}')"
check_equal "parents: the particle-3d image is from base alone, tool-particle being no image built here" \
	"base" "$(run particle-3d | awk '{print $3}')"
check_equal "parents: a full-stack image is from base-wasm and tools, not tool-particle" "base-wasm,tools" \
	"$(run full-stack-2d | awk '{print $3}')"
check_equal "parents: a gg variant is from its image alone" "sprite" "$(run sprite-gg | awk '{print $3}')"
check_equal "the table is deterministic" "$out" "$(run)"

base0="$(digest base)"; wasm0="$(digest base-wasm)"; tools0="$(digest tools)"; sprite0="$(digest sprite)"
spritegg0="$(digest sprite-gg)"; blender0="$(digest blender)"; wasmgg0="$(digest base-wasm-gg)"
voxel0="$(digest voxel)"; ui0="$(digest ui)"
particle0="$(digest particle-3d)"; fullstack0="$(digest full-stack-2d)"
blendergg0="$(digest blender-gg)"

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
check_differs "and the images built out of it" "$voxel0" "$(digest voxel)"
check_equal "but not one built out of none of it" "$sprite0" "$(digest sprite)"
check_equal "but not base" "$base0" "$(digest base)"
revert

(cd "$repo" && git update-index --cacheinfo "160000,${PIN_B},sub")
check_differs "a submodule pin the allowlist reaches into moves the image that copies the context" "$tools0" "$(digest tools)"
check_differs "and the images built out of it" "$voxel0" "$(digest voxel)"
check_equal "but not base" "$base0" "$(digest base)"
revert

change docs/page.md 'more prose'
check_equal "a file the allowlist excludes moves nothing: tools" "$tools0" "$(digest tools)"
check_equal "voxel" "$voxel0" "$(digest voxel)"
revert

change .dockerignore '!/docs'
check_differs "the allowlist itself is an input of a context copy" "$tools0" "$(digest tools)"
revert

change containers/blender/export.py 'print("more")'
check_differs "a named COPY source moves its image" "$blender0" "$(digest blender)"
check_equal "and nothing else" "$sprite0" "$(digest sprite)"
revert

change scripts/ci/install-java.sh 'echo more'
check_differs "a continued COPY line's source moves its image" "$blender0" "$(digest blender)"
check_differs "and its gg variant" "$blendergg0" "$(digest blender-gg)"
revert

check_equal "the gg toolchain image is the pinned release's" "$spritegg0" \
	"$(cd "$repo" && GG_TOOLCHAINS_IMAGE=testcabinet.azurecr.io/test-cabinet-gg-toolchains:0.7.1 \
		scripts/ci/run-image-inputs.sh sprite-gg | awk '{print $2}')"
check_differs "another toolchain image moves every gg variant" "$spritegg0" \
	"$(cd "$repo" && GG_TOOLCHAINS_IMAGE=registry.test/test-cabinet-gg-toolchains:0.8.0 \
		scripts/ci/run-image-inputs.sh sprite-gg | awk '{print $2}')"
(cd "$repo" && echo '0.8.0' >crates/driver/gg-release-version)
check_differs "and so does a bump of the driver's pin: sprite-gg" "$spritegg0" "$(digest sprite-gg)"
check_differs "base-wasm-gg" "$wasmgg0" "$(digest base-wasm-gg)"
check_equal "but not the variant's parent" "$wasm0" "$(digest base-wasm)"
check_equal "nor any other image" "$sprite0" "$(digest sprite)"
(cd "$repo" && echo '0.7.1' >crates/driver/gg-release-version)

(cd "$repo" && git update-index --cacheinfo "160000,${SPRITE_PIN_B},tool-sprite" \
	&& git -c user.name=t -c user.email=t@t commit -q -m 'bump tool-sprite')
check_differs "a bump of the tool-sprite gitlink moves the image that copies from tool-sprite" "$sprite0" "$(digest sprite)"
check_differs "and its gg variant" "$spritegg0" "$(digest sprite-gg)"
check_equal "but not an image built out of the tooling builder" "$voxel0" "$(digest voxel)"
check_equal "nor the builder" "$tools0" "$(digest tools)"
check_equal "nor one that copies from another tool image" "$ui0" "$(digest ui)"
(cd "$repo" && git reset -q --hard HEAD~1)
check_equal "and back" "$sprite0" "$(digest sprite)"
check_equal "TOOL_SPRITE_IMAGE naming the pinned image is the same input" "$sprite0" \
	"$(cd "$repo" && TOOL_SPRITE_IMAGE="testcabinet.azurecr.io/tool-sprite:${SPRITE_PIN_A}" \
		scripts/ci/run-image-inputs.sh sprite | awk '{print $2}')"
check_differs "another image is another input" "$sprite0" \
	"$(cd "$repo" && TOOL_SPRITE_IMAGE=registry.test/tool-sprite:other \
		scripts/ci/run-image-inputs.sh sprite | awk '{print $2}')"

(cd "$repo" && git update-index --cacheinfo "160000,${PAINT_PIN_B},tool-paint" \
	&& git -c user.name=t -c user.email=t@t commit -q -m 'bump tool-paint')
check_differs "a bump of the tool-paint gitlink moves the image that copies from tool-paint" "$ui0" "$(digest ui)"
check_equal "but not the one that copies from tool-sprite" "$sprite0" "$(digest sprite)"
check_equal "nor an image built out of the tooling builder" "$voxel0" "$(digest voxel)"
(cd "$repo" && git reset -q --hard HEAD~1)
check_equal "and back" "$ui0" "$(digest ui)"
check_differs "TOOL_PAINT_IMAGE naming another image is another input" "$ui0" \
	"$(cd "$repo" && TOOL_PAINT_IMAGE=registry.test/tool-paint:other \
		scripts/ci/run-image-inputs.sh ui | awk '{print $2}')"

(cd "$repo" && git update-index --cacheinfo "160000,${PARTICLE_PIN_B},tool-particle" \
	&& git -c user.name=t -c user.email=t@t commit -q -m 'bump tool-particle')
check_differs "a bump of the tool-particle gitlink moves the image that copies from tool-particle" \
	"$particle0" "$(digest particle-3d)"
check_differs "and the full-stack image that copies from it beside the builder" "$fullstack0" \
	"$(digest full-stack-2d)"
check_equal "but not the one that copies from tool-paint" "$ui0" "$(digest ui)"
check_equal "nor an image built out of the tooling builder alone" "$voxel0" "$(digest voxel)"
check_equal "nor the builder" "$tools0" "$(digest tools)"
(cd "$repo" && git reset -q --hard HEAD~1)
check_equal "and back" "$particle0" "$(digest particle-3d)"
check_equal "TOOL_PARTICLE_IMAGE naming the pinned image is the same input" "$fullstack0" \
	"$(cd "$repo" && TOOL_PARTICLE_IMAGE="testcabinet.azurecr.io/tool-particle:${PARTICLE_PIN_A}" \
		scripts/ci/run-image-inputs.sh full-stack-2d | awk '{print $2}')"
check_differs "TOOL_PARTICLE_IMAGE naming another image is another input" "$particle0" \
	"$(cd "$repo" && TOOL_PARTICLE_IMAGE=registry.test/tool-particle:other \
		scripts/ci/run-image-inputs.sh particle-3d | awk '{print $2}')"

(cd "$repo" && sed -i 's/^schema=.*//; s/^readonly INPUTS_SCHEMA=.*/readonly INPUTS_SCHEMA="v2"/' scripts/ci/run-image-inputs.sh)
check_differs "a schema bump moves every image" "$base0" "$(digest base)"
(cd "$repo" && sed -i 's/^readonly INPUTS_SCHEMA=.*/readonly INPUTS_SCHEMA="v1"/' scripts/ci/run-image-inputs.sh)
check_equal "and back" "$base0" "$(digest base)"

out="$(run nothing)"
check_equal "an unknown name fails" "1" "$?"
check_contains "naming it" "no Dockerfile for 'nothing'" "$out"

change containers/voxel/Dockerfile 'ARG TOOL_VOXEL_IMAGE'
out="$(run voxel)"
check_equal "a tool image argument tool-images.sh does not list fails" "1" "$?"
check_contains "naming it" "declares ARG TOOL_VOXEL_IMAGE, which scripts/ci/tool-images.sh does not list" "$out"
revert

echo
echo "run-image-inputs.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
