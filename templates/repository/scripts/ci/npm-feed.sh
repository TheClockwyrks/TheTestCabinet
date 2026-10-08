#!/usr/bin/env bash
# Let a pipeline run install a package of The Test Cabinet from the project's feed.
#
#   SYSTEM_ACCESSTOKEN=... scripts/ci/npm-feed.sh <registry url>
#
# A workspace names a package of the project at the version a tag published to
# the `the-test-cabinet` feed of the project's Azure Artifacts, and the
# workspace's own `.npmrc` names the feed as the registry of the `@clockwyrks`
# scope. The feed
# is private to the project, so an install that reaches it carries a
# credential; what a pipeline run holds is the job's access token. This
# writes that token as the credential npm presents to the registry, into the
# user's npm configuration (the file `npm config get userconfig` names)
# rather than any file of the repository, so nothing the run leaves behind
# is a change git would offer to commit.
#
# The token reaches npm through that configuration alone: it is written by
# the shell itself and handed to no command as an argument, so it appears in
# no process listing and no failure's output. A line an earlier run wrote for
# the same registry is replaced rather than repeated.
#
# The pipeline runs this before the first `npm ci` of a job in a repository
# whose kind carries the `typescript` gate, with the registry the repository
# kit renders from the Repositories page of the superrepo's documentation.
set -euo pipefail

registry="${1:?npm-feed: the url of the npm registry of the feed is the first argument}"
: "${SYSTEM_ACCESSTOKEN:?npm-feed: SYSTEM_ACCESSTOKEN must carry the access token of the job}"

case "$registry" in
https://*) ;;
*)
	echo "npm-feed: the registry must be an https url, not ${registry}" >&2
	exit 1
	;;
esac
case "$SYSTEM_ACCESSTOKEN" in
*[[:space:]]*)
	# A line break would end the configuration line and begin another.
	echo "npm-feed: SYSTEM_ACCESSTOKEN holds whitespace, which no access token does" >&2
	exit 1
	;;
esac

# npm keys a credential by the registry's url without its scheme, ending in
# a slash, and presents it to every request under that path.
registry="${registry%/}/"
key="//${registry#https://}:_authToken="

config="$(npm config get userconfig)"
if [ -z "$config" ]; then
	echo "npm-feed: npm names no user configuration file" >&2
	exit 1
fi

umask 077
mkdir -p "$(dirname "$config")"
written="$(mktemp "${config}.XXXXXX")"
trap 'rm -f "$written"' EXIT
if [ -f "$config" ]; then
	awk -v key="$key" 'index($0, key) != 1' "$config" >"$written"
fi
printf '%s%s\n' "$key" "$SYSTEM_ACCESSTOKEN" >>"$written"
mv "$written" "$config"
trap - EXIT

echo "npm-feed: npm authenticates to ${registry} with the job's access token"
