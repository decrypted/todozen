import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    cleanUrlTrailingPunctuation,
    extractUrls,
    extractUrl,
    extractDomain,
    buttonIcon,
    truncateText,
    generateId,
    isValidUrl,
    Task,
    Group,
    TASK_VERSION,
    GROUP_VERSION,
    migrateTask,
    migrateGroup,
    countUndoneTasks,
    insertTaskAtCorrectPosition,
    moveTaskToTop,
    moveTasksToGroup,
    HistoryAction,
    HistoryEntry,
    createHistoryEntry,
    serializeHistoryEntry,
    canAddGroup,
    canDeleteGroup,
    // New utilities
    Result,
    safeParseJson,
    safeParseTask,
    safeParseGroup,
    parseTasksWithErrors,
    parseGroupsWithErrors,
    validateTask,
    validateGroup,
    isValidHexColor,
    createDefaultInboxGroup,
    createTask,
    createGroup,
    ExtensionError,
    createExtensionError,
    formatErrorForDisplay,
    formatErrorForLog,
    safeExecute,
} from '../src/utils';

describe('cleanUrlTrailingPunctuation', () => {
    it('should strip trailing period', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com.')).toBe('https://example.com');
    });

    it('should strip trailing comma', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com,')).toBe('https://example.com');
    });

    it('should strip trailing parenthesis', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com)')).toBe('https://example.com');
    });

    it('should strip multiple trailing punctuation', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com.),')).toBe('https://example.com');
    });

    it('should preserve query params', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com?q=1')).toBe('https://example.com?q=1');
    });

    it('should strip punctuation after query params', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com?q=1.')).toBe('https://example.com?q=1');
    });

    it('should handle URL without trailing punctuation', () => {
        expect(cleanUrlTrailingPunctuation('https://example.com')).toBe('https://example.com');
    });
});

describe('extractUrls', () => {
    it('should extract single URL at end of text', () => {
        const result = extractUrls('Check docs https://example.com');
        expect(result.displayText).toBe('Check docs');
        expect(result.urls).toEqual(['https://example.com']);
    });

    it('should extract single URL at start of text', () => {
        const result = extractUrls('https://example.com Check docs');
        expect(result.displayText).toBe('Check docs');
        expect(result.urls).toEqual(['https://example.com']);
    });

    it('should extract single URL in middle of text', () => {
        const result = extractUrls('Check https://example.com docs');
        expect(result.displayText).toBe('Check docs');
        expect(result.urls).toEqual(['https://example.com']);
    });

    it('should return empty array when no URL', () => {
        const result = extractUrls('Check docs');
        expect(result.displayText).toBe('Check docs');
        expect(result.urls).toEqual([]);
    });

    it('should handle empty string', () => {
        const result = extractUrls('');
        expect(result.displayText).toBe('');
        expect(result.urls).toEqual([]);
    });

    it('should handle URL only', () => {
        const result = extractUrls('https://example.com');
        expect(result.displayText).toBe('https://example.com');
        expect(result.urls).toEqual(['https://example.com']);
    });

    it('should extract multiple URLs', () => {
        const result = extractUrls('First https://first.com second https://second.com');
        expect(result.urls).toEqual(['https://first.com', 'https://second.com']);
        expect(result.displayText).toBe('First second');
    });

    it('should extract three URLs', () => {
        const result = extractUrls('A https://a.com B https://b.com C https://c.com');
        expect(result.urls).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
        expect(result.displayText).toBe('A B C');
    });

    it('should handle http URLs', () => {
        const result = extractUrls('Visit http://example.com');
        expect(result.urls).toEqual(['http://example.com']);
    });

    it('should handle URLs with paths', () => {
        const result = extractUrls('Check https://example.com/path/to/page');
        expect(result.urls).toEqual(['https://example.com/path/to/page']);
    });

    it('should handle URLs with query params', () => {
        const result = extractUrls('Search https://example.com?q=test&page=1');
        expect(result.urls).toEqual(['https://example.com?q=test&page=1']);
    });

    it('should not match ftp or other protocols', () => {
        const result = extractUrls('Download ftp://files.com/file.zip');
        expect(result.urls).toEqual([]);
    });

    it('should strip trailing period from URL', () => {
        const result = extractUrls('See https://example.com.');
        expect(result.urls).toEqual(['https://example.com']);
        expect(result.displayText).toBe('See');
    });

    it('should strip trailing comma from URL', () => {
        const result = extractUrls('Visit https://example.com, then continue');
        expect(result.urls).toEqual(['https://example.com']);
        expect(result.displayText).toBe('Visit then continue');
    });

    it('should strip trailing parenthesis from URL', () => {
        const result = extractUrls('(see https://example.com)');
        expect(result.urls).toEqual(['https://example.com']);
        expect(result.displayText).toBe('(see');
    });

    it('should reject malformed https:// only', () => {
        const result = extractUrls('Incomplete https://');
        expect(result.urls).toEqual([]);
        expect(result.displayText).toBe('Incomplete https://');
    });

    it('should handle URL with fragment', () => {
        const result = extractUrls('Jump to https://example.com#section');
        expect(result.urls).toEqual(['https://example.com#section']);
    });

    it('should handle complex URL with all parts', () => {
        const result = extractUrls('API: https://api.example.com:8080/v1/users?id=123&active=true#top');
        expect(result.urls).toEqual(['https://api.example.com:8080/v1/users?id=123&active=true#top']);
    });

    it('should handle multiple URLs only (no text)', () => {
        const result = extractUrls('https://first.com https://second.com');
        expect(result.urls).toEqual(['https://first.com', 'https://second.com']);
        expect(result.displayText).toBe('https://first.com'); // First URL as fallback
    });

    it('should handle URL with parentheses in path', () => {
        const result = extractUrls('Wiki: https://en.wikipedia.org/wiki/Test_(disambiguation)');
        // Note: trailing ) gets stripped, this is a known limitation
        expect(result.urls[0]).toContain('wikipedia.org');
    });
});

