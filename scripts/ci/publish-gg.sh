#!/usr/bin/env bash
# Uploads gg's release artifacts to the `gg-releases` blob container.
#
#   scripts/ci/publish-gg.sh <dist-dir> <ref>
#
# <dist-dir> holds what scripts/ci/gg-dist.sh wrote on both architectures:
# `gg-x86_64-unknown-linux-musl`, `gg-aarch64-unknown-linux-musl` and
# `gg-reference.tar.gz`. Each is uploaded to `v<version>/<name>`, where <version> is
# what the x86_64 binary reports, so a download URL is built from a version and a
# target alone. That layout is the contract with core's download path
# (`core::gg_exec::release_asset_url`).
#
# <ref> is the full ref the pipeline built. On a tag build the version gate runs
# first, so a gg that does not report the tag's version uploads nothing.
#
# The container allows anonymous blob read, and each upload is read back without
# credentials. The caller is signed in to Azure as an identity holding Storage Blob
# Data Contributor on the account (the pipeline's `tcab-gg-publish` connection).
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly ACCOUNT="testcabinetartifacts"
readonly CONTAINER="gg-releases"
readonly PUBLIC_URL="https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}"

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/publish-gg.sh <dist-dir> <ref>" >&2
	exit 1
fi
readonly DIST="$1"
readonly REF="$2"

readonly objects=(gg-x86_64-unknown-linux-musl gg-aarch64-unknown-linux-musl gg-reference.tar.gz)
for object in "${objects[@]}"; do
	if [[ ! -f "${DIST}/${object}" ]]; then
		echo "publish-gg.sh: ${DIST}/${object} is missing" >&2
		exit 1
	fi
done

readonly probe="${DIST}/gg-x86_64-unknown-linux-musl"
chmod 0755 "$probe"
"${CI_LIB_DIR}/gg-version-gate.sh" "$probe" "$REF"
version="$("$probe" --version)"
version="${version#gg }"

for object in "${objects[@]}"; do
	name="v${version}/${object}"
	log "uploading ${name}"
	az storage blob upload \
		--auth-mode login \
		--account-name "$ACCOUNT" \
		--container-name "$CONTAINER" \
		--name "$name" \
		--file "${DIST}/${object}" \
		--content-type application/octet-stream \
		--overwrite \
		--only-show-errors >/dev/null
	curl --fail --silent --show-error --head --output /dev/null "${PUBLIC_URL}/${name}"
	echo "${PUBLIC_URL}/${name}"
done
