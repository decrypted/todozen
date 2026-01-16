/**
 * Clean trailing punctuation from URL that's likely not part of the URL.
 * @param url - Raw extracted URL
 * @returns Cleaned URL
 */
export function cleanUrlTrailingPunctuation(url: string): string {
    // Strip trailing punctuation that's commonly not part of URLs
    // But keep ? and & if followed by more chars (query params)
    return url.replace(/[.,;:!?)>\]]+$/, '');
}

/**
 * Extract all URLs from text and return display text without any URLs.
 * @param text - The text to extract URLs from
 * @returns Object with displayText (text without URLs) and urls array
 */
export function extractUrls(text: string): { displayText: string; urls: string[] } {
    try {
        const regex = /https?:\/\/[^\s]+/g;
        const matches = text.match(regex);

        if (matches && matches.length > 0) {
            const urls: string[] = [];
            let displayText = text;

            for (const rawUrl of matches) {
                const cleanedUrl = cleanUrlTrailingPunctuation(rawUrl);

                // Must have something after protocol (https:// is 8 chars, http:// is 7)
                if (cleanedUrl.length > 8) {
                    urls.push(cleanedUrl);
                }

                // Remove the raw URL from display text
                displayText = displayText.replace(rawUrl, '');
            }

            // Collapse multiple spaces and trim
            displayText = displayText.replace(/\s+/g, ' ').trim();

            // If display would be empty, show first URL as text
            if (!displayText && urls.length > 0) {
                displayText = urls[0];
            }

            return { displayText, urls };
        }
    } catch {
        // Regex failed, return original text
    }
    return { displayText: text, urls: [] };
}

/**
 * Extract the first URL from text and return display text without any URLs.
 * @param text - The text to extract URL from
 * @returns Object with displayText (text without URLs) and url (first URL or null)
 * @deprecated Use extractUrls() for multiple URL support
 */
export function extractUrl(text: string): { displayText: string; url: string | null } {
    const result = extractUrls(text);
    return {
        displayText: result.displayText,
        url: result.urls.length > 0 ? result.urls[0] : null,
    };
}

/**
 * Extract domain from a URL for display purposes.
 * @param url - Full URL
 * @returns Domain name (e.g., "example.com") or short URL if parsing fails
 */
export function extractDomain(url: string): string {
    try {
        // Remove protocol
        let domain = url.replace(/^https?:\/\//, '');
        // Remove path, query, fragment
        domain = domain.split('/')[0].split('?')[0].split('#')[0];
        // Remove www. prefix
        domain = domain.replace(/^www\./, '');
        // Remove port
        domain = domain.split(':')[0];
        return domain || url;
    } catch {
        return url;
    }
}

/**
 * Create button icon text with checkmark and count.
 * @param total - Number of undone tasks
 * @returns Formatted button text
 */
export function buttonIcon(total: number): string {
    return `(✔${total})`;
}

/**
 * Truncate text to a maximum length with ellipsis.
 * @param text - The text to truncate
 * @param maxLength - Maximum length before truncation (default 40)
 * @returns Truncated text with "..." if needed
 */
export function truncateText(text: string, maxLength: number = 40): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength) + "...";
}

/**
 * Format pinned task for panel display.
 * Removes URLs, limits to max 4 words and 30 characters.
 * Returns empty string for URL-only tasks.
 * @param text - The task text to format
 * @returns Object with formatted text and first URL (if any)
 */
export function formatPinnedTaskForPanel(text: string): { text: string; url: string | null } {
    // Extract URLs
    const { displayText, urls } = extractUrls(text);
    const firstUrl = urls.length > 0 ? urls[0] : null;

    // If display text is same as original (URL-only case), return empty
    if (displayText === text && urls.length > 0) {
        return { text: '', url: firstUrl };
    }

    // Split into words and take max 4
    const words = displayText.split(/\s+/).filter(w => w.length > 0);
    const limitedWords = words.slice(0, 4).join(' ');

    // Truncate to max 30 chars
    let result: string;
    if (limitedWords.length <= 30) {
        result = limitedWords;
    } else {
        result = limitedWords.substring(0, 27) + '...';
    }

    return { text: result, url: firstUrl };
}

/**
 * Generate a unique ID for tasks.
 * @param prefix - ID prefix (default "task")
 * @returns Unique ID string
 */
export function generateId(prefix: string = "task"): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate that a URL is properly formatted.
 * @param url - URL to validate
 * @returns true if URL is valid http/https
 */
export function isValidUrl(url: string): boolean {
    if (!url) return false;
    return /^https?:\/\/[^\s]+/.test(url);
}

