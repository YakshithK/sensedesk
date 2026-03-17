#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/bump-version.sh <new-version>
# Example: ./scripts/bump-version.sh 0.3.0

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 0.3.0"
  exit 1
fi

NEW_VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Bumping version to $NEW_VERSION ..."

# 1. package.json (root)
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/package.json"
echo "  ✓ package.json"

# 2. src-tauri/tauri.conf.json
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/src-tauri/tauri.conf.json"
echo "  ✓ src-tauri/tauri.conf.json"

# 3. src-tauri/Cargo.toml (only the package version, not dependency versions)
sed -i "0,/^version = \".*\"/s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$ROOT/src-tauri/Cargo.toml"
echo "  ✓ src-tauri/Cargo.toml"

echo ""
echo "Done! All files bumped to $NEW_VERSION"
echo "Don't forget to commit and tag:"
echo "  git add -A && git commit -m \"chore: bump version to v$NEW_VERSION\""
echo "  git tag v$NEW_VERSION && git push --follow-tags"
