# TodoZen - GNOME Shell Extension

## Project Overview
TodoZen is a GNOME Shell extension for managing tasks with minimal CPU usage. It uses GSettings for data persistence (no polling, no file I/O in the main loop).

## Key Goals

### Performance (Critical)
1. **Zero idle CPU usage** - No polling, timers, or background activity when not in use
2. **Minimal memory footprint** - No caching large data structures, parse on demand
3. **Lazy UI population** - Don't build task list until menu is opened
4. **Single GSettings writes** - Batch operations (e.g., clearAll) instead of N individual writes
5. **Proper cleanup** - Disconnect all signals, remove all timeouts in disable()
6. **No memory leaks** - Destroy widgets properly, null out references, avoid circular refs

### CSS (Minimal & Performant)
1. **No unused selectors** - Remove CSS for deleted features
2. **No duplicate rules** - Each selector defined once
3. **Simple selectors** - Avoid deep nesting, prefer single class selectors
4. **Minimal specificity** - No `!important` unless absolutely necessary
5. **No expensive properties** - Avoid box-shadow, filters, animations on frequently updated elements

### Code Quality
1. TypeScript with strict mode
2. ESLint for code style
3. Unit tests for manager logic
4. Versioned data model for future migrations
5. **Coverage thresholds** - `make check` enforces 95%+ coverage on utils.ts

### Dependencies
1. **Keep up to date** - Run `yarn outdated` regularly, update non-breaking dependencies
2. **Use yarn consistently** - All commands use `yarn run`, not npm

### GNOME Compatibility
See **[GNOME.md](GNOME.md)** for full reference (Ubuntu versions, type packages, cross-version workarounds).

**Quick reference:**
- **Develop against** `@girs/gnome-shell@^46.0.0` (oldest available types)
- **Target runtime** GNOME 42-49 (Ubuntu 22.04 LTS and newer)
- **Run** `make check-compat` to test against both 46 and 49 types
- **Use** `@ts-ignore` (not `@ts-expect-error`) for cross-version type differences

## IMPORTANT: Adding New TypeScript Files

When adding a new `.ts` file to `src/`, update `JS_FILES` at the top of **`Makefile`**:

```makefile
JS_FILES = extension.js manager.js history.js prefs.js utils.js
```

This variable is used by all build targets (`make install`, `make pack`, `make dist`, `make verify-dist`).

If you forget, `make check` will fail with "ERROR: Missing files in zip: yourfile.js".

## Build & Install
```bash
make build      # Compile TypeScript
make schemas    # Compile GSettings schemas
make install    # Install to ~/.local/share/gnome-shell/extensions/
make uninstall  # Remove extension
make pack       # Create distributable zip
make dist       # Create dist/ directory (for CI)
make clean      # Remove build artifacts
```

After install, logout/login is required (Wayland limitation - see wayland.md).

## Architecture

### Key Files
- `src/extension.ts` - Main extension UI (PanelMenu.Button, popup menu, task list)
- `src/manager.ts` - Data layer (Task/Group CRUD via GSettings)
- `src/utils.ts` - Pure functions (URL extraction, validation, task operations) - fully unit tested
- `src/history.ts` - JSONL logging to `~/.config/todozen/history.jsonl`
- `src/prefs.ts` - Settings UI (panel position, popup width, history toggle)
- `prefs.ui` - GTK4/Libadwaita preferences UI definition
- `schemas/org.gnome.shell.extensions.todozen.gschema.xml` - GSettings schema

### Data Model
Tasks and Groups have version fields for future migrations:
```typescript
interface Task {
  version: number;  // Current: 1
  id: string;       // Unique ID: task_<timestamp>_<random>
  name: string;
  isDone: boolean;
  isFocused?: boolean;
  groupId?: string; // References Group.id
}

interface Group {
  version: number;  // Current: 1
  id: string;       // Unique ID: group_<timestamp> or 'inbox'
  name: string;
  color: string;    // Hex color like #3584e4
}
```

### History Actions
Logged to JSONL when `enable-history` is true:
- Task: added, removed, completed, uncompleted, focused, unfocused, renamed, cleared_all, moved_group, moved_to_end
- Group: group_created, group_renamed, group_deleted

### GSettings Keys
- `todos` - string array of JSON Task objects
- `groups` - string array of JSON Group objects
- `last-selected-group` - string (group ID for new tasks)
- `filter-group` - string (filter display by group, empty = all)
- `panel-position` - enum (left, center-left, center, center-right, right)
- `popup-width` - enum (normal=500px, wide=700px, ultra=900px)
- `enable-history` - boolean
- `show-move-to-end-button` - boolean (show button to move task to end of group)
- `show-pinned-in-panel` - boolean (show pinned task in top panel)
- `open-todozen` - keybinding (default Alt+Shift+Space)

