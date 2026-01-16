"use strict";
import Clutter from "gi://Clutter";
import St from "gi://St";
import {
    Extension,
    gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Task, TodoListManager } from "./manager.js";
import { extractUrls, extractDomain, buttonIcon, truncateText, createExtensionError, formatErrorForLog, ExtensionError } from "./utils.js";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const POPUP_WIDTHS: Record<string, number> = {
    'normal': 500,
    'wide': 700,
    'ultra': 900,
};
const INPUT_WIDTHS: Record<string, number> = {
    'normal': 380,
    'wide': 560,
    'ultra': 760,
};
const MAX_INPUT_CHARS = 200;
const LOG_PATH = '~/.config/todozen/';

export default class TodoListExtension extends Extension {
    _indicator?: PanelMenu.Button | null;
    _manager!: TodoListManager | null;
    _settings?: Gio.Settings | null;
    _positionChangedId?: number | null;
    mainBox?: St.BoxLayout | null;
    todosBox!: St.BoxLayout | null;
    scrollView?: St.ScrollView | null;
    buttonText!: St.Label | null;
    input?: St.Entry | null;
    button!: PanelMenu.Button | null;
    _activeConfirmation?: PopupMenu.PopupMenuItem | null;
    _confirmationTimeoutId: number | null = null;
    _filterDropdown?: St.Button | null;
    _groupDropdown?: St.Button | null;
    _selectedGroupId: string = 'inbox';
    _expandedGroups: Set<string> = new Set();
    _menuOpenStateId?: number | null;
    _needsPopulate: boolean = true;
    _groupsChangedId?: number | null;
    _todosChangedId?: number | null;
    _errorMode: boolean = false;
    _lastError?: ExtensionError | null;
    _isEditing: boolean = false;
    _taskItems: PopupMenu.PopupMenuItem[] = [];
    _popupWidthMode: string = 'normal';
    _popupWidthChangedId?: number | null;

    enable() {
        try {
            this._enableInternal();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this._lastError = createExtensionError(msg, 'enable');
            console.error(formatErrorForLog(this._lastError));
            this._enterErrorMode();
        }
    }