describe('extractUrl (deprecated)', () => {
    it('should return first URL', () => {
        const result = extractUrl('Check https://first.com and https://second.com');
        expect(result.url).toBe('https://first.com');
        expect(result.displayText).toBe('Check and');
    });

    it('should return null when no URL', () => {
        const result = extractUrl('No URLs here');
        expect(result.url).toBeNull();
    });
});

describe('extractDomain', () => {
    it('should extract domain from simple URL', () => {
        expect(extractDomain('https://example.com')).toBe('example.com');
    });

    it('should extract domain from URL with path', () => {
        expect(extractDomain('https://example.com/path/to/page')).toBe('example.com');
    });

    it('should extract domain from URL with query', () => {
        expect(extractDomain('https://example.com?foo=bar')).toBe('example.com');
    });

    it('should extract domain from URL with fragment', () => {
        expect(extractDomain('https://example.com#section')).toBe('example.com');
    });

    it('should remove www prefix', () => {
        expect(extractDomain('https://www.example.com')).toBe('example.com');
    });

    it('should remove port number', () => {
        expect(extractDomain('https://example.com:8080')).toBe('example.com');
    });

    it('should handle http protocol', () => {
        expect(extractDomain('http://example.com')).toBe('example.com');
    });

    it('should handle subdomain', () => {
        expect(extractDomain('https://api.example.com')).toBe('api.example.com');
    });

    it('should handle complex URL', () => {
        expect(extractDomain('https://api.example.com:8080/v1/users?id=123#top')).toBe('api.example.com');
    });

    it('should return original if parsing fails', () => {
        expect(extractDomain('not-a-url')).toBe('not-a-url');
    });
});

describe('buttonIcon', () => {
    it('should format zero tasks', () => {
        expect(buttonIcon(0)).toBe('(✔0)');
    });

    it('should format single task', () => {
        expect(buttonIcon(1)).toBe('(✔1)');
    });

    it('should format multiple tasks', () => {
        expect(buttonIcon(42)).toBe('(✔42)');
    });

    it('should handle large numbers', () => {
        expect(buttonIcon(999)).toBe('(✔999)');
    });
});