// ===== Task/Group Types =====

export interface Task {
    version: number;
    id: string;
    name: string;
    isDone: boolean;
    isFocused?: boolean;
    groupId?: string;
}

export interface Group {
    version: number;
    id: string;
    name: string;
    color: string;
}

export const TASK_VERSION = 1;
export const GROUP_VERSION = 1;

// ===== Migration Functions =====

/**
 * Migrate a task from any version to the current version.
 * @param raw - Raw task object from storage
 * @returns Migrated task with current version
 */
export function migrateTask(raw: Record<string, unknown>): Task {
    // v0 (no version): had name, isDone, isFocused - no id, no groupId
    if (!raw.version) {
        return {
            version: TASK_VERSION,
            id: generateId('task'),
            name: raw.name as string,
            isDone: raw.isDone as boolean,
            isFocused: raw.isFocused as boolean | undefined,
            groupId: 'inbox',
        };
    }
    // Already current version
    return raw as unknown as Task;
}

/**
 * Migrate a group from any version to the current version.
 * @param raw - Raw group object from storage
 * @returns Migrated group with current version
 */
export function migrateGroup(raw: Record<string, unknown>): Group {
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

// ===== Task Operations =====

/**
 * Count undone tasks, optionally filtered by group.
 * @param tasks - Array of tasks
 * @param groupId - Optional group ID to filter by
 * @returns Number of undone tasks
 */
export function countUndoneTasks(tasks: Task[], groupId?: string): number {
    return tasks.filter(t => {
        const matchesGroup = !groupId || t.groupId === groupId;
        return !t.isDone && matchesGroup;
    }).length;
}

/**
 * Insert a new task at the correct position (after focused task or at top).
 * @param todos - Array of task JSON strings
 * @param newTaskStr - New task as JSON string
 * @returns Updated array with new task inserted
 */
export function insertTaskAtCorrectPosition(todos: string[], newTaskStr: string): string[] {
    const result = [...todos];
    if (result.length > 0) {
        const firstTask: Task = JSON.parse(result[0]);
        if (firstTask.isFocused) {
            result.splice(1, 0, newTaskStr);
        } else {
            result.unshift(newTaskStr);
        }
    } else {
        result.push(newTaskStr);
    }
    return result;
}

/**
 * Move a task to the top (for focusing).
 * @param todos - Array of task JSON strings
 * @param index - Index of task to move
 * @param updatedTask - Updated task object
 * @returns Updated array with task moved
 */
export function moveTaskToTop(todos: string[], index: number, updatedTask: Task): string[] {
    const result = [...todos];
    if (updatedTask.isFocused && index > 0) {
        const tmp = result[0];
        result[0] = JSON.stringify(updatedTask);
        result[index] = tmp;
    } else {
        result[index] = JSON.stringify(updatedTask);
    }
    return result;
}

/**
 * Move a task to the end of its group.
 * @param todos - Array of task JSON strings
 * @param index - Index of task to move
 * @returns Updated array with task moved to end of its group
 */
export function moveTaskToEndOfGroup(todos: string[], index: number): string[] {
    if (todos.length === 0 || index < 0 || index >= todos.length) {
        return [...todos];
    }

    const result = [...todos];
    const task: Task = JSON.parse(result[index]);
    const taskGroupId = task.groupId || 'inbox';

    // Find the last task with the same groupId
    let lastIndexInGroup = index;
    for (let i = todos.length - 1; i > index; i--) {
        const otherTask: Task = JSON.parse(todos[i]);
        const otherGroupId = otherTask.groupId || 'inbox';
        if (otherGroupId === taskGroupId) {
            lastIndexInGroup = i;
            break;
        }
    }

    // If already at end of group, no need to move
    if (lastIndexInGroup === index) {
        return result;
    }

    // Remove the task from its current position and insert after the last task in group
    const [removed] = result.splice(index, 1);
    result.splice(lastIndexInGroup, 0, removed);

    return result;
}

/**
 * Find task index by ID.
 * @param tasks - Array of tasks
 * @param taskId - ID to find
 * @returns Index of task or -1 if not found
 */
export function findTaskIndexById(tasks: Task[], taskId: string): number {
    return tasks.findIndex(t => t.id === taskId);
}

/**
 * Update a task's name by ID in a JSON string array.
 * @param todos - Array of task JSON strings
 * @param taskId - ID of task to update
 * @param newName - New name for the task
 * @returns Updated array, or original if task not found
 */
export function updateTaskNameById(todos: string[], taskId: string, newName: string): string[] {
    const result = [...todos];
    for (let i = 0; i < result.length; i++) {
        const task: Task = JSON.parse(result[i]);
        if (task.id === taskId) {
            task.name = newName;
            result[i] = JSON.stringify(task);
            return result;
        }
    }
    return result;
}

/**
 * Move all tasks from one group to another.
 * @param todos - Array of task JSON strings
 * @param fromGroupId - Source group ID
 * @param toGroupId - Target group ID
 * @returns Updated array with tasks moved
 */
export function moveTasksToGroup(todos: string[], fromGroupId: string, toGroupId: string): string[] {
    return todos.map(t => {
        const task: Task = JSON.parse(t);
        if (task.groupId === fromGroupId) {
            task.groupId = toGroupId;
        }
        return JSON.stringify(task);
    });
}

// ===== History =====

export type HistoryAction =
    | 'added'
    | 'removed'
    | 'completed'
    | 'uncompleted'
    | 'focused'
    | 'unfocused'
    | 'renamed'
    | 'cleared_all'
    | 'moved_group'
    | 'moved_to_end'
    | 'group_created'
    | 'group_renamed'
    | 'group_deleted';

export interface HistoryEntry {
    timestamp: string;
    action: HistoryAction;
    taskId?: string;
    task?: string;
    groupId?: string;
    group?: string;
    oldName?: string;
    newName?: string;
    details?: string;
}

/**
 * Create a history entry object.
 * @param action - The action being logged
 * @param data - Additional data for the entry
 * @returns Formatted history entry
 */
export function createHistoryEntry(
    action: HistoryAction,
    data: Omit<HistoryEntry, 'timestamp' | 'action'> = {}
): HistoryEntry {
    return {
        timestamp: new Date().toISOString(),
        action,
        ...data,
    };
}

/**
 * Serialize a history entry to JSONL format.
 * @param entry - History entry to serialize
 * @returns JSON string
 */
export function serializeHistoryEntry(entry: HistoryEntry): string {
    return JSON.stringify(entry);
}

// ===== Group Validation =====

/**
 * Check if a group can be added (max limit).
 * @param currentCount - Current number of groups
 * @param maxGroups - Maximum allowed groups (default 10)
 * @returns true if a group can be added
 */
export function canAddGroup(currentCount: number, maxGroups: number = 10): boolean {
    return currentCount < maxGroups;
}

/**
 * Check if a group can be deleted.
 * @param groupId - ID of group to delete
 * @returns true if the group can be deleted (not inbox)
 */
export function canDeleteGroup(groupId: string): boolean {
    return groupId !== 'inbox';
}

// ===== Safe JSON Parsing =====

/**
 * Result type for operations that can fail.
 */
export type Result<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

/**
 * Safely parse JSON string to object.
 * @param json - JSON string to parse
 * @returns Result with parsed object or error message
 */
export function safeParseJson<T>(json: string): Result<T> {
    try {
        return { ok: true, value: JSON.parse(json) as T };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `JSON parse error: ${msg}` };
    }
}

