import { describe, it, expect, beforeEach } from 'vitest';
import {
  Task,
  Group,
  SettingsLike,
  HistoryLoggerLike,
  HistoryAction,
  generateId,
  countUndoneTasks,
  insertTaskAtCorrectPosition,
  moveTaskToTop,
  moveTaskToEndOfGroup,
  moveTasksToGroup,
  canAddGroup,
  canDeleteGroup,
  migrateTask,
  migrateGroup,
  TASK_VERSION,
  GROUP_VERSION,
} from '../src/utils';

// Mock settings - implements SettingsLike interface
class MockSettings implements SettingsLike {
  private store: Map<string, unknown> = new Map();
  private listeners: Map<string, Array<() => void>> = new Map();
  private nextId = 1;

  get_strv(key: string): string[] {
    return (this.store.get(key) as string[]) || [];
  }

  set_strv(key: string, value: string[]) {
    this.store.set(key, value);
    this._notify(`changed::${key}`);
  }

  get_string(key: string): string {
    return (this.store.get(key) as string) || '';
  }

  set_string(key: string, value: string) {
    this.store.set(key, value);
    this._notify(`changed::${key}`);
  }

  get_boolean(key: string): boolean {
    const val = this.store.get(key);
    return val === undefined ? true : (val as boolean);
  }

  connect(signal: string, callback: () => void): number {
    if (!this.listeners.has(signal)) {
      this.listeners.set(signal, []);
    }
    this.listeners.get(signal)!.push(callback);
    return this.nextId++;
  }

  disconnect(_id: number): void {
    // Simple implementation - we don't track by ID in tests
  }

  private _notify(signal: string) {
    const callbacks = this.listeners.get(signal) || [];
    callbacks.forEach(cb => cb());
  }
}

// Mock history logger - implements HistoryLoggerLike interface
class MockHistoryLogger implements HistoryLoggerLike {
  private logs: Array<{ action: HistoryAction; data: Record<string, unknown> }> = [];

  log(action: HistoryAction, data: Record<string, unknown> = {}) {
    this.logs.push({ action, data });
  }

  getLogs() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }
}

const TODOS = 'todos';
const GROUPS = 'groups';
const MAX_GROUPS = 10;

/**
 * TodoListManager for tests.
 *
 * WHY THIS EXISTS:
 * The real manager.ts imports from "gi://Gio" (GNOME) which can't run in Node.js/vitest.
 * This test version uses the same pure functions from utils.ts but provides
 * its own orchestration layer.
 *
 * WHAT'S SHARED (no duplication):
 * - All business logic: moveTaskToTop, insertTaskAtCorrectPosition, countUndoneTasks, etc.
 * - Data types: Task, Group, SettingsLike, HistoryLoggerLike interfaces
 * - Constants: TASK_VERSION, GROUP_VERSION
 *
 * WHAT'S DUPLICATED (must stay in sync with manager.ts):
 * - Constructor initialization (inbox creation, cache setup, signal connections)
 * - Method signatures and orchestration flow (get → transform → set → log)
 * - History logging decision logic (_logIfEnabled checks)
 *
 * IF MANAGER.TS CHANGES: Update this class to match the new orchestration.
 *
 * ALTERNATIVE APPROACHES (not implemented):
 * 1. Mock gi:// imports in vitest - complex, fragile
 * 2. Only test utils.ts pure functions - loses orchestration coverage
 * 3. Integration tests with real GNOME runtime - requires full GNOME environment
 */
class TodoListManager {
  GSettings: SettingsLike;
  private _history: HistoryLoggerLike;
  private _tasksCache: Task[] | null = null;
  private _groupsCache: Group[] | null = null;

  constructor(settings: SettingsLike, history: HistoryLoggerLike) {
    this.GSettings = settings;
    this._history = history;

    // Invalidate caches on settings change (set up BEFORE checking groups)
    this.GSettings.connect('changed::todos', () => { this._tasksCache = null; });
    this.GSettings.connect('changed::groups', () => { this._groupsCache = null; });

    // Initialize default inbox group if none exists
    const rawGroups = this.GSettings.get_strv(GROUPS);
    if (rawGroups.length === 0) {
      const inbox: Group = {
        version: GROUP_VERSION,
        id: 'inbox',
        name: 'Inbox',
        color: '#3584e4',
      };
      this.GSettings.set_strv(GROUPS, [JSON.stringify(inbox)]);
    }
  }

  private _logIfEnabled(action: HistoryAction, data: Record<string, unknown> = {}) {
    if (this.GSettings.get_boolean('enable-history')) {
      this._history.log(action, data);
    }
  }

  // ===== Task Methods =====

