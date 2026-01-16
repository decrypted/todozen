# Changelog

## 3.1.0

### Added
- **Task Groups**: Organize tasks into color-coded groups (max 10)
  - Group selector dropdown when adding tasks
  - Filter tasks by group via header click (cycles: All → Inbox → Group1 → ...)
  - Groups manageable in preferences (add, rename, reorder, delete, change color)
  - Per-group clear button with confirmation
- **Settings button**: Gear icon in extension popup opens preferences
- **About section in prefs**: Shows version and build time
- **PERFORMANCE.md**: Documentation of performance optimizations and concerns
- GNOME 49 support in `metadata.json`
- `clearAll()` method in manager for efficient bulk deletion
- Lazy population: todo list UI is only built when menu is first opened
- **Settings UI**: Panel position can now be configured (left, center-left, center, center-right, right)
- `prefs.ts` / `prefs.ui`: New preferences dialog using GTK4/Libadwaita
- Live repositioning: Button moves immediately when position setting changes
- **History logging**: All task actions logged to `~/.config/todozen/history.jsonl`

### Changed
- **Clear All moved to prefs**: Removed from extension popup, now in preferences with confirmation dialog
- **LICENSE renamed**: From `LICENCE` to `LICENSE` (standard American spelling)

### Removed
- Deleted `src/utils.ts` - `isEmpty()` utility was unnecessary overhead
- Clear All button from extension popup (moved to prefs)

### Fixed

#### Memory Leaks
- **Confirmation dialog not destroyed**: Changed `remove_child()` to `destroy()` when dismissing confirmation dialogs. `remove_child()` only detaches from parent but keeps the widget alive in memory.
- **Manager reference held after disable**: Added `this._manager = null` in `disable()` to release GSettings reference.
- **Double-destroy attempts**: Removed redundant destroy calls for child widgets (`todosBox`, `scrollView`, `buttonText`, `input`, `clearAllBtn`). When parent (`_indicator`) is destroyed, children are automatically cleaned up. The old code tried to destroy already-destroyed widgets, causing silent errors.

#### Performance
- **JSON.stringify pretty-print removed**: Changed `JSON.stringify(todo, null, 2)` to `JSON.stringify(todo)` in `manager.ts`. The whitespace served no purpose (data is never human-read) and wasted CPU cycles and storage space on every task update.
- **O(n²) to O(1) clear-all**: Old `_clearAllTasks()` called `remove(i)` in a loop, each doing a full GSettings read-modify-write cycle. New implementation does a single `set_strv(TODOS, [])` call.
- **Eliminated double JSON parsing**: Previously `_populate()` parsed all todos, then `_refreshTodosButtonText()` called `getTotalUndone()` which parsed them ALL again. Now `_populate(true)` counts undone tasks while iterating - one pass instead of two.
- **Lazy population**: Todo list UI is deferred until first menu open. On startup, only the button text count is calculated. The full UI render happens on first user interaction, reducing startup CPU usage.
- **Removed isEmpty() function call overhead**: Replaced `isEmpty(todos)` with direct `!todos.length` check. Eliminates function call overhead for a trivial operation.
- **Task/Group caching**: `getParsed()` and `getGroups()` cache results, invalidated via GSettings signals
- **Smart repopulation**: UI only rebuilds on menu open when data has changed (via `_needsPopulate` flag)

#### Code Quality
- **Removed dead code**: Deleted unused `selectionCheckbox` creation (12 lines) that was commented out but still instantiated an object per todo item.
- **Removed unused field**: Deleted `_activeConfirmationTimeoutId` field that was declared but never assigned.
- **Fixed `var` to `const`**: Changed 3 instances of `var` to `const` for better scoping.
- **Fixed typo**: "Copty button" -> "Copy button" in comment.

### Summary of Changes by File

| File | Changes |
|------|---------|
| `metadata.json` | Added "49" to shell-version |
| `src/manager.ts` | Groups support, task/group caching, `clearAll()`, history logging, versioned data model |
| `src/history.ts` | **New** - History logger, writes to `~/.config/todozen/history.jsonl` |
| `src/extension.ts` | Groups UI, filter cycling, settings button, caching, performance fixes |
| `src/prefs.ts` | Groups management, clear all with confirmation, about section |
| `prefs.ui` | Groups section, clear all, about section |
| `schemas/*.xml` | Groups, filter-group, last-selected-group, panel-position |
| `src/utils.ts` | **Deleted** - no longer needed |
| `Makefile` | Build info generation, install/uninstall targets |
| `PERFORMANCE.md` | **New** - Performance documentation |
| `LICENSE` | Renamed from `LICENCE` |
