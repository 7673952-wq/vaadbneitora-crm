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

# `core.quotepath=off` is required: with the default, git escapes non-ASCII
# paths (e.g. Hebrew filenames) as C-quoted strings, and `zip -@` then cannot
# find them and silently drops them from the archive.
git -c core.quotepath=off ls-files | awk '
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
    if (lower ~ /dev\.vars/) next
    if (lower ~ /id_rsa/) next
    if (lower ~ /id_ed25519/) next
    print path
  }
' > "$FILE_LIST"

ENTRY_COUNT="$(wc -l < "$FILE_LIST" | tr -d ' ')"

if [ "$ENTRY_COUNT" -eq 0 ]; then
  echo "make-share-archive: no files matched, refusing to write an empty archive" >&2
  exit 1
fi

zip -q -X "$ARCHIVE_PATH" -@ < "$FILE_LIST"

# Self-verification: the archive is the artifact that gets delivered, so the
# check runs on the archive itself, never on the intended file list.
ZIP_LIST="$(mktemp)"
unzip -Z1 "$ARCHIVE_PATH" > "$ZIP_LIST"
ZIP_COUNT="$(wc -l < "$ZIP_LIST" | tr -d ' ')"

if [ "$ZIP_COUNT" -ne "$ENTRY_COUNT" ]; then
  echo "make-share-archive: expected $ENTRY_COUNT entries, archive has $ZIP_COUNT — refusing" >&2
  rm -f "$ARCHIVE_PATH" "$ZIP_LIST"
  exit 1
fi

# Anything matching the secret patterns inside the archive is a hard failure,
# except .env.example which documents variable names only.
LEAKED="$(grep -inE '(^|/)\.env($|\.)|credential|secret|\.pem$|\.pfx$|\.p12$|dev\.vars|id_rsa|id_ed25519' "$ZIP_LIST" \
  | grep -v -E '(^|[0-9]+:)(.*/)?\.env\.example$' || true)"
if [ -n "$LEAKED" ]; then
  echo "make-share-archive: archive contains forbidden entries:" >&2
  echo "$LEAKED" >&2
  rm -f "$ARCHIVE_PATH" "$ZIP_LIST"
  exit 1
fi

echo "Archive: $ARCHIVE_PATH"
echo "Entries: $ZIP_COUNT (verified inside the archive)"
echo "Secret scan: clean (only .env.example allowed)"
rm -f "$ZIP_LIST"

