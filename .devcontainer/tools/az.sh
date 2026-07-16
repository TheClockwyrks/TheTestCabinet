#!/usr/bin/env bash
# Installs the Azure CLI (`az`) and the `azure-devops` extension, used to query
# the project's Azure DevOps CI pipeline runs programmatically (`az pipelines
# runs list`, `az pipelines runs show`, etc.).
#
# Unlike most tools installed here, `az` is distributed as a system (apt) package
# rather than a single static binary, so this installs it from Microsoft's apt
# repository using sudo (the devcontainer user has passwordless sudo). Microsoft
# does not publish a package for this image's Ubuntu release (26.04 "resolute"),
# but the azure-cli .deb bundles its own Python runtime and depends only on
# common system libraries, so the 24.04 ("noble") package runs correctly here.
# The repository is therefore pinned to `noble`.
#
# This runs as part of the container build; it is also safe to re-run by hand
# after a rebuild. Authenticate separately before querying, with a Personal
# Access Token that carries the `Build (Read)` scope:
#   export AZURE_DEVOPS_EXT_PAT=<token>
#   az devops configure --defaults \
#     organization=https://dev.azure.com/<org> project=<project>
set -euo pipefail

# The azure-cli package is pinned to this Ubuntu codename; see the header for why
# it differs from the running image's release.
readonly AZ_DIST="noble"
readonly KEYRING="/etc/apt/keyrings/microsoft.gpg"
readonly SOURCES="/etc/apt/sources.list.d/azure-cli.sources"

# Ensure the tools needed to add the repo are present (self-contained for the
# re-run-by-hand case; at build time these are already installed).
sudo apt-get update -y
DEBIAN_FRONTEND=noninteractive sudo apt-get install -y ca-certificates curl gnupg

# Add Microsoft's package signing key, dearmored into apt's keyring directory.
sudo mkdir -p "$(dirname "$KEYRING")"
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
	| gpg --dearmor \
	| sudo tee "$KEYRING" >/dev/null
sudo chmod go+r "$KEYRING"

# Pin the azure-cli repo to the noble suite for this architecture.
sudo tee "$SOURCES" >/dev/null <<EOF
Types: deb
URIs: https://packages.microsoft.com/repos/azure-cli/
Suites: ${AZ_DIST}
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: ${KEYRING}
EOF

sudo apt-get update -y
DEBIAN_FRONTEND=noninteractive sudo apt-get install -y azure-cli

# Add the Azure DevOps extension (provides `az pipelines` and `az devops`). It
# installs into the user's ~/.azure; skip the add when it is already present so
# re-runs stay cheap.
if ! az extension show --name azure-devops >/dev/null 2>&1; then
	az extension add --name azure-devops --only-show-errors
fi

AZ_VERSION="$(az version --query '"azure-cli"' --output tsv 2>/dev/null || true)"
readonly AZ_VERSION
echo "Installed azure-cli ${AZ_VERSION:-(unknown version)} with the azure-devops extension"
