# GNOME Shell Compatibility Reference

## Key Insight: Type Package ≠ Runtime Compatibility

```
@girs/gnome-shell@46 (devDependency)  →  TypeScript type checking only
metadata.json shell-version: 42-49    →  Actual runtime compatibility
```

The `@girs/gnome-shell` package is purely `.d.ts` files - never bundled into the extension. Compiled JS is identical regardless of type package version.

## Ubuntu LTS → GNOME Shell Versions

| Ubuntu | Support End | GNOME Shell | Notes |
|--------|-------------|-------------|-------|
| 20.04 LTS | Apr 2025 | 3.36 | Legacy, different extension API |
| 22.04 LTS | Apr 2027 | 42 | Oldest practical target |
| 24.04 LTS | Apr 2029 | 46 | Current LTS |
| 24.10 | Jul 2025 | 47 | Current stable |
| 25.04 | Jan 2026 | 48 | Next release |

**Practical target: GNOME 42+** (Ubuntu 22.04 LTS and newer)

## Type Package Availability

| @girs/gnome-shell | GNOME Version |
|-------------------|---------------|
| 45.x | GNOME 45 |
| 46.x | GNOME 46 |
| 47.x | GNOME 47 |
| 48.x | GNOME 48 |
| 49.x | GNOME 49 |

**No types available for GNOME 42-44.** We develop against 46.0.0 (oldest available).

## Development Strategy

1. **Develop against oldest types** (`@girs/gnome-shell@^46.0.0`)
   - Immediate feedback if you use APIs that don't exist in older GNOME
   - Better than discovering issues later in CI

2. **Test against newest types** (`make check-compat`)
   - Catches deprecated/changed APIs
   - Tests both 46.0.0 and 49.1.0

3. **Claim broad compatibility** in `metadata.json`
   ```json
   "shell-version": ["42", "43", "44", "45", "46", "47", "48", "49"]
   ```

## Cross-Version Type Workarounds

Some APIs have different type signatures between versions. Use `@ts-ignore` (not `@ts-expect-error`) when the error only exists in one version:

```typescript
// @ts-ignore fails silently if no error (works for both versions)
// @ts-expect-error fails if no error (breaks on one version)
```

### Known Cross-Version Differences

| API | GNOME 46 Type | GNOME 49 Type | Solution |
|-----|---------------|---------------|----------|
| `menu.close(arg)` | `boolean` | `PopupAnimation` | Use `-1` |
| `getPreferencesWidget()` | Type mismatch | Fixed | `@ts-ignore` |

### The `-1` Trick for `menu.close()`

```typescript
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - type signature changed between GNOME versions
this.button?.menu.close(-1);
```

Why `-1` works:
- **GNOME 46** (boolean): `-1` is truthy → animate
- **GNOME 49** (PopupAnimation): `-1` equals `~0` = `PopupAnimation.FULL`

### Safe @ts-expect-error Uses

These suppress errors for genuinely untyped GNOME Shell internals (stable across versions):

| Pattern | Reason |
|---------|--------|
| `menu.connect('open-state-changed', ...)` | Signal exists but not in types |
| `Main.panel._leftBox` | Internal panel boxes, untyped |
| `widget._settings = settings` | Lifecycle property attachment |

## Compatibility Checking

```bash
make check-compat   # Tests against GNOME 46.0.0 AND 49.1.0 types
make check          # Full checks including compat
```

The `check-compat` script:
1. Saves current type version
2. Tests against 46.0.0 (oldest)
3. Tests against 49.1.0 (newest)
4. Restores original version
5. Reports pass/fail for each

## Stable APIs

These APIs have been stable since GNOME 40+ and are safe to use:

- **St widgets**: `St.Label`, `St.Button`, `St.BoxLayout`, `St.Entry`, `St.ScrollView`
- **Clutter**: `Clutter.ActorAlign`, `Clutter.Event`
- **PopupMenu**: `PopupMenu`, `PopupMenuItem`, `PopupSeparatorMenuItem`, `PopupSubMenuMenuItem`
- **PanelMenu**: `PanelMenu.Button`
- **Main**: `Main.panel`, `Main.notify()`
- **GSettings**: Full API stable

## Resources

- [GNOME Shell Extensions Guide](https://gjs.guide/extensions/)
- [@girs/gnome-shell on npm](https://www.npmjs.com/package/@girs/gnome-shell)
- [GNOME Shell Source](https://gitlab.gnome.org/GNOME/gnome-shell)