    _enableInternal() {
        this._settings = this.getSettings();
        this.button = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._manager = new TodoListManager(this);

        this.buttonText = new St.Label({
            text: buttonIcon(this._manager.getTotalUndone()),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.buttonText.set_style("text-align:center;");
        this.button.add_child(this.buttonText);
        this._indicator = this.button;

        // Add to panel at configured position
        this._addToPanel();

        // Listen for position changes
        this._positionChangedId = this._settings.connect('changed::panel-position', () => {
            this._repositionButton();
        });

        // Load popup width setting
        this._popupWidthMode = this._settings.get_string('popup-width') || 'normal';
        this._popupWidthChangedId = this._settings.connect('changed::popup-width', () => {
            this._popupWidthMode = this._settings?.get_string('popup-width') || 'normal';
            this._applyPopupWidth();
        });

        this._buildPopupMenu();
        this._toggleShortcut();

        // Listen for settings changes from prefs (e.g., group reorder, clear all)
        this._needsPopulate = true;
        this._groupsChangedId = this._settings.connect('changed::groups', () => {
            this._needsPopulate = true;
        });
        this._todosChangedId = this._settings.connect('changed::todos', () => {
            this._needsPopulate = true;
            // Also update button count
            this.buttonText?.set_text(buttonIcon(this._manager?.getTotalUndone() || 0));
        });

        // Populate todo list when menu opens (only if needed)
        // @ts-expect-error - open-state-changed signal exists but types don't include it
        this._menuOpenStateId = this.button.menu.connect('open-state-changed', (_menu: unknown, isOpen: boolean) => {
            if (isOpen && this._needsPopulate) {
                this._populate();
                this._needsPopulate = false;
            }
        });
    }

    _enterErrorMode() {
        this._errorMode = true;

        // Create minimal error indicator
        this.button = new PanelMenu.Button(0.0, this.metadata.name, false);

        const errorIcon = new St.Icon({
            icon_name: 'dialog-error-symbolic',
            style_class: 'system-status-icon',
            style: 'color: #e53e3e;',
        });
        this.button.add_child(errorIcon);
        this._indicator = this.button;

        // Add to panel
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        // Build error menu
        this._buildErrorMenu();
    }

    _buildErrorMenu() {
        if (!this.button) return;

        const mainBox = new St.BoxLayout({
            vertical: true,
            style: `width: ${POPUP_WIDTHS['normal']}px; padding: 16px;`,
        });

        // Error icon and title
        const headerBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 12px; margin-bottom: 16px;',
        });

        const errorIcon = new St.Icon({
            icon_name: 'dialog-error-symbolic',
            style: 'color: #e53e3e;',
            icon_size: 32,
        });

        const titleLabel = new St.Label({
            text: _('TodoZen Error'),
            style: 'font-size: 16px; font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER,
        });

        headerBox.add_child(errorIcon);
        headerBox.add_child(titleLabel);
        mainBox.add_child(headerBox);

        // Error message
        const errorMsg = this._lastError?.message || _('Unknown error');
        const messageLabel = new St.Label({
            text: errorMsg,
            style: 'margin-bottom: 16px; color: #999;',
        });
        messageLabel.clutterText.line_wrap = true;
        mainBox.add_child(messageLabel);

        // Instructions
        const instructionsLabel = new St.Label({
            text: _('Check logs for details:'),
            style: 'margin-bottom: 8px;',
        });
        mainBox.add_child(instructionsLabel);

        // Log commands box
        const logBox = new St.BoxLayout({
            vertical: true,
            style: 'background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; margin-bottom: 16px;',
        });

        const journalCmd = new St.Label({
            text: 'journalctl -f -o cat /usr/bin/gnome-shell',
            style: 'font-family: monospace; font-size: 11px; margin-bottom: 4px;',
        });
        const historyPath = new St.Label({
            text: LOG_PATH + 'history.jsonl',
            style: 'font-family: monospace; font-size: 11px;',
        });

        logBox.add_child(journalCmd);
        logBox.add_child(historyPath);
        mainBox.add_child(logBox);

        // Timestamp
        if (this._lastError?.timestamp) {
            const timeLabel = new St.Label({
                text: `Error at: ${this._lastError.timestamp}`,
                style: 'font-size: 10px; color: #666;',
            });
            mainBox.add_child(timeLabel);
        }

        // Restart hint
        const restartLabel = new St.Label({
            text: _('Try disabling and re-enabling the extension, or restart GNOME Shell.'),
            style: 'margin-top: 12px; font-size: 11px; color: #888;',
        });
        restartLabel.clutterText.line_wrap = true;
        mainBox.add_child(restartLabel);

        (this.button.menu as PopupMenu.PopupMenu).box.add_child(mainBox);
    }

    _getPositionConfig() {
        const position = this._settings?.get_string('panel-position') || 'right';
        // Map position setting to panel box and index
        const config: { [key: string]: { box: string; index: number } } = {
            'left':         { box: 'left',   index: 0 },
            'center-left':  { box: 'center', index: 0 },
            'center':       { box: 'center', index: 1 },
            'center-right': { box: 'center', index: 2 },
            'right':        { box: 'right',  index: 0 },
        };
        return config[position] || config['right'];
    }

    _addToPanel() {
        const { box, index } = this._getPositionConfig();
        Main.panel.addToStatusArea(this.uuid, this._indicator!, index, box);
    }

    _repositionButton() {
        if (!this._indicator) return;

        // Remove from current position
        const container = this._indicator.get_parent();
        if (container) {
            container.remove_child(this._indicator);
        }

        // Add to new position
        const { box, index } = this._getPositionConfig();
        // @ts-expect-error - dynamic panel box access
        const boxWidget = Main.panel[`_${box}Box`] as St.BoxLayout;
        const clampedIndex = Math.min(index, boxWidget.get_n_children());
        boxWidget.insert_child_at_index(this._indicator, clampedIndex);
    }

