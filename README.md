# Wallpaper Transparency

A small Plasma 6 KWin script that lets translucent windows reveal the desktop wallpaper instead of lower application windows.

When an eligible window is focused, lower overlapping eligible windows are temporarily set to opacity `0`. The focused window's normal KWin opacity then reveals the desktop behind it. Lower windows remain open and in their normal stacking/task-switcher history.

## Safety behavior

The script deliberately does not minimize, hide, reorder, or focus windows. It skips fullscreen windows, protected application classes, desktop/panel windows, dialogs, popups, and other non-normal windows. By default it protects:

- `kitty`
- classes containing `steam_app`
- `gamescope`

If a protected window overlaps the focused window, the focused window becomes temporarily opaque instead of revealing that protected window. This preserves game and terminal isolation at the cost of the wallpaper effect in that overlap.

## Requirements

- KDE Plasma 6 with KWin
- Wayland or X11
- A normal KWin opacity rule, for example active `95%` and inactive `90%`

The script does not set a window's normal opacity. It temporarily overrides lower windows during overlap and restores their previous values.

## Install locally

From this repository:

```bash
kpackagetool6 -t KWin/Script -i .
kwriteconfig6 --file kwinrc --group Plugins --key wallpaper-transparencyEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

Enable **Wallpaper Transparency** in **System Settings → Window Management → KWin Scripts** if KWin does not enable it automatically.

Configure it from the script's settings button. Protected classes accept comma-separated values:

- `[kitty]` — exact match
- `{steam_app}` — contains match
- `gamescope` — exact match

## Disable or uninstall

```bash
kwriteconfig6 --file kwinrc --group Plugins --key wallpaper-transparencyEnabled false
qdbus6 org.kde.KWin /KWin reconfigure
kpackagetool6 -t KWin/Script -r wallpaper-transparency
```

## Current scope

This repository is intentionally focused on KWin behavior. It does not install system packages, replace the compositor, modify applications, or manage game-specific launchers.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
