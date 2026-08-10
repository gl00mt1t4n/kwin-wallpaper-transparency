# Wallpaper Transparency

A small Plasma 6 KWin script that owns normal window opacity and lets eligible windows reveal the desktop wallpaper instead of lower application windows.

When an eligible window is focused, the script sets its normal opacity to `96%` by default and lower overlapping eligible windows to opacity `0`. Inactive normal windows use `91%`. Lower windows remain open and in their normal stacking/task-switcher history.

The script maintains suppression state for every virtual desktop and explicitly resynchronizes normal opacity on focus, desktop, geometry, fullscreen, output, activity, and lifecycle changes. Windows marked **On All Desktops** participate in every desktop's stacking calculation, so a focused protected normal window such as Kitty can preserve its own opacity while lower eligible windows are suppressed on each desktop. No global KWin opacity rule is required.

## Safety behavior

The script deliberately does not minimize, hide, reorder, or focus windows. It keeps fullscreen windows and protected application classes opaque, and skips desktop/panel windows, dialogs, popups, and other non-normal windows. By default it protects:

- `kitty`
- classes containing `steam_app`
- `gamescope`

If a protected window overlaps the focused window, the focused window becomes temporarily opaque instead of revealing that protected window. This preserves game and terminal isolation at the cost of the wallpaper effect in that overlap. A focused protected normal window marked **On All Desktops** is the exception: it can lead the wallpaper reveal without the script changing its own opacity.

## Requirements

- KDE Plasma 6 with KWin
- Wayland or X11
- The script's normal opacity settings (default active `96%`, inactive `91%`)

The script owns normal opacity. A global KWin opacity rule should not be enabled alongside it, because that can leave focus-dependent opacity stale. Kitty remains special: its KWin opacity is kept at `100%` so Kitty's own background opacity remains in control.

Focus and desktop changes resynchronize all live normal windows. This prevents a window restored from the hidden-underlap state from retaining the opacity it had while inactive.
Windows marked **On All Desktops** are remembered as the active leader for every virtual desktop while focused. Switching desktops therefore keeps the same wallpaper-only underlap behavior instead of exposing the lower application window through Kitty's own background opacity.

## Install locally

From this repository:

```bash
kpackagetool6 -t KWin/Script -i .
kwriteconfig6 --file kwinrc --group Plugins --key wallpaper-transparencyEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```
When upgrading an already enabled copy, KWin may retain the old JavaScript instance. Toggle **Wallpaper Transparency** off and on in System Settings, or reload it explicitly:

```bash
qdbus6 org.kde.KWin /Scripting unloadScript wallpaper-transparency
qdbus6 org.kde.KWin /Scripting loadScript "$HOME/.local/share/kwin/scripts/wallpaper-transparency/contents/code/main.js" wallpaper-transparency
qdbus6 org.kde.KWin /Scripting start
```

Enable **Wallpaper Transparency** in **System Settings → Window Management → KWin Scripts** if KWin does not enable it automatically.

Configure it from the script's settings button. Protected classes accept comma-separated values:
The settings panel controls active and inactive opacity. Defaults are active `96%` and inactive `91%`.

- `[kitty]` — exact match

- `{steam_app}` — contains match
- `gamescope` — exact match

## Desktop transitions

The script keeps steady-state opacity and suppression synchronized across all virtual desktops. KWin's Slide effect still owns the per-frame desktop animation; exact wallpaper-only painting when a slide is stopped halfway requires a compositor-level effect and is outside this script's window-state API.

## Titlebar actions

KWin adds a **Wallpaper Transparency** submenu under a window's titlebar **More Actions** menu. The actions protect the selected window or its application for the current script session. These protections are intentionally not persisted by the script; use KWin Window Rules or the script configuration for durable exclusions.

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
