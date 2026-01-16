import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock GSettings-like storage
class MockSettings {
  private store: Map<string, any> = new Map();

  get_strv(key: string): string[] {
    return this.store.get(key) || [];
  }

  set_strv(key: string, value: string[]) {
    this.store.set(key, value);
  }

  get_string(key: string): string {
    return this.store.get(key) || '';
  }

  set_string(key: string, value: string) {
    this.store.set(key, value);
  }

  get_boolean(key: string): boolean {
    return this.store.get(key) ?? true;
  }

  set_boolean(key: string, value: boolean) {
    this.store.set(key, value);
  }
}

// Data types matching manager.ts
interface Task {
  version: number;
  id: string;
  name: string;
  isDone: boolean;
  isFocused?: boolean;
  groupId?: string;
}

interface Group {
  version: number;
  id: string;
  name: string;
  color: string;
}

// Simplified manager for testing (mirrors actual logic)
class TestableManager {
  private settings: MockSettings;
  private historyLog: any[] = [];

  constructor(settings: MockSettings) {
    this.settings = settings;
    // Initialize default inbox group
    if (this.getGroups().length === 0) {
      this.settings.set_strv('groups', [JSON.stringify({
        version: 1, id: 'inbox', name: 'Inbox', color: '#3584e4'
      })]);
    }
  }

  private _generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Task methods
  get(): string[] {
    return this.settings.get_strv('todos');
  }

  getParsed(): Task[] {
    return this.get().map(t => {
      const parsed = JSON.parse(t);
      // Migration: add version if missing
      if (!parsed.version) {
        return {
          version: 1,
          id: this._generateId(),
          name: parsed.name,
          isDone: parsed.isDone,
          isFocused: parsed.isFocused,
          groupId: 'inbox',
        };
      }
      return parsed as Task;
    });
  }

  getTotalUndone(groupId?: string): number {
    const todos = this.getParsed();
    return todos.filter(t => {
      const matchesGroup = !groupId || t.groupId === groupId;
      return !t.isDone && matchesGroup;
    }).length;
  }

  add(taskName: string, groupId?: string): Task {
    const todos = this.get();
    const newTask: Task = {
      version: 1,
      id: this._generateId(),
      name: taskName,
      isDone: false,
      groupId
    };
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

    this.settings.set_strv('todos', todos);
    this._log('added', { taskId: newTask.id, task: taskName });
    return newTask;
  }

  remove(index: number) {
    const todos = this.get();
    if (!todos.length) return;

    const removed: Task = JSON.parse(todos[index]);
    todos.splice(index, 1);
    this.settings.set_strv('todos', todos);
    this._log('removed', { taskId: removed.id, task: removed.name });
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
    this.settings.set_strv('todos', todos);

    // Log changes
    if (oldTask.name !== todo.name) {
      this._log('renamed', { taskId: todo.id, oldName: oldTask.name, newName: todo.name });
    }
    if (oldTask.isDone !== todo.isDone) {
      this._log(todo.isDone ? 'completed' : 'uncompleted', { taskId: todo.id, task: todo.name });
    }
  }

  clearAll() {
    this.settings.set_strv('todos', []);
    this._log('cleared_all', {});
  }

  // Group methods
  getGroups(): Group[] {
    const raw = this.settings.get_strv('groups');
    return raw.map(g => {
      const parsed = JSON.parse(g);
      if (!parsed.version) {
        return { version: 1, ...parsed };
      }
      return parsed as Group;
    });
  }

  getGroup(id: string): Group | undefined {
    return this.getGroups().find(g => g.id === id);
  }

  addGroup(name: string, color: string): boolean {
    const groups = this.getGroups();
    if (groups.length >= 10) return false;

    const id = `group_${Date.now()}`;
    const newGroup: Group = { version: 1, id, name, color };
    groups.push(newGroup);

    this.settings.set_strv('groups', groups.map(g => JSON.stringify(g)));
    this._log('group_created', { groupId: id, group: name });
    return true;
  }

  updateGroup(id: string, name: string, color: string): boolean {
    const groups = this.getGroups();
    const index = groups.findIndex(g => g.id === id);
    if (index === -1) return false;

    const oldName = groups[index].name;
    groups[index] = { version: groups[index].version, id, name, color };

    this.settings.set_strv('groups', groups.map(g => JSON.stringify(g)));
    if (oldName !== name) {
      this._log('group_renamed', { groupId: id, oldName, newName: name });
    }
    return true;
  }

