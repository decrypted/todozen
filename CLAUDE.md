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

## IMPORTANT: Adding New TypeScript Files

When adding a new `.ts` file to `src/`, you MUST update these locations:

1. **`Makefile` line ~39** - Add the `.js` filename to the `cp` command in the `install` target
2. **`build.sh` line ~42** - Add the `.js` filename to the `cp` command
3. **`Makefile` verify-dist target** - Add the `.js` filename to the file list

If you forget, `make check` will fail with "ERROR: Missing files in zip: yourfile.js".

Current source files: `extension.js`, `manager.js`, `history.js`, `prefs.js`, `utils.js`

## Build & Install
```bash
make build      # Compile TypeScript
make schemas    # Compile GSettings schemas
make install    # Install to ~/.local/share/gnome-shell/extensions/
make uninstall  # Remove extension
make dist       # Create distributable zip
```

After install, logout/login is required (Wayland limitation - see wayland.md).

## Architecture

### Key Files
- `src/extension.ts` - Main extension UI (PanelMenu.Button, popup menu, task list)
- `src/manager.ts` - Data layer (Task/Group CRUD via GSettings)
- `src/history.ts` - JSONL logging to `~/.config/todozen/history.jsonl`
- `src/prefs.ts` - Settings UI (panel position, history toggle)
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
- Task: added, removed, completed, uncompleted, focused, unfocused, renamed, cleared_all, moved_group
- Group: group_created, group_renamed, group_deleted

### GSettings Keys
- `todos` - string array of JSON Task objects
- `groups` - string array of JSON Group objects
- `last-selected-group` - string (group ID for new tasks)
- `filter-group` - string (filter display by group, empty = all)
- `panel-position` - enum (left, center-left, center, center-right, right)
- `enable-history` - boolean
- `open-todozen` - keybinding (default Alt+Shift+Space)

## Testing & Linting
```bash
make test       # Run unit tests
make lint       # Check code style
make lint-fix   # Auto-fix lint issues
make check      # Run all checks (TypeScript + ESLint + tests)
```

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