    _buildPopupMenu() {
        // Destroy previous box
        if (this.mainBox != undefined) {
            this.mainBox.destroy();
        }

        // Create main box
        this.mainBox = new St.BoxLayout({ vertical: true });

        // Initialize selected group from settings
        this._selectedGroupId = this._manager?.getLastSelectedGroup() || 'inbox';

        // Initialize all groups as expanded by default
        const groups = this._manager?.getGroups() || [];
        groups.forEach(g => this._expandedGroups.add(g.id));

        // Filter dropdown at top
        const filterSection = new St.BoxLayout({
            vertical: false,
            style: "padding: 8px 12px; spacing: 8px;",
        });

        const filterLabel = new St.Label({
            text: _("Filter:"),
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._filterDropdown = this._createDropdown(
            this._getFilterLabel(),
            () => this._cycleFilter()
        );

        // Spacer to push settings button to the right
        const spacer = new St.Widget({ x_expand: true });

        // Settings button
        const settingsBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'btn-icon',
            }),
            style_class: 'settings-btn',
            y_align: Clutter.ActorAlign.CENTER,
        });
        settingsBtn.connect('clicked', () => {
            // Close the menu first
            // @ts-expect-error - close() works without animation argument
            this.button?.menu.close();
            // Open extension preferences
            this.openPreferences();
        });

        filterSection.add_child(filterLabel);
        filterSection.add_child(this._filterDropdown);
        filterSection.add_child(spacer);
        filterSection.add_child(settingsBtn);
        this.mainBox.add_child(filterSection);

        // Separator after filter
        const filterSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.mainBox.add_child(filterSeparator);

        // Create todos box
        this.todosBox = new St.BoxLayout({ vertical: true });

        // Create todos scrollview
        this.scrollView = new St.ScrollView({
            style_class: "vfade",
        });
        this.scrollView.add_child(this.todosBox);

        // Separator before input
        const separator = new PopupMenu.PopupSeparatorMenuItem();

        // Bottom section with input and buttons
        const bottomSection = new PopupMenu.PopupMenuSection();
        const inputContainer = new St.BoxLayout({
            vertical: false,
            style: "spacing: 8px;",
        });

        // Group selector dropdown (click to cycle through groups)
        this._groupDropdown = this._createDropdown(
            this._getGroupLabel(this._selectedGroupId),
            () => this._cycleGroup()
        );
        this._groupDropdown.set_style("min-width: 80px;");

        // Text entry - width set by _applyPopupWidth based on popup-width setting
        this.input = new St.Entry({
            name: "newTaskEntry",
            hint_text: _("Add new task..."),
            track_hover: true,
            can_focus: true,
            styleClass: "input",
        });

        this.input.clutterText.connect("activate", (source) => {
            const taskText = source.get_text().trim();
            // Exit edit mode before any changes
            if (this._isEditing) {
                this._exitEditMode();
            }
            if (taskText) {
                this._addTask(taskText);
                source.set_text("");
                source.grab_key_focus();
            }
        });

        // Exit edit mode when input loses focus
        this.input.clutterText.connect("key-focus-out", () => {
            if (this._isEditing) {
                this._exitEditMode();
            }
        });

        this.input.clutterText.set_max_length(MAX_INPUT_CHARS);

        inputContainer.add_child(this._groupDropdown);
        inputContainer.add_child(this.input);
        bottomSection.actor.add_child(inputContainer);

        this.mainBox.add_child(this.scrollView);
        this.mainBox.add_child(separator);
        this._applyPopupWidth();
        this.mainBox.add_child(bottomSection.actor);

        (this.button?.menu as PopupMenu.PopupMenu).box.add_child(this.mainBox);
    }

    _applyPopupWidth() {
        const popupWidth = POPUP_WIDTHS[this._popupWidthMode] || POPUP_WIDTHS['normal'];
        const inputWidth = INPUT_WIDTHS[this._popupWidthMode] || INPUT_WIDTHS['normal'];
        this.mainBox?.set_style(`width: ${popupWidth}px; max-height: 500px;`);
        this.input?.set_style(`width: ${inputWidth}px; height: 35px;`);
    }

    _createDropdown(label: string, onClick: () => void): St.Button {
        const box = new St.BoxLayout({ vertical: false, style: "spacing: 4px;" });
        const textLabel = new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const arrow = new St.Icon({
            icon_name: "pan-down-symbolic",
            style_class: "btn-icon",
        });
        box.add_child(textLabel);
        box.add_child(arrow);

        const btn = new St.Button({
            child: box,
            style_class: "dropdown-btn",
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.connect("clicked", onClick);
        return btn;
    }

    _getFilterLabel(): string {
        const filterGroup = this._manager?.getFilterGroup();
        if (!filterGroup) return _("All");
        const group = this._manager?.getGroup(filterGroup);
        return group?.name || _("All");
    }

    _getGroupLabel(groupId: string): string {
        const group = this._manager?.getGroup(groupId);
        return group?.name || _("Inbox");
    }

    _cycleFilter() {
        // Cycle through: All → group1 → group2 → ... → All
        const groups = this._manager?.getGroups() || [];
        const currentFilter = this._manager?.getFilterGroup() || '';

        if (!currentFilter) {
            // Currently "All", go to first group
            if (groups.length > 0) {
                this._manager?.setFilterGroup(groups[0].id);
            }
        } else {
            // Find current group index and go to next (or wrap to All)
            const currentIndex = groups.findIndex(g => g.id === currentFilter);
            if (currentIndex === -1 || currentIndex === groups.length - 1) {
                // Not found or last group, go to All
                this._manager?.setFilterGroup('');
            } else {
                // Go to next group
                this._manager?.setFilterGroup(groups[currentIndex + 1].id);
            }
        }

        this._updateFilterLabel();
        this._populate(true);
    }

    _cycleGroup() {
        // Cycle through groups for new task assignment
        const groups = this._manager?.getGroups() || [];
        if (groups.length === 0) return;

        const currentIndex = groups.findIndex(g => g.id === this._selectedGroupId);
        const nextIndex = (currentIndex + 1) % groups.length;

        this._selectedGroupId = groups[nextIndex].id;
        this._manager?.setLastSelectedGroup(this._selectedGroupId);
        this._updateGroupLabel();
    }

    _updateFilterLabel() {
        if (this._filterDropdown) {
            const box = this._filterDropdown.get_child() as St.BoxLayout;
            const label = box.get_first_child() as St.Label;
            label.set_text(this._getFilterLabel());
        }
    }

    _updateGroupLabel() {
        if (this._groupDropdown) {
            const box = this._groupDropdown.get_child() as St.BoxLayout;
            const label = box.get_first_child() as St.Label;
            label.set_text(this._getGroupLabel(this._selectedGroupId));
        }
    }

    _populate(updateButtonText = false) {
        // clear the todos box before populating it
        this.todosBox?.destroy_all_children();
        this._taskItems = [];
        const todos = this._manager?.getParsed() || [];
        const filterGroup = this._manager?.getFilterGroup() || '';
        const groups = this._manager?.getGroups() || [];

        // Filter tasks if a filter is set
        const filteredTasks = filterGroup
            ? todos.filter(t => t.groupId === filterGroup)
            : todos;

        if (!filteredTasks.length) {
            const item = new St.Label({
                text: _("✅ Nothing to do for now"),
                y_align: Clutter.ActorAlign.CENTER,
                style: "text-align:center; font-size: 20px; padding: 20px 0;",
            });
            this.todosBox?.add_child(item);
            if (updateButtonText) {
                // No tasks in filter = 0 undone (avoids redundant getParsed() call)
                this._setButtonText(0);
            }
            return;
        }

        // Group tasks by groupId
        const tasksByGroup = new Map<string, { task: Task; index: number }[]>();
        todos.forEach((task, index) => {
            const groupId = task.groupId || 'inbox';
            if (!tasksByGroup.has(groupId)) {
                tasksByGroup.set(groupId, []);
            }
            tasksByGroup.get(groupId)!.push({ task, index });
        });

        let totalUndone = 0;

        // Render each group
        groups.forEach(group => {
            const groupTasks = tasksByGroup.get(group.id) || [];

            // Skip empty groups or groups not matching filter
            if (groupTasks.length === 0) return;
            if (filterGroup && filterGroup !== group.id) return;

            // Create collapsible group header
            const isExpanded = this._expandedGroups.has(group.id);
            const groupHeader = this._createGroupHeader(group, groupTasks.length, isExpanded);
            this.todosBox?.add_child(groupHeader);

            // Render tasks if expanded
            if (isExpanded) {
                groupTasks.forEach(({ task, index }) => {
                    if (!task.isDone) totalUndone++;
                    this._addTodoItem(task, index);
                });
            } else {
                // Still count undone even if collapsed
                groupTasks.forEach(({ task }) => {
                    if (!task.isDone) totalUndone++;
                });
            }
        });

        if (updateButtonText) {
            this._setButtonText(totalUndone);
        }
    }

    _createGroupHeader(group: { id: string; name: string; color: string }, taskCount: number, isExpanded: boolean): St.BoxLayout {
        const header = new St.BoxLayout({
            vertical: false,
            style: `padding: 8px 12px; background-color: ${group.color}22; border-left: 3px solid ${group.color};`,
            reactive: true,
        });

        const expandIcon = new St.Icon({
            icon_name: isExpanded ? "pan-down-symbolic" : "pan-end-symbolic",
            style_class: "btn-icon",
        });

        const nameLabel = new St.Label({
            text: `${group.name} (${taskCount})`,
            y_align: Clutter.ActorAlign.CENTER,
            style: "font-weight: bold; margin-left: 8px;",
        });

        header.add_child(expandIcon);
        header.add_child(nameLabel);

        // Toggle expand/collapse on click
        header.connect('button-press-event', () => {
            if (this._expandedGroups.has(group.id)) {
                this._expandedGroups.delete(group.id);
            } else {
                this._expandedGroups.add(group.id);
            }
            this._populate();
            return Clutter.EVENT_STOP;
        });

        return header;
    }

    _addTask(task: string) {
        this._manager?.add(task, this._selectedGroupId);
        this._populate(true);
    }

    _addTodoItem(task: Task, index: number) {
        const isFocused = index === 0 && task.isFocused;
        // Create a new PopupMenuItem for the task
        const item = new PopupMenu.PopupMenuItem("");
        item.style_class = `item ${isFocused ? "focused-task" : ""}`;
        // Create a horizontal box layout for custom alignment
        const box = new St.BoxLayout({
            style_class: "todo-item-layout",
            vertical: false,
            x_expand: true,
        });


        // Checkbox button
        const toggleBtnLabel = new St.Label({
            text: task.isDone ? "✔" : "",
        });
        const toggleCompletionBtn = new St.Button({
            style_class: "toggle-completion-btn",
            y_align: Clutter.ActorAlign.CENTER,
            child: toggleBtnLabel,
        });

        toggleCompletionBtn.connect("clicked", () => {
            this._manager?.update(index, { ...task, isDone: !task.isDone });
            const willBeDone = !task.isDone;
            if (willBeDone) {
                // toggler, so we are going to add the done icon
                toggleBtnLabel.set_text("✔");
            } else {
                toggleBtnLabel.set_text("");
            }
            this._populate(true);
        });

        box.add_child(toggleCompletionBtn);

        // Extract URLs from task name
        const { displayText, urls: taskUrls } = extractUrls(task.name);

        // Task label (shows text without URLs)
        const label = new St.Label({
            text: displayText,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: "task-label",
        });
        label.clutterText.line_wrap = true;
        label.clutterText.set_ellipsize(0);

        if (task.isDone) {
            // cross line
            label.clutterText.set_markup(`<s>${displayText}</s>`);
            label.set_style("color: #999");
        }

        // Copy button
        const copyButton = new St.Button({
            child: new St.Icon({
                icon_name: "edit-copy-symbolic",
                style_class: "btn-icon",
            }),
            style_class: "copy-btn",
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
        });
        copyButton.connect("clicked", () => {
            // Access the clipboard
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, task.name); // Copy to clipboard
            // Optionally show a notification
            Main.notify("Copied to clipboard", task.name);
            return Clutter.EVENT_STOP; // Stop propagation of the event
        });

        // Create link buttons for each URL
        const linkButtons: St.Button[] = [];
        const showDomainLabel = taskUrls.length > 1;

        for (const url of taskUrls) {
            let buttonChild: St.Widget;
            if (showDomainLabel) {
                const btnBox = new St.BoxLayout({
                    vertical: false,
                    style: 'spacing: 4px;',
                });
                btnBox.add_child(new St.Icon({
                    icon_name: "web-browser-symbolic",
                    style_class: "btn-icon",
                }));
                btnBox.add_child(new St.Label({
                    text: extractDomain(url),
                    style: 'font-size: 10px;',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                buttonChild = btnBox;
            } else {
                buttonChild = new St.Icon({
                    icon_name: "web-browser-symbolic",
                    style_class: "btn-icon",
                });
            }

            const linkButton = new St.Button({
                child: buttonChild,
                style_class: "link-btn",
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.END,
            });

            linkButton.connect("clicked", () => {
                try {
                    Gio.AppInfo.launch_default_for_uri(url, null);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    Main.notify("Failed to open URL", `${url}\n${msg}`);
                }
                return Clutter.EVENT_STOP;
            });

            linkButtons.push(linkButton);
        }

        // Rename button
        const renameButton = new St.Button({
            child: new St.Icon({
                icon_name: "document-edit-symbolic",
                style_class: "btn-icon",
            }),
            style_class: "rename-btn", // Use specific class for rename button
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
        });
        renameButton.connect("clicked", () => {
            if (!task.isDone) {
                this._renameTask(task, index);
            }
            return Clutter.EVENT_STOP; // Stop propagation of the event
        });

        // Remove button (hidden in edit mode)
        const removeButton = new St.Button({
            child: new St.Icon({
                icon_name: "edit-delete-symbolic",
                style_class: "remove-icon btn-icon",
            }),
            style_class: "remove-btn",
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
        });

        // Connect the button click event
        removeButton.connect("clicked", () => {
            if (task.isDone) {
                // No confirmation for completed tasks
                this._manager?.remove(index);
                this._populate(true);
            } else {
                // Show confirmation for uncompleted tasks
                this._showDeleteConfirmation(task.name, index, () => {
                    this._manager?.remove(index);
                    this._populate(true);
                });
            }
        });

        // Focus button
        const focusButton = new St.Button({
            child: new St.Icon({
                icon_name: "find-location-symbolic",
                style_class: "focus-icon btn-icon",
            }),
            style_class: "focus-btn",
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
        });

        focusButton.connect("clicked", () => {
            this._manager?.update(index, {
                ...task,
                isFocused: !isFocused,
            });
            this._populate();
        });

        // Create action buttons container for right alignment
        const actionButtonsContainer = new St.BoxLayout({
            vertical: false,
            style_class: "action-buttons-container",
            style: "spacing: 5px;",
            x_align: Clutter.ActorAlign.END,
        });

        for (const linkBtn of linkButtons) {
            actionButtonsContainer.add_child(linkBtn);
        }
        actionButtonsContainer.add_child(copyButton);
        actionButtonsContainer.add_child(renameButton);
        actionButtonsContainer.add_child(focusButton);
        actionButtonsContainer.add_child(removeButton);

        box.add_child(label);
        box.add_child(actionButtonsContainer);

        // Add the box to the item
        item.add_child(box);

        // Track item for edit mode
        this._taskItems.push(item);

        // Finally, add the item to the todosBox
        this.todosBox?.add_child(item);
    }

    _setButtonText(count: number) {
        this.buttonText?.clutterText.set_text(buttonIcon(count));
    }

    _toggleShortcut() {
        Main.wm.addKeybinding(
            "open-todozen",
            this.getSettings(),
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => {
                this.button?.menu.toggle();
                this.input?.clutterText.grab_key_focus();
            }
        );
    }

    _renameTask(task: Task, index: number) {
        // Put the task text in the input field
        this.input?.set_text(task.name);

        // Remove the task from the list
        this._manager?.remove(index);

        // Refresh the view to remove the task from display
        this._populate(true);

        // Enter edit mode - disable hover on task items
        this._enterEditMode();

        // Focus the input field for editing
        this.input?.clutterText.grab_key_focus();

        // Select all text for easy editing
        this.input?.clutterText.set_selection(0, -1);
    }

    _enterEditMode() {
        this._isEditing = true;
        // Disable reactivity on all task items to prevent hover interference
        for (const item of this._taskItems) {
            item.reactive = false;
        }
    }

    _exitEditMode() {
        this._isEditing = false;
        // Re-enable reactivity on all task items
        for (const item of this._taskItems) {
            item.reactive = true;
        }
    }

    _createConfirmationDialog(
        message: string,
        onConfirm: () => void,
        insertIndex: number = 0,
        scrollToTop: boolean = false
    ) {
        // Remove any existing confirmation first
        if (this._activeConfirmation) {
            this._activeConfirmation.destroy();
            this._activeConfirmation = null;
        }

        // Create main confirmation item
        const confirmItem = new PopupMenu.PopupMenuItem("");
        confirmItem.style_class = "item confirmation-item";
        this._activeConfirmation = confirmItem;

        // Create confirmation container - single horizontal line
        const confirmBox = new St.BoxLayout({
            vertical: false,
            style_class: "confirmation-container",
            style: "padding: 8px 12px; spacing: 8px; align-items: center;",
        });

        const warningIcon = new St.Icon({
            icon_name: "dialog-warning-symbolic",
            style_class: "btn-icon",
            style: "color: #e53e3e; margin-right: 8px;",
        });

        const confirmLabel = new St.Label({
            text: message,
            style: "font-weight: bold;",
            y_align: Clutter.ActorAlign.CENTER,
        });

        const cancelBtn = new St.Button({
            child: new St.Icon({
                icon_name: "window-close-symbolic",
                style_class: "btn-icon",
            }),
            style_class: "focus-btn",
            y_align: Clutter.ActorAlign.CENTER,
        });

        const confirmBtn = new St.Button({
            child: new St.Icon({
                icon_name: "edit-delete-symbolic",
                style_class: "btn-icon",
            }),
            style_class: "remove-btn",
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Spacer to push buttons to the right
        const spacer = new St.Widget({
            style: "min-width: 0px;",
            x_expand: true,
        });

        // Button container
        const buttonContainer = new St.BoxLayout({
            vertical: false,
            style: "spacing: 4px;",
        });
        buttonContainer.add_child(cancelBtn);
        buttonContainer.add_child(confirmBtn);

        const removeConfirmation = () => {
            if (this._activeConfirmation) {
                this._activeConfirmation.destroy();
                this._activeConfirmation = null;
            }
        };

        cancelBtn.connect("clicked", removeConfirmation);

        confirmBtn.connect("clicked", () => {
            removeConfirmation();
            onConfirm();
        });

        confirmBox.add_child(warningIcon);
        confirmBox.add_child(confirmLabel);
        confirmBox.add_child(spacer);
        confirmBox.add_child(buttonContainer);
        confirmItem.add_child(confirmBox);

        this.todosBox!.insert_child_at_index(confirmItem, insertIndex);

        if (scrollToTop) {
            // Scroll to top to make the confirmation visible
            this.scrollView?.get_vscroll_bar()?.get_adjustment()?.set_value(0);
        }

        // Clear previous timeout if any
        if (this._confirmationTimeoutId) {
            GLib.source_remove(this._confirmationTimeoutId);
            this._confirmationTimeoutId = null;
        }

        // Set new timeout
        this._confirmationTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8000, () => {
            if (this._activeConfirmation === confirmItem) {
                removeConfirmation();
            }
            this._confirmationTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _showDeleteConfirmation(taskName: string, itemIndex: number, onConfirm: () => void) {
        // Create a beautiful modal-like confirmation
        this._createConfirmationDialog(
            `Delete "${truncateText(taskName)}"?`,
            onConfirm,
            itemIndex + 1,
            false
        );
    }

    disable() {
        // Remove keybinding (only if not in error mode)
        if (!this._errorMode) {
            try {
                Main.wm.removeKeybinding("open-todozen");
            } catch {
                // Keybinding may not exist in error mode
            }
        }

        // Disconnect settings signals
        if (this._positionChangedId && this._settings) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }
        if (this._groupsChangedId && this._settings) {
            this._settings.disconnect(this._groupsChangedId);
            this._groupsChangedId = null;
        }
        if (this._todosChangedId && this._settings) {
            this._settings.disconnect(this._todosChangedId);
            this._todosChangedId = null;
        }
        if (this._popupWidthChangedId && this._settings) {
            this._settings.disconnect(this._popupWidthChangedId);
            this._popupWidthChangedId = null;
        }

        // Disconnect menu open-state-changed signal
        if (this._menuOpenStateId && this.button?.menu) {
            this.button.menu.disconnect(this._menuOpenStateId);
            this._menuOpenStateId = null;
        }

        // Remove all timeouts safely
        if (this._confirmationTimeoutId) {
            GLib.source_remove(this._confirmationTimeoutId);
            this._confirmationTimeoutId = null;
        }

        if (this._activeConfirmation) {
            try {
                this._activeConfirmation.destroy();
            } catch {
            }
            this._activeConfirmation = null;
        }

        // Destroy top-level widgets only (children are destroyed automatically)
        // Order matters: destroy indicator last as it owns the menu
        try {
            this._indicator?.destroy();
        } catch {
        }

        // Clear all references
        this.mainBox = null;
        this.todosBox = null;
        this.scrollView = null;
        this.buttonText = null;
        this.input = null;
        this.button = null;
        this._indicator = null;
        this._activeConfirmation = null;
        this._filterDropdown = null;
        this._groupDropdown = null;
        this._expandedGroups.clear();
        this._manager?.destroy();
        this._manager = null;
        this._settings = null;
        this._errorMode = false;
        this._lastError = null;
    }

}