## Testing & Linting
```bash
make test          # Run unit tests
make test-coverage # Run tests with coverage report
make lint          # Check code style
make lint-fix      # Auto-fix lint issues
make check         # All checks (TypeScript + ESLint + tests + verify-dist + GNOME compat)
make check-compat  # Test TypeScript against GNOME 46 and 49 types only
```

### Testing Architecture

**The Problem:** GNOME Shell extensions use `gi://` imports (Gio, GLib, St, Clutter) that only work inside the GNOME Shell process. These cannot run in Node.js/vitest.

**The Solution:** Separate pure business logic from GNOME UI code.

```
┌─────────────────────────────────────────────────────────────┐
│                    extension.ts / prefs.ts                  │
│                    (GNOME UI - untestable)                  │
│  - Widget creation (St.*, Gtk.*, Adw.*)                     │
│  - Signal connections                                       │
│  - Event handlers                                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ calls
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       manager.ts                            │
│              (Orchestration - tested via mirror)            │
│  - Accepts SettingsLike interface (not Gio.Settings)        │
│  - Uses pure functions from utils.ts                        │
│  - Handles history logging decisions                        │
└─────────────────────────┬───────────────────────────────────┘
                          │ imports
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                        utils.ts                             │
│               (Pure functions - fully testable)             │
│  - Task operations (move, insert, filter, group)            │
│  - URL extraction, text formatting                          │
│  - Validation, migrations                                   │
│  - NO gi:// imports                                         │
└─────────────────────────────────────────────────────────────┘
```

**Key Patterns:**

1. **Dependency Injection** - `manager.ts` accepts `SettingsLike` interface instead of `Gio.Settings`:
   ```typescript
   // In production: new TodoListManager(this.getSettings())
   // In tests: new TodoListManager(mockSettings)
   ```

2. **Pure Functions** - All business logic in `utils.ts` with no side effects:
   ```typescript
   // These can be tested directly
   moveTaskToTop(todos, index, task)
   filterTasksByGroup(tasks, groupId)
   getPinnedTaskDisplay(tasks, enabled)
   ```

3. **Test Mirror** - `tests/manager.test.ts` has its own `TodoListManager` class that:
   - Uses the same pure functions from `utils.ts`
   - Provides mock `SettingsLike` implementation
   - Tests the orchestration logic without GNOME imports

4. **Edge Case Robustness** - All extracted functions handle invalid input gracefully:
   ```typescript
   // Returns default instead of throwing
   rgbaToHex(null)  // → '#3584e4'
   getPositionConfig(undefined)  // → { box: 'right', index: 0 }
   ```

**What's Testable:**

| File | Testable | Why |
|------|----------|-----|
| `utils.ts` | ✅ 100% | Pure functions, no GNOME imports |
| `manager.ts` | ⚠️ Via mirror | Uses utils.ts, orchestration tested indirectly |
| `history.ts` | ⚠️ Partial | Pure logic in utils.ts, file I/O untestable |
| `extension.ts` | ❌ ~5% | GNOME UI widgets |
| `prefs.ts` | ❌ ~2% | GTK4 UI widgets |

**Adding New Logic:**

1. If it's pure computation → add to `utils.ts` with tests
2. If it needs GSettings → use `SettingsLike` interface
3. If it's UI → keep in extension.ts/prefs.ts (untestable)

## GNOME Shell Constraints
- Extensions run in the shell process - avoid blocking operations
- Use GLib.timeout_add for delays, not setTimeout
- St widgets (St.Label, St.Button, etc.) for UI
- Clutter for event handling
- Must properly disconnect signals and remove timeouts in disable()

## Migration System
On load, tasks/groups without `version` field are migrated:
- Tasks get: version=1, new ID, groupId='inbox'
- Groups get: version=1

Migrations are saved back to GSettings immediately.

## IMPORTANT: Task Identification is ID-Based

**All task operations MUST use `task.id` for identification, NEVER `task.name`.**

The manager uses array index for GSettings operations, but the index is always found by ID:
```typescript
// CORRECT: Find by ID, operate by index
const index = todos.findIndex(t => t.id === taskId);
this._manager?.update(index, updatedTask);

// WRONG: Never match by name
const index = todos.findIndex(t => t.name === taskName); // DON'T DO THIS
```

The `name` field is only used for:
- Display (showing task text in UI)
- Validation (ensuring task has a name)
- History logging (detecting renames)
- Confirmation dialogs (UX)

### Edit/Rename Behavior (v3.3.0+)
When editing a task:
1. Store `_editingTaskId` (task stays in list, just hidden from display)
2. On submit: find task by ID, update with new name
3. On cancel (close popup/lose focus): clear `_editingTaskId`, task reappears

**Never delete a task when entering edit mode** - this caused data loss in v3.2.0 if edit was cancelled.
