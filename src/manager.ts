import { Extension } from "@girs/gnome-shell/extensions/extension";
import Gio from "gi://Gio";
import { HistoryLogger, HistoryAction } from "./history.js";

const TODOS = "todos";
const GROUPS = "groups";
const MAX_GROUPS = 10;
const TASK_VERSION = 1;
const GROUP_VERSION = 1;

export interface Group {
  version: number;
  id: string;
  name: string;
  color: string;
}

export interface Task {
  version: number;
  id: string;
  name: string;
  isDone: boolean;
  isFocused?: boolean;
  groupId?: string;
}

export class TodoListManager {
  GSettings: Gio.Settings;
  private _history: HistoryLogger;
  private _tasksCache: Task[] | null = null;
  private _groupsCache: Group[] | null = null;
  private _todosChangedId: number;
  private _groupsChangedId: number;

  constructor(extension: Extension) {
    this.GSettings = extension.getSettings();
    this._history = new HistoryLogger();

    // Invalidate caches when settings change (e.g., from prefs)
    this._todosChangedId = this.GSettings.connect('changed::todos', () => {
      this._tasksCache = null;
    });
    this._groupsChangedId = this.GSettings.connect('changed::groups', () => {
      this._groupsCache = null;
    });
  }

  destroy() {
    if (this._todosChangedId) {
      this.GSettings.disconnect(this._todosChangedId);
    }
    if (this._groupsChangedId) {
      this.GSettings.disconnect(this._groupsChangedId);
    }
  }

  private _logIfEnabled(action: HistoryAction, data: Parameters<HistoryLogger['log']>[1] = {}) {
    if (this.GSettings.get_boolean('enable-history')) {
      this._history.log(action, data);
    }
  }

  // ===== Migration Methods =====

  private _migrateTask(raw: Record<string, unknown>): Task {
    // v0 (no version): had name, isDone, isFocused - no id, no groupId
    if (!raw.version) {
      return {
        version: TASK_VERSION,
        id: this._generateId(),
        name: raw.name as string,
        isDone: raw.isDone as boolean,
        isFocused: raw.isFocused as boolean | undefined,
        groupId: 'inbox',
      };
    }
    // Already current version
    return raw as unknown as Task;
  }

  private _migrateGroup(raw: Record<string, unknown>): Group {
    // v0 (no version): had id, name, color
    if (!raw.version) {
      return {
        version: GROUP_VERSION,
        id: raw.id as string,
        name: raw.name as string,
        color: raw.color as string,
      };
    }
    // Already current version
    return raw as unknown as Group;
  }

  // ===== Task Methods =====

  get(): string[] {
    return this.GSettings.get_strv(TODOS);
  }

  getParsed(): Task[] {
    // Return cached if available
    if (this._tasksCache) {
      return this._tasksCache;
    }

    const raw = this.get();
    let needsSave = false;
    const tasks = raw.map(t => {
      const parsed = JSON.parse(t);
      if (!parsed.version) needsSave = true;
      return this._migrateTask(parsed);
    });

    if (needsSave) {
      this.GSettings.set_strv(TODOS, tasks.map(t => JSON.stringify(t)));
    }

    this._tasksCache = tasks;
    return tasks;
  }

  // Invalidate cache when we modify tasks
  private _invalidateTasksCache() {
    this._tasksCache = null;
  }

  getTotalUndone(groupId?: string): number {
    const todos = this.getParsed();
    return todos.filter(t => {
      const matchesGroup = !groupId || t.groupId === groupId;
      return !t.isDone && matchesGroup;
    }).length;
  }

  private _generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  add(task: string, groupId?: string) {
    const todos = this.get();
    const newTask: Task = { version: TASK_VERSION, id: this._generateId(), name: task, isDone: false, groupId };
    const newTaskStr = JSON.stringify(newTask);

    if (todos.length > 0) {
      const firstTask: Task = JSON.parse(todos[0]);
      if (firstTask.isFocused) {
        todos.splice(1, 0, newTaskStr);
      } else {
        todos.unshift(newTaskStr);
      }
    } else {
      todos.push(newTaskStr);
    }

    this.GSettings.set_strv(TODOS, todos);

    this._logIfEnabled('added', { taskId: newTask.id, task, group: groupId ? this.getGroup(groupId)?.name : undefined });
  }

  remove(index: number) {
    const todos = this.get();
    if (!todos.length) return;

    const removed: Task = JSON.parse(todos[index]);
    todos.splice(index, 1);
    this.GSettings.set_strv(TODOS, todos);
    this._logIfEnabled('removed', { taskId: removed.id, task: removed.name });
  }

