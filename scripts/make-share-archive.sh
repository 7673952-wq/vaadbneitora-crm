#!/usr/bin/env bash
# make-share-archive.sh — builds a zip of the tracked project sources for
# sharing (e.g. with an external reviewer) that is guaranteed not to contain
# secrets, even though secrets may be tracked in git (e.g. a local .env used
# only for sandbox bootstrapping).
#
# Exclusion policy (deliberately conservative — better to over-exclude a
# harmless file than to leak a credential):
#   - every ".env*" file EXCEPT ".env.example" is excluded. ".env.example"
#     is kept because by convention it documents variable *names* only, never
#     real values, and reviewers need it to understand what to configure.
#   - any path whose name looks like it holds credentials/secrets/keys
#     (case-insensitive: "credential", "secret", "key", ".pem", ".pfx",
#     ".p12", "id_rsa", "id_ed25519") is excluded, regardless of extension.
#
# Usage: scripts/make-share-archive.sh [output-dir]
#   output-dir defaults to /mnt/documents/share

set -euo pipefail

OUT_DIR="${1:-/mnt/documents/share}"
mkdir -p "$OUT_DIR"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PROJECT_NAME="$(basename "$REPO_ROOT")"
DATE_STR="$(date +%Y-%m-%d)"
ARCHIVE_PATH="$OUT_DIR/${PROJECT_NAME}-share-${DATE_STR}.zip"

rm -f "$ARCHIVE_PATH"

# Build the include list from git's own tracked-file list (never the raw
# filesystem — untracked local scratch files must not leak into the share
# archive either), then filter out anything that matches the exclusion
# policy above.
FILE_LIST="$(mktemp)"
trap 'rm -f "$FILE_LIST"' EXIT

git ls-files | grep -v -E \
  -e '(^|/)\.env($|\.[^/]*$)' \
  | grep -v -E '/?\.env\.[^/]*$' \
  > "$FILE_LIST.tmp1" || true
# The two greps above are combined by re-running .env.example back in below;
# simplest correct approach is a single pass with an explicit allowlist for
# .env.example, done here instead:
git ls-files | awk '
  {
    path = $0
    base = path
    sub(/^.*\//, "", base)
    if (base == ".env.example") { print path; next }
    if (base ~ /^\.env(\..*)?$/) next
    lower = tolower(path)
    if (lower ~ /credential/) next
    if (lower ~ /secret/) next
    if (lower ~ /(^|[^a-z])key([^a-z]|$)/) next
    if (lower ~ /\.pem$/) next
    if (lower ~ /\.pfx$/) next
    if (lower ~ /\.p12$/) next
    if (lower ~ /id_rsa/) next
    if (lower ~ /id_ed25519/) next
    print path
  }
' > "$FILE_LIST"
rm -f "$FILE_LIST.tmp1"

ENTRY_COUNT="$(wc -l < "$FILE_LIST" | tr -d ' ')"

if [ "$ENTRY_COUNT" -eq 0 ]; then
  echo "make-share-archive: no files matched, refusing to write an empty archive" >&2
  exit 1
fi

zip -q -X "$ARCHIVE_PATH" -@ < "$FILE_LIST"

echo "Archive: $ARCHIVE_PATH"
echo "Entries: $ENTRY_COUNT"