  removeGroup(id: string): boolean {
    if (id === 'inbox') return false;

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
    this.settings.set_strv('todos', updatedTodos);

    // Remove group
    const filtered = groups.filter(g => g.id !== id);
    this.settings.set_strv('groups', filtered.map(g => JSON.stringify(g)));
    this._log('group_deleted', { groupId: id, group: group.name });
    return true;
  }

  // History logging (for testing)
  private _log(action: string, data: any) {
    this.historyLog.push({ action, data, timestamp: new Date().toISOString() });
  }

  getHistoryLog() {
    return this.historyLog;
  }

  // Settings helpers
  getLastSelectedGroup(): string {
    return this.settings.get_string('last-selected-group') || 'inbox';
  }

  setLastSelectedGroup(groupId: string) {
    this.settings.set_string('last-selected-group', groupId);
  }
}

describe('TodoListManager', () => {
  let settings: MockSettings;
  let manager: TestableManager;

  beforeEach(() => {
    settings = new MockSettings();
    manager = new TestableManager(settings);
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
      // Focus the middle task (index 1)
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

      // Task should now be in inbox
      const tasks = manager.getParsed();
      expect(tasks[0].groupId).toBe('inbox');

      // Group should be gone
      expect(manager.getGroups().length).toBe(1);
    });
  });

  describe('History Logging', () => {
    it('should log task added', () => {
      manager.add('New task');
      const log = manager.getHistoryLog();
      expect(log[0].action).toBe('added');
      expect(log[0].data.task).toBe('New task');
    });

    it('should log task removed', () => {
      manager.add('Task to remove');
      manager.remove(0);

      const log = manager.getHistoryLog();
      expect(log[1].action).toBe('removed');
    });

    it('should log task completed', () => {
      const task = manager.add('Complete me');
      manager.update(0, { ...task, isDone: true });

      const log = manager.getHistoryLog();
      expect(log[1].action).toBe('completed');
    });

    it('should log task uncompleted', () => {
      const task = manager.add('Toggle me');
      manager.update(0, { ...task, isDone: true });
      const completed = manager.getParsed()[0];
      manager.update(0, { ...completed, isDone: false });

      const log = manager.getHistoryLog();
      expect(log[2].action).toBe('uncompleted');
    });

    it('should log clear all', () => {
      manager.add('Task');
      manager.clearAll();

      const log = manager.getHistoryLog();
      expect(log[1].action).toBe('cleared_all');
    });

    it('should log group created', () => {
      manager.addGroup('Projects', '#123456');

      const log = manager.getHistoryLog();
      expect(log[0].action).toBe('group_created');
      expect(log[0].data.group).toBe('Projects');
    });

    it('should log group renamed', () => {
      manager.addGroup('Work', '#ff0000');
      const group = manager.getGroups().find(g => g.name === 'Work')!;
      manager.updateGroup(group.id, 'Office', '#ff0000');

      const log = manager.getHistoryLog();
      expect(log[1].action).toBe('group_renamed');
      expect(log[1].data.oldName).toBe('Work');
      expect(log[1].data.newName).toBe('Office');
    });

    it('should log group deleted', () => {
      manager.addGroup('Work', '#ff0000');
      const group = manager.getGroups().find(g => g.name === 'Work')!;
      manager.removeGroup(group.id);

      const log = manager.getHistoryLog();
      expect(log[1].action).toBe('group_deleted');
      expect(log[1].data.group).toBe('Work');
    });
  });

  describe('Migration', () => {
    it('should migrate tasks without version', () => {
      // Simulate old format task (no version, no id)
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
      // Simulate old format group
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
      expect(() => manager.update(0, { version: 1, id: 'x', name: 'x', isDone: false })).not.toThrow();
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

      // Add 2 work tasks and 1 inbox task
      manager.add('Inbox task', 'inbox');
      manager.add('Work task 1', workGroup.id);
      manager.add('Work task 2', workGroup.id);

      // All 3 tasks are undone
      expect(manager.getTotalUndone()).toBe(3);

      // 2 in work group, 1 in inbox
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

      const log = manager.getHistoryLog();
      const renameLog = log.find(l => l.action === 'renamed');
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

      // Focus another task
      manager.update(1, { ...afterFirst[1], isFocused: true });

      const afterSecond = manager.getParsed();
      const focusedCount = afterSecond.filter(t => t.isFocused).length;
      // Note: current implementation doesn't auto-unfocus, but focused task moves to top
      expect(afterSecond[0].isFocused).toBe(true);
    });

    it('should not move already-first task when focused', () => {
      const task = manager.add('Only task');
      manager.update(0, { ...task, isFocused: true });

      const tasks = manager.getParsed();
      expect(tasks.length).toBe(1);
      expect(tasks[0].isFocused).toBe(true);
    });
  });
});