/**
 * Safely parse a task from JSON string.
 * @param json - JSON string representing a task
 * @returns Result with parsed and migrated task or error
 */
export function safeParseTask(json: string): Result<Task> {
    const parsed = safeParseJson<Record<string, unknown>>(json);
    if (!parsed.ok) return parsed;

    try {
        const task = migrateTask(parsed.value);
        const validation = validateTask(task);
        if (!validation.ok) return validation;
        return { ok: true, value: task };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Task migration error: ${msg}` };
    }
}

/**
 * Safely parse a group from JSON string.
 * @param json - JSON string representing a group
 * @returns Result with parsed and migrated group or error
 */
export function safeParseGroup(json: string): Result<Group> {
    const parsed = safeParseJson<Record<string, unknown>>(json);
    if (!parsed.ok) return parsed;

    try {
        const group = migrateGroup(parsed.value);
        const validation = validateGroup(group);
        if (!validation.ok) return validation;
        return { ok: true, value: group };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Group migration error: ${msg}` };
    }
}

/**
 * Parse all tasks from string array, skipping invalid entries.
 * @param jsonArray - Array of JSON strings
 * @returns Object with valid tasks and any errors encountered
 */
export function parseTasksWithErrors(jsonArray: string[]): { tasks: Task[]; errors: string[] } {
    const tasks: Task[] = [];
    const errors: string[] = [];

    for (let i = 0; i < jsonArray.length; i++) {
        const result = safeParseTask(jsonArray[i]);
        if (result.ok) {
            tasks.push(result.value);
        } else {
            errors.push(`Task ${i}: ${result.error}`);
        }
    }

    return { tasks, errors };
}