describe('truncateText', () => {
    it('should not truncate short text', () => {
        expect(truncateText('Short')).toBe('Short');
    });

    it('should truncate text at 40 chars by default', () => {
        const longText = 'a'.repeat(50);
        const result = truncateText(longText);
        expect(result).toBe('a'.repeat(40) + '...');
    });

    it('should use custom max length', () => {
        expect(truncateText('Hello World', 5)).toBe('Hello...');
    });

    it('should not truncate at exact max length', () => {
        expect(truncateText('Hello', 5)).toBe('Hello');
    });

    it('should handle empty string', () => {
        expect(truncateText('')).toBe('');
    });
});

describe('generateId', () => {
    it('should generate task ID with prefix', () => {
        const id = generateId('task');
        expect(id).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it('should generate group ID with prefix', () => {
        const id = generateId('group');
        expect(id).toMatch(/^group_\d+_[a-z0-9]+$/);
    });

    it('should use default prefix', () => {
        const id = generateId();
        expect(id).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
        const ids = new Set([generateId(), generateId(), generateId()]);
        expect(ids.size).toBe(3);
    });
});

describe('isValidUrl', () => {
    it('should accept https URLs', () => {
        expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('should accept http URLs', () => {
        expect(isValidUrl('http://example.com')).toBe(true);
    });

    it('should reject ftp URLs', () => {
        expect(isValidUrl('ftp://files.com')).toBe(false);
    });

    it('should reject invalid URLs', () => {
        expect(isValidUrl('not-a-url')).toBe(false);
    });

    it('should reject empty string', () => {
        expect(isValidUrl('')).toBe(false);
    });

    it('should accept URLs with paths', () => {
        expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
    });

    it('should accept URLs with query params', () => {
        expect(isValidUrl('https://example.com?foo=bar')).toBe(true);
    });
});

describe('migrateTask', () => {
    it('should migrate v0 task to v1', () => {
        const v0Task = { name: 'Old task', isDone: false };
        const migrated = migrateTask(v0Task);

        expect(migrated.version).toBe(TASK_VERSION);
        expect(migrated.name).toBe('Old task');
        expect(migrated.isDone).toBe(false);
        expect(migrated.groupId).toBe('inbox');
        expect(migrated.id).toMatch(/^task_/);
    });

    it('should migrate v0 focused task', () => {
        const v0Task = { name: 'Focused', isDone: false, isFocused: true };
        const migrated = migrateTask(v0Task);

        expect(migrated.isFocused).toBe(true);
    });

    it('should return v1 task unchanged', () => {
        const v1Task: Task = {
            version: 1,
            id: 'task_123',
            name: 'Current task',
            isDone: true,
            groupId: 'work',
        };
        const migrated = migrateTask(v1Task as Record<string, unknown>);

        expect(migrated).toEqual(v1Task);
    });
});

describe('migrateGroup', () => {
    it('should migrate v0 group to v1', () => {
        const v0Group = { id: 'inbox', name: 'Inbox', color: '#3584e4' };
        const migrated = migrateGroup(v0Group);

        expect(migrated.version).toBe(GROUP_VERSION);
        expect(migrated.id).toBe('inbox');
        expect(migrated.name).toBe('Inbox');
        expect(migrated.color).toBe('#3584e4');
    });

    it('should return v1 group unchanged', () => {
        const v1Group: Group = {
            version: 1,
            id: 'work',
            name: 'Work',
            color: '#ff0000',
        };
        const migrated = migrateGroup(v1Group as Record<string, unknown>);

        expect(migrated).toEqual(v1Group);
    });
});

describe('countUndoneTasks', () => {
    const tasks: Task[] = [
        { version: 1, id: '1', name: 'Task 1', isDone: false, groupId: 'inbox' },
        { version: 1, id: '2', name: 'Task 2', isDone: true, groupId: 'inbox' },
        { version: 1, id: '3', name: 'Task 3', isDone: false, groupId: 'work' },
        { version: 1, id: '4', name: 'Task 4', isDone: false, groupId: 'work' },
    ];

    it('should count all undone tasks', () => {
        expect(countUndoneTasks(tasks)).toBe(3);
    });

    it('should count undone tasks in specific group', () => {
        expect(countUndoneTasks(tasks, 'inbox')).toBe(1);
        expect(countUndoneTasks(tasks, 'work')).toBe(2);
    });

    it('should return 0 for empty array', () => {
        expect(countUndoneTasks([])).toBe(0);
    });

    it('should return 0 for all done tasks', () => {
        const allDone: Task[] = [
            { version: 1, id: '1', name: 'Done', isDone: true, groupId: 'inbox' },
        ];
        expect(countUndoneTasks(allDone)).toBe(0);
    });
});

describe('insertTaskAtCorrectPosition', () => {
    it('should add to empty list', () => {
        const result = insertTaskAtCorrectPosition([], '{"name":"new"}');
        expect(result).toEqual(['{"name":"new"}']);
    });

    it('should add at top of list', () => {
        const existing = [
            JSON.stringify({ name: 'First', isFocused: false }),
        ];
        const result = insertTaskAtCorrectPosition(existing, '{"name":"new"}');
        expect(result.length).toBe(2);
        expect(result[0]).toBe('{"name":"new"}');
    });

    it('should add after focused task', () => {
        const existing = [
            JSON.stringify({ name: 'Focused', isFocused: true }),
            JSON.stringify({ name: 'Second', isFocused: false }),
        ];
        const result = insertTaskAtCorrectPosition(existing, '{"name":"new"}');
        expect(result.length).toBe(3);
        expect(JSON.parse(result[0]).isFocused).toBe(true);
        expect(result[1]).toBe('{"name":"new"}');
    });

    it('should not mutate original array', () => {
        const existing = ['{"name":"First"}'];
        insertTaskAtCorrectPosition(existing, '{"name":"new"}');
        expect(existing.length).toBe(1);
    });
});

describe('moveTaskToTop', () => {
    it('should move focused task to top', () => {
        const todos = [
            JSON.stringify({ id: '1', name: 'First', isFocused: false }),
            JSON.stringify({ id: '2', name: 'Second', isFocused: false }),
            JSON.stringify({ id: '3', name: 'Third', isFocused: false }),
        ];
        const updatedTask: Task = { version: 1, id: '3', name: 'Third', isDone: false, isFocused: true };

        const result = moveTaskToTop(todos, 2, updatedTask);
        expect(JSON.parse(result[0]).isFocused).toBe(true);
        expect(JSON.parse(result[2]).id).toBe('1');
    });

    it('should not move if already at top', () => {
        const todos = [
            JSON.stringify({ id: '1', name: 'First', isFocused: false }),
        ];
        const updatedTask: Task = { version: 1, id: '1', name: 'Updated', isDone: false, isFocused: true };

        const result = moveTaskToTop(todos, 0, updatedTask);
        expect(JSON.parse(result[0]).name).toBe('Updated');
    });

    it('should not move if not focused', () => {
        const todos = [
            JSON.stringify({ id: '1', name: 'First' }),
            JSON.stringify({ id: '2', name: 'Second' }),
        ];
        const updatedTask: Task = { version: 1, id: '2', name: 'Updated', isDone: false, isFocused: false };

        const result = moveTaskToTop(todos, 1, updatedTask);
        expect(JSON.parse(result[1]).name).toBe('Updated');
    });

    it('should not mutate original array', () => {
        const todos = [
            JSON.stringify({ id: '1', name: 'First' }),
            JSON.stringify({ id: '2', name: 'Second' }),
        ];
        const original = [...todos];
        const updatedTask: Task = { version: 1, id: '2', name: 'Updated', isDone: false, isFocused: true };

        moveTaskToTop(todos, 1, updatedTask);
        expect(todos).toEqual(original);
    });
});

describe('moveTasksToGroup', () => {
    it('should move tasks from one group to another', () => {
        const todos = [
            JSON.stringify({ id: '1', name: 'Task 1', groupId: 'work' }),
            JSON.stringify({ id: '2', name: 'Task 2', groupId: 'work' }),
            JSON.stringify({ id: '3', name: 'Task 3', groupId: 'personal' }),
        ];

        const result = moveTasksToGroup(todos, 'work', 'inbox');
        expect(JSON.parse(result[0]).groupId).toBe('inbox');
        expect(JSON.parse(result[1]).groupId).toBe('inbox');
        expect(JSON.parse(result[2]).groupId).toBe('personal');
    });

    it('should not modify tasks in other groups', () => {
        const todos = [
            JSON.stringify({ id: '1', name: 'Task 1', groupId: 'personal' }),
        ];

        const result = moveTasksToGroup(todos, 'work', 'inbox');
        expect(JSON.parse(result[0]).groupId).toBe('personal');
    });

    it('should handle empty array', () => {
        const result = moveTasksToGroup([], 'work', 'inbox');
        expect(result).toEqual([]);
    });
});

describe('createHistoryEntry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should create entry with timestamp', () => {
        const entry = createHistoryEntry('added');
        expect(entry.timestamp).toBe('2024-01-15T10:30:00.000Z');
        expect(entry.action).toBe('added');
    });

    it('should include task data', () => {
        const entry = createHistoryEntry('completed', {
            taskId: 'task_123',
            task: 'Buy groceries',
        });
        expect(entry.taskId).toBe('task_123');
        expect(entry.task).toBe('Buy groceries');
    });

    it('should include rename data', () => {
        const entry = createHistoryEntry('renamed', {
            taskId: 'task_123',
            oldName: 'Old',
            newName: 'New',
        });
        expect(entry.oldName).toBe('Old');
        expect(entry.newName).toBe('New');
    });

    it('should include group data', () => {
        const entry = createHistoryEntry('group_created', {
            groupId: 'group_123',
            group: 'Work',
        });
        expect(entry.groupId).toBe('group_123');
        expect(entry.group).toBe('Work');
    });
});

describe('serializeHistoryEntry', () => {
    it('should serialize to JSON', () => {
        const entry: HistoryEntry = {
            timestamp: '2024-01-15T10:30:00.000Z',
            action: 'added',
            task: 'Test task',
        };
        const json = serializeHistoryEntry(entry);
        expect(JSON.parse(json)).toEqual(entry);
    });
});

describe('canAddGroup', () => {
    it('should allow adding when under limit', () => {
        expect(canAddGroup(5, 10)).toBe(true);
    });

    it('should deny adding when at limit', () => {
        expect(canAddGroup(10, 10)).toBe(false);
    });

    it('should deny adding when over limit', () => {
        expect(canAddGroup(11, 10)).toBe(false);
    });

    it('should use default limit of 10', () => {
        expect(canAddGroup(9)).toBe(true);
        expect(canAddGroup(10)).toBe(false);
    });
});

describe('canDeleteGroup', () => {
    it('should not allow deleting inbox', () => {
        expect(canDeleteGroup('inbox')).toBe(false);
    });

    it('should allow deleting other groups', () => {
        expect(canDeleteGroup('work')).toBe(true);
        expect(canDeleteGroup('personal')).toBe(true);
        expect(canDeleteGroup('group_123')).toBe(true);
    });
});

// ===== New Utility Tests =====

describe('safeParseJson', () => {
    it('should parse valid JSON', () => {
        const result = safeParseJson<{ name: string }>('{"name": "test"}');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.name).toBe('test');
        }
    });

    it('should return error for invalid JSON', () => {
        const result = safeParseJson('not valid json');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('JSON parse error');
        }
    });

    it('should return error for empty string', () => {
        const result = safeParseJson('');
        expect(result.ok).toBe(false);
    });
});

