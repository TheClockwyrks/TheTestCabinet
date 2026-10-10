#!/usr/bin/env bash
# Publish each public package of the repository's npm workspace to the feed.
#
#   SYSTEM_ACCESSTOKEN=... scripts/ci/publish-packages.sh \
#     <workspace> <registry url> <tag>
#
# A tag's pipeline run ends in the publish stage, which runs this after every
# gate passed. The workspace is the directory holding the npm workspace the
# `typescript` gate builds, the registry is the npm registry of the project's
# `the-test-cabinet` feed, and the tag is the ref the run was started for, such as
# `refs/tags/v1.2.0` (`Build.SourceBranch`) or `v1.2.0`.
#
# A package is published under the name its manifest carries, at the version
# its manifest carries, which moves with the repository's version in the
# commit a tag stands over. So every public manifest has to carry the tag's
# version, and a tag over a stale one is refused before anything is installed
# or published, naming each package that is off and both versions. A manifest
# whose `private` field is set is never published. A public manifest has to
# name the feed under `publishConfig.registry`, as the Building page of the
# documentation requires, so a manifest naming another registry, or none, is
# refused too: `npm publish` run by hand on a manifest naming none would send
# the package to the public registry.
#
# The script authenticates npm to the feed through scripts/ci/npm-feed.sh
# beside it, which writes the job's access token into the user's npm
# configuration, then installs the workspace from its lock and builds it as
# the `typescript` gate does, since a repository commits no built output, and
# runs `npm publish` for each public package. A package the feed already holds
# at the tag's version, from an earlier attempt of the same run, is left as it
# is, so a run that failed part way is finished by running it again.
#
# A repository with no workspace, or whose workspace holds no public package,
# has nothing to publish, and the script says so and succeeds, so the stage is
# green for every repository it is rendered into. Every kind's pipeline runs
# the stage, and only a kind carrying the `typescript` gate builds, checks and
# tests the workspace, so a workspace in a repository without
# ci/gates/typescript.py was never gated and is refused.
set -euo pipefail

workspace="${1:?publish-packages: the directory of the npm workspace is the first argument}"
registry="${2:?publish-packages: the url of the npm registry of the feed is the second argument}"
ref="${3:?publish-packages: the tag the run is for is the third argument}"

say() { printf 'publish-packages: %s\n' "$*"; }
die() {
	printf 'publish-packages: %s\n' "$1" >&2
	shift
	[ "$#" -eq 0 ] || printf '%s\n' "$@" >&2
	exit 1
}

case "$registry" in
https://*) ;;
*) die "the registry must be an https url, not ${registry}" ;;
esac
registry="${registry%/}/"

tag="${ref#refs/tags/}"
case "$ref" in
refs/tags/v?* | v?*) ;;
*) die "${ref} is not a version tag, so it names no version to publish at; a tag is v<version>" ;;
esac
version="${tag#v}"

# The repository root is two directories above this script, and every path
# the pipeline hands over is relative to it.
ci_dir="${BASH_SOURCE[0]%/*}"
[ "$ci_dir" = "${BASH_SOURCE[0]}" ] && ci_dir=.
ci_dir="$(cd "$ci_dir" && pwd)"
cd "$ci_dir/../.."

if [ ! -f "$workspace/package.json" ]; then
	say "skipped: ${workspace}/package.json does not exist, so there is no npm workspace to publish"
	exit 0
fi
if [ ! -f ci/gates/typescript.py ]; then
	die "${workspace}/ is not built by a typescript gate, since ci/gates/typescript.py does not exist, so nothing is published" \
		"Only a repository whose kind carries the typescript gate publishes its workspace."
fi
cd "$workspace"

# One line per workspace package: its name, its version, whether it is
# private and the registry its `publishConfig` names, separated by the unit
# separator so an empty field keeps its place. `npm pkg get` reads the
# manifests without installing anything; a workspace naming no package is an
# error to npm and an empty list here.
# shellcheck disable=SC2016
list='
let text = "";
process.stdin.on("data", (chunk) => (text += chunk));
process.stdin.on("end", () => {
	let data;
	try {
		data = JSON.parse(text || "{}");
	} catch (error) {
		console.error(`npm answered with no JSON: ${text.trim()}`);
		process.exit(1);
	}
	if (data && data.error) {
		const summary = String(data.error.summary || "");
		if (/no workspaces found/i.test(summary)) return;
		console.error(summary);
		process.exit(1);
	}
	if (process.env.NPM_STATUS !== "0") {
		console.error(`npm pkg get exited ${process.env.NPM_STATUS}`);
		process.exit(1);
	}
	for (const [key, manifest] of Object.entries(data || {})) {
		const fields = [
			manifest.name ?? key,
			manifest.version ?? "",
			manifest.private ? "private" : "public",
			(manifest.publishConfig && manifest.publishConfig.registry) || "",
		];
		console.log(fields.map((field) => String(field).replace(/[\x1f\n]/g, " ")).join("\x1f"));
	}
});
'
status=0
answer="$(npm pkg get name version private publishConfig --workspaces --json 2>/dev/null)" || status=$?
if ! packages="$(NPM_STATUS="$status" node -e "$list" <<<"$answer")"; then
	die "the packages of ${workspace}/ could not be listed; run \`npm pkg get name --workspaces\` there to see why"
fi

public=()
off=()
elsewhere=()
while IFS=$'\x1f' read -r name manifest_version privacy publish_registry; do
	[ -n "$name" ] || continue
	if [ "$privacy" = "private" ]; then
		say "${name} is private and is not published"
		continue
	fi
	public+=("$name")
	if [ "$manifest_version" != "$version" ]; then
		off+=("    ${name} is at ${manifest_version:-no version}, and the tag ${tag} names ${version}")
	fi
	if [ -z "$publish_registry" ]; then
		elsewhere+=("    ${name} names no registry under publishConfig, so npm would send it to the public registry")
	elif [ "${publish_registry%/}/" != "$registry" ]; then
		elsewhere+=("    ${name} names ${publish_registry} under publishConfig, not the feed ${registry}")
	fi
done <<<"$packages"

if [ "${#public[@]}" -eq 0 ]; then
	say "skipped: ${workspace}/ holds no public package, so there is nothing to publish"
	exit 0
fi
if [ "${#off[@]}" -gt 0 ]; then
	die "a public package's version is not the tag's, so nothing is published:" "${off[@]}" \
		"Move each manifest's version to ${version} in the commit the tag stands over, then tag that commit."
fi
if [ "${#elsewhere[@]}" -gt 0 ]; then
	die "a public package does not name the feed under publishConfig.registry, so nothing is published:" "${elsewhere[@]}" \
		"Set \"publishConfig\": {\"registry\": \"${registry}\"} in each manifest named above."
fi

"$ci_dir/npm-feed.sh" "$registry"

say "installing ${workspace}/ from its lock"
npm ci --no-audit --no-fund
say "building ${workspace}/"
npm run build

for name in "${public[@]}"; do
	if [ "$(npm view "${name}@${version}" version --registry "$registry" 2>/dev/null)" = "$version" ]; then
		say "${name}@${version} is already in the feed and is left as it is"
		continue
	fi
	npm publish --workspace "$name" --registry "$registry"
	say "published ${name}@${version} to ${registry}"
done