/**
 * Parse all groups from string array, skipping invalid entries.
 * @param jsonArray - Array of JSON strings
 * @returns Object with valid groups and any errors encountered
 */
export function parseGroupsWithErrors(jsonArray: string[]): { groups: Group[]; errors: string[] } {
    const groups: Group[] = [];
    const errors: string[] = [];

    for (let i = 0; i < jsonArray.length; i++) {
        const result = safeParseGroup(jsonArray[i]);
        if (result.ok) {
            groups.push(result.value);
        } else {
            errors.push(`Group ${i}: ${result.error}`);
        }
    }

    return { groups, errors };
}

// ===== Validation =====

/**
 * Validate a task object has required fields.
 * @param task - Task to validate
 * @returns Result indicating validity
 */
export function validateTask(task: Task): Result<Task> {
    if (!task.id || typeof task.id !== 'string') {
        return { ok: false, error: 'Task missing valid id' };
    }
    if (!task.name || typeof task.name !== 'string') {
        return { ok: false, error: 'Task missing valid name' };
    }
    if (typeof task.isDone !== 'boolean') {
        return { ok: false, error: 'Task missing valid isDone' };
    }
    if (typeof task.version !== 'number') {
        return { ok: false, error: 'Task missing valid version' };
    }
    return { ok: true, value: task };
}

/**
 * Validate a group object has required fields.
 * @param group - Group to validate
 * @returns Result indicating validity
 */
export function validateGroup(group: Group): Result<Group> {
    if (!group.id || typeof group.id !== 'string') {
        return { ok: false, error: 'Group missing valid id' };
    }
    if (!group.name || typeof group.name !== 'string') {
        return { ok: false, error: 'Group missing valid name' };
    }
    if (!group.color || typeof group.color !== 'string') {
        return { ok: false, error: 'Group missing valid color' };
    }
    if (typeof group.version !== 'number') {
        return { ok: false, error: 'Group missing valid version' };
    }
    return { ok: true, value: group };
}

/**
 * Validate color is a valid hex color.
 * @param color - Color string to validate
 * @returns true if valid hex color
 */
export function isValidHexColor(color: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
}

// ===== Default Data =====

/**
 * Create the default inbox group.
 * @returns Default inbox group object
 */
export function createDefaultInboxGroup(): Group {
    return {
        version: GROUP_VERSION,
        id: 'inbox',
        name: 'Inbox',
        color: '#3584e4',
    };
}

/**
 * Create a new task with defaults.
 * @param name - Task name
 * @param groupId - Optional group ID (defaults to inbox)
 * @returns New task object
 */
export function createTask(name: string, groupId: string = 'inbox'): Task {
    return {
        version: TASK_VERSION,
        id: generateId('task'),
        name,
        isDone: false,
        groupId,
    };
}

/**
 * Create a new group with defaults.
 * @param name - Group name
 * @param color - Group color (hex)
 * @returns New group object
 */
export function createGroup(name: string, color: string): Group {
    return {
        version: GROUP_VERSION,
        id: generateId('group'),
        name,
        color,
    };
}

// ===== Error Handling =====

/**
 * Error info for extension error state.
 */
export interface ExtensionError {
    message: string;
    timestamp: string;
    context?: string;
}

/**
 * Create an extension error object.
 * @param message - Error message
 * @param context - Optional context (e.g., function name)
 * @returns ExtensionError object
 */
export function createExtensionError(message: string, context?: string): ExtensionError {
    return {
        message,
        timestamp: new Date().toISOString(),
        context,
    };
}

/**
 * Format error for display to user.
 * @param error - ExtensionError object
 * @returns User-friendly error message
 */
export function formatErrorForDisplay(error: ExtensionError): string {
    return `TodoZen Error: ${error.message}`;
}

/**
 * Format error for logging.
 * @param error - ExtensionError object
 * @returns Detailed error string for logs
 */
export function formatErrorForLog(error: ExtensionError): string {
    const parts = [`[${error.timestamp}] TodoZen Error: ${error.message}`];
    if (error.context) {
        parts.push(`Context: ${error.context}`);
    }
    return parts.join('\n');
}

/**
 * Safely execute a function and return Result.
 * @param fn - Function to execute
 * @param context - Context for error reporting
 * @returns Result with return value or error
 */
export function safeExecute<T>(fn: () => T, context: string): Result<T> {
    try {
        return { ok: true, value: fn() };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `${context}: ${msg}` };
    }
}