describe('safeParseTask', () => {
    it('should parse valid task JSON', () => {
        const taskJson = JSON.stringify({
            version: 1,
            id: 'task_123',
            name: 'Test task',
            isDone: false,
            groupId: 'inbox',
        });
        const result = safeParseTask(taskJson);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.name).toBe('Test task');
        }
    });

    it('should migrate v0 task', () => {
        const v0TaskJson = JSON.stringify({ name: 'Old task', isDone: true });
        const result = safeParseTask(v0TaskJson);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.version).toBe(1);
            expect(result.value.groupId).toBe('inbox');
        }
    });

    it('should return error for invalid task', () => {
        const result = safeParseTask('{"name": 123}'); // name should be string
        expect(result.ok).toBe(false);
    });

    it('should return error for invalid JSON', () => {
        const result = safeParseTask('not json');
        expect(result.ok).toBe(false);
    });
});

describe('safeParseGroup', () => {
    it('should parse valid group JSON', () => {
        const groupJson = JSON.stringify({
            version: 1,
            id: 'work',
            name: 'Work',
            color: '#ff0000',
        });
        const result = safeParseGroup(groupJson);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.name).toBe('Work');
        }
    });

    it('should migrate v0 group', () => {
        const v0GroupJson = JSON.stringify({ id: 'inbox', name: 'Inbox', color: '#3584e4' });
        const result = safeParseGroup(v0GroupJson);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.version).toBe(1);
        }
    });

    it('should return error for invalid group', () => {
        const result = safeParseGroup('{"id": "test"}'); // missing name and color
        expect(result.ok).toBe(false);
    });
});

