import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const APP_NAME = 'todozen';

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
    | 'group_created'
    | 'group_renamed'
    | 'group_deleted';

interface HistoryEntry {
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

export class HistoryLogger {
    private _logFile: Gio.File;
    private _logDir: string;

    constructor() {
        // ~/.config/todozen/
        this._logDir = GLib.build_filenamev([GLib.get_user_config_dir(), APP_NAME]);
        const logPath = GLib.build_filenamev([this._logDir, 'history.jsonl']);
        this._logFile = Gio.File.new_for_path(logPath);
        this._ensureLogDir();
    }

    private _ensureLogDir() {
        const dir = Gio.File.new_for_path(this._logDir);
        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }
    }

    log(action: HistoryAction, data: {
        taskId?: string;
        task?: string;
        groupId?: string;
        group?: string;
        oldName?: string;
        newName?: string;
        details?: string;
    } = {}) {
        const entry: HistoryEntry = {
            timestamp: new Date().toISOString(),
            action,
            ...data,
        };

        this._appendLine(JSON.stringify(entry));
    }

    private _appendLine(line: string) {
        try {
            const stream = this._logFile.append_to(Gio.FileCreateFlags.NONE, null);
            const bytes = new TextEncoder().encode(line + '\n');
            stream.write_all(bytes, null);
            stream.close(null);
        } catch (e) {
            // Silent fail - don't break extension if logging fails
            console.error('TodoZen: Failed to write history:', e);
        }
    }

    getLogPath(): string {
        return this._logFile.get_path() || '';
    }
}
