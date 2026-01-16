import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {
    HistoryAction,
    HistoryEntry,
    createHistoryEntry,
    serializeHistoryEntry,
} from './utils.js';

const APP_NAME = 'todozen';

// Re-export for convenience
export type { HistoryAction };

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

    log(action: HistoryAction, data: Omit<HistoryEntry, 'timestamp' | 'action'> = {}) {
        const entry = createHistoryEntry(action, data);
        this._appendLine(serializeHistoryEntry(entry));
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
