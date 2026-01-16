# GNOME Extensions on Wayland

## The Problem

On Wayland, GNOME Shell **is** the display server. Restarting the shell kills your entire session and all running applications. This is fundamentally different from X11, where the shell is just another client.

## Installing Extensions

| Session | New Extension Available? | How to Activate |
|---------|-------------------------|-----------------|
| X11 | Immediately | `Alt+F2` → `r` → Enter |
| Wayland | After logout/login | Log out, log back in |

This applies to **all** installation methods:
- `gnome-extensions install extension.zip`
- Browser install from extensions.gnome.org
- Manual copy to `~/.local/share/gnome-shell/extensions/`

## Why Browser Installs Seem Instant

They're not on Wayland. The browser connector (`gnome-browser-connector`) calls `InstallRemoteExtension` via D-Bus, which downloads and places the files, but the extension won't actually load until you log out and back in.

On X11, the shell can restart in-place, so it appears instant.

## Development Workaround

Run a nested GNOME Shell session for testing:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

This runs a separate GNOME Shell instance in a window. You can:
- Test extensions without affecting your main session
- Restart this nested shell freely
- See logs with `journalctl -f -o cat /usr/bin/gnome-shell`

## D-Bus Methods (Limited Use)

These only work for extensions GNOME Shell already knows about:

```bash
# Enable (extension must already be registered)
gdbus call --session --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.EnableExtension "extension@uuid"

# Reload (deprecated, doesn't re-read from disk)
busctl --user call org.gnome.Shell.Extensions \
  /org/gnome/Shell/Extensions org.gnome.Shell.Extensions \
  ReloadExtension s "extension@uuid"
```

## References

- [GNOME Discourse - Enable extensions without restart](https://discourse.gnome.org/t/enable-gnome-extensions-without-session-restart/7936)
- [GJS Guide - Debugging](https://gjs.guide/extensions/development/debugging.html)
- [Wayland extension development workflows](https://discourse.gnome.org/t/gnome-shell-extension-development-workflows-with-wayland/7249)