  get(): string[] {
    return this.GSettings.get_strv(TODOS);
  }

  getParsed(): Task[] {
    if (this._tasksCache) return this._tasksCache;

    const raw = this.get();
    let needsSave = false;
    const tasks = raw.map(t => {
      const parsed = JSON.parse(t);
      if (!parsed.version) {
        needsSave = true;
        return migrateTask(parsed);
      }
      return parsed as Task;
    });

    if (needsSave) {
      this.GSettings.set_strv(TODOS, tasks.map(t => JSON.stringify(t)));
    }
    this._tasksCache = tasks;
    return tasks;
  }

  getTotalUndone(groupId?: string): number {
    return countUndoneTasks(this.getParsed(), groupId);
  }

  add(taskName: string, groupId?: string): Task {
    const todos = this.get();
    const newTask: Task = {
      version: TASK_VERSION,
      id: generateId(),
      name: taskName,
      isDone: false,
      groupId: groupId || 'inbox',
    };

    const updatedTodos = insertTaskAtCorrectPosition(todos, JSON.stringify(newTask));
    this.GSettings.set_strv(TODOS, updatedTodos);
    this._logIfEnabled('added', { taskId: newTask.id, task: taskName });
    return newTask;
  }

  remove(index: number) {
    const todos = this.get();
    if (!todos.length || index < 0 || index >= todos.length) return;

    const removed: Task = JSON.parse(todos[index]);
    todos.splice(index, 1);
    this.GSettings.set_strv(TODOS, todos);
    this._logIfEnabled('removed', { taskId: removed.id, task: removed.name });
  }

