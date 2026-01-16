import { Extension } from "@girs/gnome-shell/extensions/extension";
import Gio from "gi://Gio";
import { HistoryLogger } from "./history.js";
import {
  Task,
  Group,
  HistoryAction,
  TASK_VERSION,
  migrateTask,
  migrateGroup,
  generateId,
  countUndoneTasks,
  insertTaskAtCorrectPosition,
  moveTaskToTop,
  moveTaskToEndOfGroup,
  moveTasksToGroup,
  canAddGroup,
  canDeleteGroup,
} from "./utils.js";

// Re-export types for convenience
export type { Task, Group };

const TODOS = "todos";
const GROUPS = "groups";
const MAX_GROUPS = 10;

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
      return migrateTask(parsed);
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
    return countUndoneTasks(this.getParsed(), groupId);
  }

  add(task: string, groupId?: string) {
    const todos = this.get();
    const newTask: Task = { version: TASK_VERSION, id: generateId('task'), name: task, isDone: false, groupId };
    const newTaskStr = JSON.stringify(newTask);
    const updatedTodos = insertTaskAtCorrectPosition(todos, newTaskStr);
    this.GSettings.set_strv(TODOS, updatedTodos);
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
    const updatedTodos = moveTaskToTop(todos, index, todo);
    this.GSettings.set_strv(TODOS, updatedTodos);

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

  moveToEndOfGroup(index: number) {
    const todos = this.get();
    if (!todos.length || index < 0 || index >= todos.length) return;

    const task: Task = JSON.parse(todos[index]);
    const updatedTodos = moveTaskToEndOfGroup(todos, index);
    this.GSettings.set_strv(TODOS, updatedTodos);
    this._logIfEnabled('moved_to_end', { taskId: task.id, task: task.name });
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
      return migrateGroup(parsed);
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
    if (!canAddGroup(groups.length, MAX_GROUPS)) return false;

    const id = generateId('group');
    const newGroup: Group = { version: 1, id, name, color };
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
    if (!canDeleteGroup(id)) return false;

    const groups = this.getGroups();
    const group = groups.find(g => g.id === id);
    if (!group) return false;

    // Move tasks from this group to inbox
    const updatedTodos = moveTasksToGroup(this.get(), id, 'inbox');
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
