# TodoZen Features

## Task Groups

Organize your tasks into groups for better categorization.

### Default Group: Inbox
- Every installation starts with an "Inbox" group
- Inbox cannot be deleted, only renamed
- Tasks without a group default to Inbox

### Managing Groups (Preferences)
Open the extension preferences to manage groups:

1. **Add Group** - Click "Add Group" button (max 10 groups)
2. **Rename** - Click the edit icon next to group name
3. **Change Color** - Click the color button to pick a new color
4. **Reorder** - Use up/down arrows to change group order
5. **Delete** - Click trash icon and type the group name to confirm
   - Tasks from deleted groups automatically move to Inbox

### Using Groups (Extension Menu)

#### Filter by Group
- Use the "Filter:" dropdown at the top to show only tasks from a specific group
- Select "All" to show tasks from all groups

#### Assign Tasks to Groups
- Use the dropdown next to the input field to select which group new tasks go into
- The last selected group is remembered for convenience

### Group Display
- Tasks are displayed in collapsible sections by group
- Click a group header to expand/collapse its tasks
- Each section shows the group name and task count
- Group color is shown as a left border accent

## History Logging

TodoZen can log all task actions to a file for tracking and analysis.

### Enable/Disable
Toggle history logging in Preferences under "Data" section.

### Log Location
```
~/.config/todozen/history.jsonl
```

### Log Format
Each line is a JSON object with:
```json
{
  "timestamp": "2024-01-15T12:34:56.789Z",
  "action": "completed",
  "taskId": "task_1234567890_abc123",
  "task": "Buy groceries"
}
```

### Logged Actions

#### Task Actions
| Action | Description |
|--------|-------------|
| `added` | New task created |
| `removed` | Task deleted |
| `completed` | Task marked as done |
| `uncompleted` | Task marked as not done |
| `focused` | Task set as focused (pinned to top) |
| `unfocused` | Task focus removed |
| `renamed` | Task name changed |
| `cleared_all` | All tasks deleted |
| `moved_group` | Task moved to different group |

#### Group Actions
| Action | Description |
|--------|-------------|
| `group_created` | New group added |
| `group_renamed` | Group name changed |
| `group_deleted` | Group removed |

### Analyzing History
The JSONL format allows easy processing:

```bash
# Count completed tasks
grep '"action":"completed"' ~/.config/todozen/history.jsonl | wc -l

# Get today's activity
grep "$(date +%Y-%m-%d)" ~/.config/todozen/history.jsonl

# Find all renames
grep '"action":"renamed"' ~/.config/todozen/history.jsonl
```

## Focus Mode

Pin a task to the top of your list to keep it visible.

- Click the location/pin icon on any task to focus it
- Focused tasks appear at the top with a highlight
- Only one task can be focused at a time
- Click again to unfocus

## Keyboard Shortcut

Open TodoZen quickly with: **Alt+Shift+Space**

(Can be customized in GNOME keyboard settings)

## Panel Position

Choose where the TodoZen button appears in the top panel:
- Left
- Center-Left
- Center
- Center-Right
- Right

Configure in Preferences under "Appearance".