describe('parseTasksWithErrors', () => {
    it('should parse valid tasks', () => {
        const tasks = [
            JSON.stringify({ version: 1, id: '1', name: 'Task 1', isDone: false }),
            JSON.stringify({ version: 1, id: '2', name: 'Task 2', isDone: true }),
        ];
        const result = parseTasksWithErrors(tasks);
        expect(result.tasks.length).toBe(2);
        expect(result.errors.length).toBe(0);
    });

    it('should skip invalid tasks and report errors', () => {
        const tasks = [
            JSON.stringify({ version: 1, id: '1', name: 'Valid', isDone: false }),
            'invalid json',
            JSON.stringify({ version: 1, id: '2', name: 'Also valid', isDone: true }),
        ];
        const result = parseTasksWithErrors(tasks);
        expect(result.tasks.length).toBe(2);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('Task 1');
    });

    it('should handle empty array', () => {
        const result = parseTasksWithErrors([]);
        expect(result.tasks.length).toBe(0);
        expect(result.errors.length).toBe(0);
    });
});

describe('parseGroupsWithErrors', () => {
    it('should parse valid groups', () => {
        const groups = [
            JSON.stringify({ version: 1, id: 'inbox', name: 'Inbox', color: '#3584e4' }),
            JSON.stringify({ version: 1, id: 'work', name: 'Work', color: '#ff0000' }),
        ];
        const result = parseGroupsWithErrors(groups);
        expect(result.groups.length).toBe(2);
        expect(result.errors.length).toBe(0);
    });

    it('should skip invalid groups and report errors', () => {
        const groups = [
            JSON.stringify({ version: 1, id: 'inbox', name: 'Inbox', color: '#3584e4' }),
            'bad json',
        ];
        const result = parseGroupsWithErrors(groups);
        expect(result.groups.length).toBe(1);
        expect(result.errors.length).toBe(1);
    });
});

