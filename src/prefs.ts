import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { HistoryLogger } from './history.js';
import { rgbaToHex } from './utils.js';

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

const MAX_GROUPS = 10;
const DEFAULT_COLORS = ['#3584e4', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#546e7a'];

export default class TodoZenPreferences extends ExtensionPreferences {
    _inhibitor: boolean = false;

    // See GNOME.md for cross-version type workarounds
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - Gtk.Widget type mismatch in GNOME 46 types (fixed in 49+)
    getPreferencesWidget() {
        const ui = Gtk.Builder.new_from_file(this.dir.get_path() + '/prefs.ui');
        const page = ui.get_object('main-page') as Gtk.Widget;

        const settings = this.getSettings();
        const positions = ['left', 'center-left', 'center', 'center-right', 'right'];

        // Bind history toggle
        settings.bind(
            'enable-history',
            ui.get_object('enable-history'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Bind move-to-end button toggle
        settings.bind(
            'show-move-to-end-button',
            ui.get_object('show-move-to-end-button'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Bind show-pinned-in-panel toggle
        settings.bind(
            'show-pinned-in-panel',
            ui.get_object('show-pinned-in-panel'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Sync UI from settings
        const updatePositionUI = () => {
            if (this._inhibitor) return;
            this._inhibitor = true;

            const currentPosition = settings.get_string('panel-position');
            positions.forEach(pos => {
                const button = ui.get_object(`position-${pos}`) as Gtk.ToggleButton;
                button.set_active(pos === currentPosition);
            });

            this._inhibitor = false;
        };

        // Handle button clicks
        positions.forEach(pos => {
            const button = ui.get_object(`position-${pos}`) as Gtk.ToggleButton;
            button.connect('toggled', () => {
                if (this._inhibitor) return;
                if (!button.get_active()) return;

                this._inhibitor = true;
                settings.set_string('panel-position', pos);
                this._inhibitor = false;
                updatePositionUI();
            });
        });

        settings.connect('changed::panel-position', updatePositionUI);
        updatePositionUI();

        // ===== Popup Width =====
        const widths = ['normal', 'wide', 'ultra'];

        const updateWidthUI = () => {
            if (this._inhibitor) return;
            this._inhibitor = true;

            const currentWidth = settings.get_string('popup-width');
            widths.forEach(w => {
                const button = ui.get_object(`width-${w}`) as Gtk.ToggleButton;
                button.set_active(w === currentWidth);
            });

            this._inhibitor = false;
        };

        widths.forEach(w => {
            const button = ui.get_object(`width-${w}`) as Gtk.ToggleButton;
            button.connect('toggled', () => {
                if (this._inhibitor) return;
                if (!button.get_active()) return;

                this._inhibitor = true;
                settings.set_string('popup-width', w);
                this._inhibitor = false;
                updateWidthUI();
            });
        });

        settings.connect('changed::popup-width', updateWidthUI);
        updateWidthUI();

        // ===== Groups Management =====
        const groupsList = ui.get_object('groups-list') as Gtk.ListBox;
        const addGroupBtn = ui.get_object('add-group-btn') as Gtk.Button;

        const getGroups = (): Group[] => {
            return settings.get_strv('groups').map(g => JSON.parse(g) as Group);
        };

        const saveGroups = (groups: Group[]) => {
            settings.set_strv('groups', groups.map(g => JSON.stringify(g)));
        };

        const renderGroups = () => {
            // Clear existing rows
            let child = groupsList.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                groupsList.remove(child);
                child = next;
            }

            const groups = getGroups();

            groups.forEach((group, index) => {
                const row = new Adw.ActionRow();
                row.set_title(group.name);

                // Color button
                const colorBtn = new Gtk.ColorButton();
                const rgba = new Gdk.RGBA();
                rgba.parse(group.color);
                colorBtn.set_rgba(rgba);
                colorBtn.connect('color-set', () => {
                    const newColor = colorBtn.get_rgba().to_string();
                    // Convert rgba(r,g,b,a) to hex
                    const hexColor = rgbaToHex(newColor);
                    groups[index].color = hexColor;
                    saveGroups(groups);
                });
                row.add_suffix(colorBtn);

                // Edit button
                const editBtn = new Gtk.Button({ icon_name: 'document-edit-symbolic' });
                editBtn.add_css_class('flat');
                editBtn.connect('clicked', () => {
                    showEditDialog(group, index, groups);
                });
                row.add_suffix(editBtn);

                // Move up button (not for first)
                if (index > 0) {
                    const upBtn = new Gtk.Button({ icon_name: 'go-up-symbolic' });
                    upBtn.add_css_class('flat');
                    upBtn.connect('clicked', () => {
                        const temp = groups[index - 1];
                        groups[index - 1] = groups[index];
                        groups[index] = temp;
                        saveGroups(groups);
                        renderGroups();
                    });
                    row.add_suffix(upBtn);
                }

                // Move down button (not for last)
                if (index < groups.length - 1) {
                    const downBtn = new Gtk.Button({ icon_name: 'go-down-symbolic' });
                    downBtn.add_css_class('flat');
                    downBtn.connect('clicked', () => {
                        const temp = groups[index + 1];
                        groups[index + 1] = groups[index];
                        groups[index] = temp;
                        saveGroups(groups);
                        renderGroups();
                    });
                    row.add_suffix(downBtn);
                }

                // Clear tasks in group button
                const clearTasksBtn = new Gtk.Button({ icon_name: 'edit-clear-all-symbolic' });
                clearTasksBtn.add_css_class('flat');
                clearTasksBtn.set_tooltip_text('Clear all tasks in this group');
                clearTasksBtn.connect('clicked', () => {
                    showClearGroupDialog(group);
                });
                row.add_suffix(clearTasksBtn);

                // Delete button (not for inbox)
                if (group.id !== 'inbox') {
                    const deleteBtn = new Gtk.Button({ icon_name: 'user-trash-symbolic' });
                    deleteBtn.add_css_class('flat');
                    deleteBtn.add_css_class('destructive-action');
                    deleteBtn.connect('clicked', () => {
                        showDeleteDialog(group, index, groups);
                    });
                    row.add_suffix(deleteBtn);
                }

                groupsList.append(row);
            });

            // Update add button sensitivity
            addGroupBtn.set_sensitive(groups.length < MAX_GROUPS);
        };

        const showEditDialog = (group: Group, index: number, groups: Group[]) => {
            const dialog = new Adw.MessageDialog({
                heading: group.id === 'inbox' ? 'Rename Inbox' : 'Edit Group',
                transient_for: page.get_root() as Gtk.Window,
            });

            const entry = new Gtk.Entry({ text: group.name, hexpand: true });
            entry.connect('activate', () => {
                dialog.response('save');
            });

            const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
            box.append(new Gtk.Label({ label: 'Name:', xalign: 0 }));
            box.append(entry);
            dialog.set_extra_child(box);

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('save', 'Save');
            dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);

            dialog.connect('response', (_dialog: Adw.MessageDialog, response: string) => {
                if (response === 'save') {
                    const newName = entry.get_text().trim();
                    if (newName) {
                        groups[index].name = newName;
                        saveGroups(groups);
                        renderGroups();
                    }
                }
            });

            dialog.present();
        };

        const showDeleteDialog = (group: Group, index: number, groups: Group[]) => {
            const dialog = new Adw.MessageDialog({
                heading: 'Delete Group',
                body: `Type "${group.name}" to confirm deletion. Tasks will be moved to Inbox.`,
                transient_for: page.get_root() as Gtk.Window,
            });

            const entry = new Gtk.Entry({ placeholder_text: group.name });
            dialog.set_extra_child(entry);

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('delete', 'Delete');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_response_enabled('delete', false);

            entry.connect('changed', () => {
                const matches = entry.get_text() === group.name;
                dialog.set_response_enabled('delete', matches);
            });

            dialog.connect('response', (_dialog: Adw.MessageDialog, response: string) => {
                if (response === 'delete') {
                    // Move tasks to inbox (done by extension at runtime)
                    // Here we just update the groups setting
                    groups.splice(index, 1);
                    saveGroups(groups);
                    renderGroups();
                }
            });

            dialog.present();
        };

        const showClearGroupDialog = (group: Group) => {
            const todos = settings.get_strv('todos');
            const tasksInGroup = todos.filter(t => {
                const task: Task = JSON.parse(t);
                return (task.groupId || 'inbox') === group.id;
            });

            if (tasksInGroup.length === 0) {
                // Nothing to clear, show info
                const dialog = new Adw.MessageDialog({
                    heading: 'No Tasks',
                    body: `"${group.name}" has no tasks to clear.`,
                    transient_for: page.get_root() as Gtk.Window,
                });
                dialog.add_response('ok', 'OK');
                dialog.present();
                return;
            }

            const dialog = new Adw.MessageDialog({
                heading: `Clear "${group.name}"`,
                body: `This will permanently delete ${tasksInGroup.length} task(s). Type "CLEAR" to confirm.`,
                transient_for: page.get_root() as Gtk.Window,
            });

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('clear', 'Clear All');
            dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_response_enabled('clear', false);

            const entry = new Gtk.Entry({
                placeholder_text: 'Type CLEAR to confirm',
                margin_top: 12,
            });
            dialog.set_extra_child(entry);

            entry.connect('changed', () => {
                dialog.set_response_enabled('clear', entry.get_text() === 'CLEAR');
            });

            dialog.connect('response', (_dialog: Adw.MessageDialog, response: string) => {
                if (response === 'clear') {
                    // Log deleted tasks if history enabled
                    if (settings.get_boolean('enable-history')) {
                        const history = new HistoryLogger();
                        tasksInGroup.forEach(t => {
                            const task: Task = JSON.parse(t);
                            history.log('removed', { taskId: task.id, task: task.name, group: group.name });
                        });
                    }

                    // Remove tasks in this group
                    const remainingTodos = todos.filter(t => {
                        const task: Task = JSON.parse(t);
                        return (task.groupId || 'inbox') !== group.id;
                    });
                    settings.set_strv('todos', remainingTodos);
                }
                dialog.destroy();
            });

            dialog.present();
        };

        addGroupBtn.connect('clicked', () => {
            const groups = getGroups();
            if (groups.length >= MAX_GROUPS) return;

            const colorIndex = groups.length % DEFAULT_COLORS.length;
            const newGroup: Group = {
                version: 1,
                id: `group_${Date.now()}`,
                name: `Group ${groups.length}`,
                color: DEFAULT_COLORS[colorIndex],
            };
            groups.push(newGroup);
            saveGroups(groups);
            renderGroups();
        });

        settings.connect('changed::groups', renderGroups);
        renderGroups();

        // ===== Clear All Tasks =====
        const clearAllBtn = ui.get_object('clear-all-btn') as Gtk.Button;
        clearAllBtn.connect('clicked', () => {
            const todos = settings.get_strv('todos');
            if (todos.length === 0) {
                return; // Nothing to clear
            }

            const dialog = new Adw.MessageDialog({
                heading: 'Clear All Tasks',
                body: `This will permanently delete ${todos.length} task(s). Type "DELETE" to confirm.`,
                transient_for: page.get_root() as Gtk.Window,
            });

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('delete', 'Delete All');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_response_enabled('delete', false);

            const entry = new Gtk.Entry({
                placeholder_text: 'Type DELETE to confirm',
                margin_top: 12,
            });
            dialog.set_extra_child(entry);

            entry.connect('changed', () => {
                const text = entry.get_text();
                dialog.set_response_enabled('delete', text === 'DELETE');
            });

            dialog.connect('response', (_dialog: Adw.MessageDialog, response: string) => {
                if (response === 'delete') {
                    // Log each deleted task to history if enabled
                    if (settings.get_boolean('enable-history')) {
                        const history = new HistoryLogger();
                        const tasks: Task[] = todos.map(t => JSON.parse(t));
                        tasks.forEach(task => {
                            history.log('removed', { taskId: task.id, task: task.name });
                        });
                        history.log('cleared_all', { details: `${tasks.length} tasks` });
                    }
                    settings.set_strv('todos', []);
                }
                dialog.destroy();
            });

            dialog.present();
        });

        // ===== About Section =====
        const versionRow = ui.get_object('version-row') as Adw.ActionRow;
        const buildTimeRow = ui.get_object('build-time-row') as Adw.ActionRow;

        // Read metadata.json for version
        try {
            const metadataFile = Gio.File.new_for_path(this.dir.get_path() + '/metadata.json');
            const [, contents] = metadataFile.load_contents(null);
            const decoder = new TextDecoder();
            const metadata = JSON.parse(decoder.decode(contents));
            versionRow.set_subtitle(`${metadata.version || '-'}`);
        } catch {
            versionRow.set_subtitle('Unknown');
        }

        // Read build-info.json for build time
        try {
            const buildInfoFile = Gio.File.new_for_path(this.dir.get_path() + '/build-info.json');
            const [, contents] = buildInfoFile.load_contents(null);
            const decoder = new TextDecoder();
            const buildInfo = JSON.parse(decoder.decode(contents));
            buildTimeRow.set_subtitle(buildInfo.buildTime || '-');
        } catch {
            buildTimeRow.set_subtitle('Unknown');
        }

        // Keep settings alive
        // @ts-expect-error - attaching to widget for lifecycle
        page._settings = settings;

        return page;
    }
}