  update(index: number, todo: Task) {
    const todos = this.get();
    if (!todos.length) return;

    const oldTask: Task = JSON.parse(todos[index]);
    const { todos: updatedTodos, unfocusedTasks } = moveTaskToTop(todos, index, todo);
    this.GSettings.set_strv(TODOS, updatedTodos);

    // Log unfocused tasks
    for (const unfocused of unfocusedTasks) {
      this._logIfEnabled('unfocused', { taskId: unfocused.id, task: unfocused.name });
    }

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

  clearAll() {
    this.GSettings.set_strv(TODOS, []);
    this._logIfEnabled('cleared_all', {});
  }

  // ===== Group Methods =====

  getGroups(): Group[] {
    if (this._groupsCache) return this._groupsCache;

    const raw = this.GSettings.get_strv(GROUPS);
    const groups = raw.map(g => {
      const parsed = JSON.parse(g);
      if (!parsed.version) {
        return migrateGroup(parsed);
      }
      return parsed as Group;
    });
    this._groupsCache = groups;
    return groups;
  }

  getGroup(id: string): Group | undefined {
    return this.getGroups().find(g => g.id === id);
  }

  addGroup(name: string, color: string): boolean {
    const groups = this.getGroups();
    if (!canAddGroup(groups.length, MAX_GROUPS)) return false;

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
    if (!canDeleteGroup(id)) return false;

    const groups = this.getGroups();
    const group = groups.find(g => g.id === id);
    if (!group) return false;

    // Move tasks to inbox using pure function
    const todos = this.get();
    const updatedTodos = moveTasksToGroup(todos, id, 'inbox');
    this.GSettings.set_strv(TODOS, updatedTodos);

    // Remove group
    const filtered = groups.filter(g => g.id !== id);
    this.GSettings.set_strv(GROUPS, filtered.map(g => JSON.stringify(g)));
    this._logIfEnabled('group_deleted', { groupId: id, group: group.name });
    return true;
  }

  // ===== Settings =====

  getLastSelectedGroup(): string {
    return this.GSettings.get_string('last-selected-group') || 'inbox';
  }

  setLastSelectedGroup(groupId: string) {
    this.GSettings.set_string('last-selected-group', groupId);
  }
}

describe('TodoListManager', () => {
  let settings: MockSettings;
  let historyLogger: MockHistoryLogger;
  let manager: TodoListManager;

  beforeEach(() => {
    settings = new MockSettings();
    historyLogger = new MockHistoryLogger();
    manager = new TodoListManager(settings, historyLogger);
  });

  describe('Task Operations', () => {
    it('should add a task', () => {
      const task = manager.add('Buy groceries');
      expect(task.name).toBe('Buy groceries');
      expect(task.isDone).toBe(false);
      expect(task.version).toBe(1);
      expect(task.id).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it('should add task with group', () => {
      manager.addGroup('Work', '#ff0000');
      const groups = manager.getGroups();
      const workGroup = groups.find(g => g.name === 'Work')!;

      const task = manager.add('Finish report', workGroup.id);
      expect(task.groupId).toBe(workGroup.id);
    });

    it('should add new tasks at the top', () => {
      manager.add('First task');
      manager.add('Second task');
      const tasks = manager.getParsed();
      expect(tasks[0].name).toBe('Second task');
      expect(tasks[1].name).toBe('First task');
    });

    it('should insert after focused task', () => {
      const first = manager.add('First task');
      manager.update(0, { ...first, isFocused: true });
      manager.add('Second task');

      const tasks = manager.getParsed();
      expect(tasks[0].isFocused).toBe(true);
      expect(tasks[1].name).toBe('Second task');
    });

    it('should remove a task', () => {
      manager.add('Task to remove');
      expect(manager.getParsed().length).toBe(1);

      manager.remove(0);
      expect(manager.getParsed().length).toBe(0);
    });

    it('should mark task as done', () => {
      const task = manager.add('Complete me');
      manager.update(0, { ...task, isDone: true });

      const updated = manager.getParsed()[0];
      expect(updated.isDone).toBe(true);
    });

    it('should count undone tasks', () => {
      manager.add('Task 1');
      manager.add('Task 2');
      const task = manager.add('Task 3');
      manager.update(0, { ...task, isDone: true });

      expect(manager.getTotalUndone()).toBe(2);
    });

    it('should count undone tasks by group', () => {
      manager.addGroup('Work', '#ff0000');
      const groups = manager.getGroups();
      const workGroup = groups.find(g => g.name === 'Work')!;

      manager.add('Work task', workGroup.id);
      manager.add('Inbox task', 'inbox');

      expect(manager.getTotalUndone(workGroup.id)).toBe(1);
      expect(manager.getTotalUndone('inbox')).toBe(1);
    });

    it('should clear all tasks', () => {
      manager.add('Task 1');
      manager.add('Task 2');
      manager.clearAll();

      expect(manager.getParsed().length).toBe(0);
    });

    it('should move focused task to top', () => {
      manager.add('First');
      manager.add('Second');
      manager.add('Third');

      const tasks = manager.getParsed();
      manager.update(1, { ...tasks[1], isFocused: true });

      const updated = manager.getParsed();
      expect(updated[0].isFocused).toBe(true);
    });
  });

  describe('Group Operations', () => {
    it('should have inbox group by default', () => {
      const groups = manager.getGroups();
      expect(groups.length).toBe(1);
      expect(groups[0].id).toBe('inbox');
      expect(groups[0].name).toBe('Inbox');
    });

    it('should add a group', () => {
      const result = manager.addGroup('Work', '#ff0000');
      expect(result).toBe(true);

      const groups = manager.getGroups();
      expect(groups.length).toBe(2);
      expect(groups[1].name).toBe('Work');
      expect(groups[1].color).toBe('#ff0000');
    });

    it('should limit groups to 10', () => {
      for (let i = 0; i < 9; i++) {
        manager.addGroup(`Group ${i}`, '#000000');
      }
      expect(manager.getGroups().length).toBe(10);

      const result = manager.addGroup('Too many', '#ffffff');
      expect(result).toBe(false);
      expect(manager.getGroups().length).toBe(10);
    });

    it('should update group', () => {
      manager.addGroup('Work', '#ff0000');
      const group = manager.getGroups().find(g => g.name === 'Work')!;

      manager.updateGroup(group.id, 'Office', '#00ff00');

      const updated = manager.getGroup(group.id)!;
      expect(updated.name).toBe('Office');
      expect(updated.color).toBe('#00ff00');
    });

    it('should not delete inbox', () => {
      const result = manager.removeGroup('inbox');
      expect(result).toBe(false);
      expect(manager.getGroups().length).toBe(1);
    });

    it('should delete group and move tasks to inbox', () => {
      manager.addGroup('Work', '#ff0000');
      const groups = manager.getGroups();
      const workGroup = groups.find(g => g.name === 'Work')!;

      manager.add('Work task', workGroup.id);

      const result = manager.removeGroup(workGroup.id);
      expect(result).toBe(true);

      const tasks = manager.getParsed();
      expect(tasks[0].groupId).toBe('inbox');
      expect(manager.getGroups().length).toBe(1);
    });
  });

  describe('History Logging', () => {
    it('should log task added', () => {
      manager.add('New task');
      const logs = historyLogger.getLogs();
      expect(logs[0].action).toBe('added');
      expect(logs[0].data.task).toBe('New task');
    });

    it('should log task removed', () => {
      manager.add('Task to remove');
      manager.remove(0);

      const logs = historyLogger.getLogs();
      expect(logs[1].action).toBe('removed');
    });

    it('should log task completed', () => {
      const task = manager.add('Complete me');
      manager.update(0, { ...task, isDone: true });

      const logs = historyLogger.getLogs();
      expect(logs[1].action).toBe('completed');
    });

    it('should log task uncompleted', () => {
      const task = manager.add('Toggle me');
      manager.update(0, { ...task, isDone: true });
      const completed = manager.getParsed()[0];
      manager.update(0, { ...completed, isDone: false });

      const logs = historyLogger.getLogs();
      expect(logs[2].action).toBe('uncompleted');
    });

    it('should log clear all', () => {
      manager.add('Task');
      manager.clearAll();

      const logs = historyLogger.getLogs();
      expect(logs[1].action).toBe('cleared_all');
    });

    it('should log group created', () => {
      manager.addGroup('Projects', '#123456');

      const logs = historyLogger.getLogs();
      expect(logs[0].action).toBe('group_created');
      expect(logs[0].data.group).toBe('Projects');
    });

    it('should log group renamed', () => {
      manager.addGroup('Work', '#ff0000');
      const group = manager.getGroups().find(g => g.name === 'Work')!;
      manager.updateGroup(group.id, 'Office', '#ff0000');

      const logs = historyLogger.getLogs();
      expect(logs[1].action).toBe('group_renamed');
      expect(logs[1].data.oldName).toBe('Work');
      expect(logs[1].data.newName).toBe('Office');
    });

    it('should log group deleted', () => {
      manager.addGroup('Work', '#ff0000');
      const group = manager.getGroups().find(g => g.name === 'Work')!;
      manager.removeGroup(group.id);

      const logs = historyLogger.getLogs();
      expect(logs[1].action).toBe('group_deleted');
      expect(logs[1].data.group).toBe('Work');
    });

    it('should log moved_group when task group changes via update', () => {
      manager.addGroup('Work', '#ff0000');
      const workGroup = manager.getGroups().find(g => g.name === 'Work')!;

      const task = manager.add('My task', 'inbox');
      const originalId = task.id;
      const storedTask = manager.getParsed()[0];

      manager.update(0, { ...storedTask, groupId: workGroup.id });

      const logs = historyLogger.getLogs();
      const moveLog = logs.find(l => l.action === 'moved_group');
      expect(moveLog).toBeDefined();
      expect(moveLog!.data.task).toBe('My task');
      expect(moveLog!.data.details).toBe('Inbox -> Work');

      const updatedTask = manager.getParsed()[0];
      expect(updatedTask.id).toBe(originalId);
      expect(updatedTask.groupId).toBe(workGroup.id);
    });

    it('should preserve all task properties when changing group', () => {
      manager.addGroup('Work', '#ff0000');
      const workGroup = manager.getGroups().find(g => g.name === 'Work')!;

      const task = manager.add('Important task', 'inbox');
      const originalId = task.id;

      manager.update(0, { ...task, isDone: true, isFocused: true });
      const modifiedTask = manager.getParsed()[0];

      manager.update(0, { ...modifiedTask, groupId: workGroup.id });

      const finalTask = manager.getParsed()[0];
      expect(finalTask.id).toBe(originalId);
      expect(finalTask.name).toBe('Important task');
      expect(finalTask.isDone).toBe(true);
      expect(finalTask.groupId).toBe(workGroup.id);
    });
  });

  describe('Migration', () => {
    it('should migrate tasks without version', () => {
      settings.set_strv('todos', [JSON.stringify({
        name: 'Old task',
        isDone: false,
      })]);

      const tasks = manager.getParsed();
      expect(tasks[0].version).toBe(1);
      expect(tasks[0].id).toMatch(/^task_/);
      expect(tasks[0].groupId).toBe('inbox');
    });

    it('should migrate groups without version', () => {
      settings.set_strv('groups', [JSON.stringify({
        id: 'inbox',
        name: 'Inbox',
        color: '#3584e4',
      })]);

      const groups = manager.getGroups();
      expect(groups[0].version).toBe(1);
    });
  });

  describe('Settings', () => {
    it('should remember last selected group', () => {
      manager.addGroup('Work', '#ff0000');
      const group = manager.getGroups().find(g => g.name === 'Work')!;

      manager.setLastSelectedGroup(group.id);
      expect(manager.getLastSelectedGroup()).toBe(group.id);
    });

    it('should default to inbox for last selected group', () => {
      expect(manager.getLastSelectedGroup()).toBe('inbox');
    });
  });

  describe('Edge Cases', () => {
    it('should generate unique task IDs', () => {
      const task1 = manager.add('Task 1');
      const task2 = manager.add('Task 2');
      const task3 = manager.add('Task 3');

      const ids = [task1.id, task2.id, task3.id];
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it('should handle tasks with special characters', () => {
      const task = manager.add('Task with "quotes" & <special> chars');
      const parsed = manager.getParsed()[0];
      expect(parsed.name).toBe('Task with "quotes" & <special> chars');
    });

    it('should handle empty task list operations gracefully', () => {
      expect(() => manager.remove(0)).not.toThrow();
      expect(() => manager.update(0, { version: 1, id: 'x', name: 'x', isDone: false } as Task)).not.toThrow();
    });

    it('should handle non-existent group lookup', () => {
      const group = manager.getGroup('nonexistent');
      expect(group).toBeUndefined();
    });

    it('should not rename group that does not exist', () => {
      const result = manager.updateGroup('nonexistent', 'New Name', '#000000');
      expect(result).toBe(false);
    });

    it('should not delete group that does not exist', () => {
      const result = manager.removeGroup('nonexistent');
      expect(result).toBe(false);
    });

    it('should handle multiple tasks being deleted from deleted group', () => {
      manager.addGroup('Work', '#ff0000');
      const workGroup = manager.getGroups().find(g => g.name === 'Work')!;

      manager.add('Work task 1', workGroup.id);
      manager.add('Work task 2', workGroup.id);
      manager.add('Work task 3', workGroup.id);

      manager.removeGroup(workGroup.id);

      const tasks = manager.getParsed();
      expect(tasks.every(t => t.groupId === 'inbox')).toBe(true);
    });
  });

  describe('Task Filtering', () => {
    it('should count all undone when no filter', () => {
      manager.addGroup('Work', '#ff0000');
      const workGroup = manager.getGroups().find(g => g.name === 'Work')!;

      manager.add('Inbox task 1', 'inbox');
      manager.add('Inbox task 2', 'inbox');
      manager.add('Work task', workGroup.id);

      expect(manager.getTotalUndone()).toBe(3);
    });

    it('should count undone only in filtered group', () => {
      manager.addGroup('Work', '#ff0000');
      const workGroup = manager.getGroups().find(g => g.name === 'Work')!;

      manager.add('Inbox task', 'inbox');
      manager.add('Work task 1', workGroup.id);
      manager.add('Work task 2', workGroup.id);

      expect(manager.getTotalUndone()).toBe(3);
      expect(manager.getTotalUndone(workGroup.id)).toBe(2);
      expect(manager.getTotalUndone('inbox')).toBe(1);
    });
  });

  describe('Task Rename', () => {
    it('should rename a task', () => {
      const task = manager.add('Original name');
      manager.update(0, { ...task, name: 'New name' });

      const updated = manager.getParsed()[0];
      expect(updated.name).toBe('New name');
    });

    it('should log rename action', () => {
      const task = manager.add('Original');
      manager.update(0, { ...task, name: 'Renamed' });

      const logs = historyLogger.getLogs();
      const renameLog = logs.find(l => l.action === 'renamed');
      expect(renameLog).toBeDefined();
      expect(renameLog?.data.oldName).toBe('Original');
      expect(renameLog?.data.newName).toBe('Renamed');
    });
  });

  describe('Focus Behavior', () => {
    it('should only allow one focused task at a time', () => {
      manager.add('Task 1');
      manager.add('Task 2');
      manager.add('Task 3');

      const tasks = manager.getParsed();
      manager.update(2, { ...tasks[2], isFocused: true });

      const afterFirst = manager.getParsed();
      expect(afterFirst[0].isFocused).toBe(true);

      manager.update(1, { ...afterFirst[1], isFocused: true });

      const afterSecond = manager.getParsed();
      const focusedCount = afterSecond.filter(t => t.isFocused).length;
      expect(focusedCount).toBe(1);
      expect(afterSecond[0].isFocused).toBe(true);
    });

    it('should not move already-first task when focused', () => {
      const task = manager.add('Only task');
      manager.update(0, { ...task, isFocused: true });

      const tasks = manager.getParsed();
      expect(tasks.length).toBe(1);
      expect(tasks[0].isFocused).toBe(true);
    });

    it('should log unfocused when another task is focused', () => {
      manager.add('Task 1');
      manager.add('Task 2');

      const tasks = manager.getParsed();
      manager.update(1, { ...tasks[1], isFocused: true });

      historyLogger.clear();

      const afterFirst = manager.getParsed();
      manager.update(1, { ...afterFirst[1], isFocused: true });

      const logs = historyLogger.getLogs();
      const unfocusLog = logs.find(l => l.action === 'unfocused');
      expect(unfocusLog).toBeDefined();
    });
  });
});