describe('validateTask', () => {
    it('should accept valid task', () => {
        const task: Task = { version: 1, id: 'task_1', name: 'Test', isDone: false };
        const result = validateTask(task);
        expect(result.ok).toBe(true);
    });

    it('should reject task without id', () => {
        const task = { version: 1, id: '', name: 'Test', isDone: false } as Task;
        const result = validateTask(task);
        expect(result.ok).toBe(false);
    });

    it('should reject task without name', () => {
        const task = { version: 1, id: 'task_1', name: '', isDone: false } as Task;
        const result = validateTask(task);
        expect(result.ok).toBe(false);
    });

    it('should reject task with invalid isDone', () => {
        const task = { version: 1, id: 'task_1', name: 'Test', isDone: 'yes' } as unknown as Task;
        const result = validateTask(task);
        expect(result.ok).toBe(false);
    });

    it('should reject task with invalid version', () => {
        const task = { version: 'one', id: 'task_1', name: 'Test', isDone: false } as unknown as Task;
        const result = validateTask(task);
        expect(result.ok).toBe(false);
    });
});

describe('validateGroup', () => {
    it('should accept valid group', () => {
        const group: Group = { version: 1, id: 'inbox', name: 'Inbox', color: '#3584e4' };
        const result = validateGroup(group);
        expect(result.ok).toBe(true);
    });

    it('should reject group without color', () => {
        const group = { version: 1, id: 'inbox', name: 'Inbox', color: '' } as Group;
        const result = validateGroup(group);
        expect(result.ok).toBe(false);
    });

    it('should reject group with invalid version', () => {
        const group = { version: 'one', id: 'inbox', name: 'Inbox', color: '#3584e4' } as unknown as Group;
        const result = validateGroup(group);
        expect(result.ok).toBe(false);
    });
});

