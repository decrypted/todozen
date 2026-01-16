#!/bin/bash
# Check TypeScript compatibility against oldest and newest GNOME Shell types
# This catches both missing APIs (old) and deprecated APIs (new)
# See GNOME.md for full compatibility documentation

set -e

# Update these when new GNOME versions release
OLDEST="46.0.0"  # Oldest available @girs/gnome-shell types
NEWEST="49.1.0"  # Latest @girs/gnome-shell types

echo ""
echo "========================================"
echo "  GNOME Shell Compatibility Check"
echo "  Testing against types: $OLDEST & $NEWEST"
echo "========================================"
echo ""

# Save current state
CURRENT=$(node -p "require('./package.json').dependencies['@girs/gnome-shell']")
echo "Current types: $CURRENT"
cp package.json package.json.bak
echo ""

check_version() {
    local VERSION=$1
    echo "--- Checking against @girs/gnome-shell@$VERSION ---"
    yarn add @girs/gnome-shell@$VERSION --silent 2>/dev/null
    if yarn run tsc --noEmit 2>&1; then
        echo "✅ GNOME $VERSION: OK"
        return 0
    else
        echo "❌ GNOME $VERSION: FAILED"
        return 1
    fi
}

FAILED=0

# Check oldest
if ! check_version $OLDEST; then
    FAILED=1
fi
echo ""

# Check newest
if ! check_version $NEWEST; then
    FAILED=1
fi
echo ""

# Restore original package.json and dependencies
echo "--- Restoring original dependencies ---"
mv package.json.bak package.json
yarn install --silent 2>/dev/null
echo ""

echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo "  ✅ All compatibility checks passed!"
else
    echo "  ❌ Some compatibility checks failed"
fi
echo "========================================"
echo ""

exit $FAILED