  clearAll() {
    this.GSettings.set_strv(TODOS, []);
    this._logIfEnabled('cleared_all');
  }

  update(index: number, todo: Task) {
    const todos = this.get();
    if (!todos.length) return;

    const oldTask: Task = JSON.parse(todos[index]);

    if (todo.isFocused && index > 0) {
      const tmp = todos[0];
      todos[0] = JSON.stringify(todo);
      todos[index] = tmp;
    } else {
      todos[index] = JSON.stringify(todo);
    }
    this.GSettings.set_strv(TODOS, todos);

    // Log changes
    if (oldTask.name !== todo.name) {
      this._logIfEnabled('renamed', { taskId: todo.id, oldName: oldTask.name, newName: todo.name });
    }
    if (oldTask.isDone !== todo.isDone) {
      this._logIfEnabled(todo.isDone ? 'completed' : 'uncompleted', { taskId: todo.id, task: todo.name });
    }
    if (oldTask.isFocused !== todo.isFocused) {
      this._logIfEnabled(todo.isFocused ? 'focused' : 'unfocused', { taskId: todo.id, task: todo.name });
    }
    if (oldTask.groupId !== todo.groupId) {
      const oldGroup = oldTask.groupId ? this.getGroup(oldTask.groupId)?.name : 'Ungrouped';
      const newGroup = todo.groupId ? this.getGroup(todo.groupId)?.name : 'Ungrouped';
      this._logIfEnabled('moved_group', { taskId: todo.id, task: todo.name, details: `${oldGroup} -> ${newGroup}` });
    }
  }

  // ===== Group Methods =====

  getGroups(): Group[] {
    // Return cached if available
    if (this._groupsCache) {
      return this._groupsCache;
    }

    const raw = this.GSettings.get_strv(GROUPS);
    let needsSave = false;
    const groups = raw.map(g => {
      const parsed = JSON.parse(g);
      if (!parsed.version) needsSave = true;
      return this._migrateGroup(parsed);
    });

    if (needsSave) {
      this.GSettings.set_strv(GROUPS, groups.map(g => JSON.stringify(g)));
    }

    this._groupsCache = groups;
    return groups;
  }

  getGroup(id: string): Group | undefined {
    return this.getGroups().find(g => g.id === id);
  }

  addGroup(name: string, color: string): boolean {
    const groups = this.getGroups();
    if (groups.length >= MAX_GROUPS) return false;

    const id = `group_${Date.now()}`;
    const newGroup: Group = { version: GROUP_VERSION, id, name, color };
    groups.push(newGroup);

    this.GSettings.set_strv(GROUPS, groups.map(g => JSON.stringify(g)));
    this._logIfEnabled('group_created', { groupId: id, group: name });
    return true;
  }

  updateGroup(id: string, name: string, color: string): boolean {
    const groups = this.getGroups();
    const index = groups.findIndex(g => g.id === id);
    if (index === -1) return false;

    const oldName = groups[index].name;
    groups[index] = { version: groups[index].version, id, name, color };

    this.GSettings.set_strv(GROUPS, groups.map(g => JSON.stringify(g)));
    if (oldName !== name) {
      this._logIfEnabled('group_renamed', { groupId: id, oldName, newName: name });
    }
    return true;
  }

  removeGroup(id: string): boolean {
    if (id === 'inbox') return false; // Can't delete inbox

    const groups = this.getGroups();
    const group = groups.find(g => g.id === id);
    if (!group) return false;

    // Move tasks from this group to inbox
    const todos = this.get();
    const updatedTodos = todos.map(t => {
      const task: Task = JSON.parse(t);
      if (task.groupId === id) {
        task.groupId = 'inbox';
      }
      return JSON.stringify(task);
    });
    this.GSettings.set_strv(TODOS, updatedTodos);

    // Remove group
    const filtered = groups.filter(g => g.id !== id);
    this.GSettings.set_strv(GROUPS, filtered.map(g => JSON.stringify(g)));
    this._logIfEnabled('group_deleted', { groupId: id, group: group.name });
    return true;
  }

  getLastSelectedGroup(): string {
    return this.GSettings.get_string('last-selected-group') || 'inbox';
  }

  setLastSelectedGroup(groupId: string) {
    this.GSettings.set_string('last-selected-group', groupId);
  }

  getFilterGroup(): string {
    return this.GSettings.get_string('filter-group') || '';
  }

  setFilterGroup(groupId: string) {
    this.GSettings.set_string('filter-group', groupId);
  }
}