describe('isValidHexColor', () => {
    it('should accept valid hex colors', () => {
        expect(isValidHexColor('#3584e4')).toBe(true);
        expect(isValidHexColor('#FF0000')).toBe(true);
        expect(isValidHexColor('#000000')).toBe(true);
        expect(isValidHexColor('#ffffff')).toBe(true);
    });

    it('should reject invalid hex colors', () => {
        expect(isValidHexColor('red')).toBe(false);
        expect(isValidHexColor('#fff')).toBe(false); // 3-char not supported
        expect(isValidHexColor('3584e4')).toBe(false); // missing #
        expect(isValidHexColor('#GGGGGG')).toBe(false);
        expect(isValidHexColor('')).toBe(false);
    });
});

describe('createDefaultInboxGroup', () => {
    it('should create inbox group with correct properties', () => {
        const inbox = createDefaultInboxGroup();
        expect(inbox.id).toBe('inbox');
        expect(inbox.name).toBe('Inbox');
        expect(inbox.color).toBe('#3584e4');
        expect(inbox.version).toBe(GROUP_VERSION);
    });
});

describe('createTask', () => {
    it('should create task with defaults', () => {
        const task = createTask('Buy groceries');
        expect(task.name).toBe('Buy groceries');
        expect(task.isDone).toBe(false);
        expect(task.groupId).toBe('inbox');
        expect(task.version).toBe(TASK_VERSION);
        expect(task.id).toMatch(/^task_/);
    });

    it('should create task with custom group', () => {
        const task = createTask('Work task', 'work_group');
        expect(task.groupId).toBe('work_group');
    });
});

describe('createGroup', () => {
    it('should create group with properties', () => {
        const group = createGroup('Work', '#ff0000');
        expect(group.name).toBe('Work');
        expect(group.color).toBe('#ff0000');
        expect(group.version).toBe(GROUP_VERSION);
        expect(group.id).toMatch(/^group_/);
    });
});

describe('createExtensionError', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should create error with message', () => {
        const error = createExtensionError('Something went wrong');
        expect(error.message).toBe('Something went wrong');
        expect(error.timestamp).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should create error with context', () => {
        const error = createExtensionError('Failed', 'enable');
        expect(error.context).toBe('enable');
    });
});

describe('formatErrorForDisplay', () => {
    it('should format error for user', () => {
        const error: ExtensionError = {
            message: 'Test error',
            timestamp: '2024-01-15T10:30:00.000Z',
        };
        expect(formatErrorForDisplay(error)).toBe('TodoZen Error: Test error');
    });
});

describe('formatErrorForLog', () => {
    it('should format error for logging', () => {
        const error: ExtensionError = {
            message: 'Test error',
            timestamp: '2024-01-15T10:30:00.000Z',
        };
        const formatted = formatErrorForLog(error);
        expect(formatted).toContain('[2024-01-15T10:30:00.000Z]');
        expect(formatted).toContain('TodoZen Error: Test error');
    });

    it('should include context if present', () => {
        const error: ExtensionError = {
            message: 'Failed',
            timestamp: '2024-01-15T10:30:00.000Z',
            context: 'enable',
        };
        const formatted = formatErrorForLog(error);
        expect(formatted).toContain('Context: enable');
    });
});

describe('safeExecute', () => {
    it('should return value on success', () => {
        const result = safeExecute(() => 42, 'test');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe(42);
        }
    });

    it('should return error on exception', () => {
        const result = safeExecute(() => {
            throw new Error('boom');
        }, 'test');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('test');
            expect(result.error).toContain('boom');
        }
    });

    it('should handle non-Error throws', () => {
        const result = safeExecute(() => {
            throw 'string error';
        }, 'test');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('string error');
        }
    });
});
