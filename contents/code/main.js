/*
 * Wallpaper Transparency
 *
 * The script owns normal window opacity. When an eligible focused window
 * overlaps lower windows, temporarily make those lower windows invisible so
 * the compositor reveals the desktop.
 */

const PREFIX = "wallpaper-transparency:";

const config = {
    activeOpacity: clamp(Number(readConfig("activeOpacity", 91)) / 100, 0.1, 1),
    inactiveOpacity: clamp(Number(readConfig("inactiveOpacity", 91)) / 100, 0.1, 1),
    overlapThreshold: clamp(Number(readConfig("overlapThreshold", 1)) / 100, 0.01, 1),
    protectedClasses: parsePatterns(String(readConfig(
        "protectedClasses",
        "kitty,{steam_app},gamescope"
    ))),
    barrierMode: Boolean(readConfig("barrierMode", true)),
    debug: Boolean(readConfig("debugLogging", false))
};

// A window can belong to more than one visible desktop during KWin's slide
// animation. Each override therefore records the desktop that requested it.
const overrides = new Map();
const watched = new Set();
const lastActiveByDesktop = new Map();
const desktopObjects = new Map();
let visibleDesktopKeys = new Set();
let changingOpacity = false;
let lastDesktop = null;
const manuallyProtectedWindows = new Set();
const manuallyProtectedApplications = new Set();

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function debug(...values) {
    if (config.debug) {
        print(PREFIX, ...values);
    }
}

function parsePatterns(raw) {
    return raw
        .split(",")
        .map(token => token.trim().toLowerCase())
        .filter(token => token.length > 0)
        .map(token => {
            if (token.startsWith("{") && token.endsWith("}")) {
                return { contains: token.slice(1, -1).trim() };
            }
            if (token.startsWith("[") && token.endsWith("]")) {
                return { exact: token.slice(1, -1).trim() };
            }
            return { exact: token };
        })
        .filter(pattern => (pattern.exact || pattern.contains).length > 0);
}

function isLive(window) {
    return Boolean(window) && !window.deleted && !window.minimized && !window.hidden;
}

function windowNames(window) {
    return [
        window.resourceClass,
        window.resourceName,
        window.desktopFileName
    ]
        .map(value => String(value || "").toLowerCase())
        .filter(value => value.length > 0);
}

function applicationKey(window) {
    return windowNames(window)[0] || "";
}

function windowKey(window) {
    if (window && window.internalId) {
        return String(window.internalId);
    }
    return `${applicationKey(window)}|${String(window && window.caption || "")}`;
}

function isManuallyProtected(window) {
    return manuallyProtectedWindows.has(windowKey(window))
        || manuallyProtectedApplications.has(applicationKey(window));
}

function toggleProtection(set, key) {
    if (!key) {
        return;
    }
    if (set.has(key)) {
        set.delete(key);
    } else {
        set.add(key);
    }
    recomputeVisibleDesktops();
}

registerUserActionsMenu(function(window) {
    if (!window || !window.normalWindow) {
        return null;
    }

    const application = applicationKey(window);
    const identity = windowKey(window);
    return {
        title: "Wallpaper Transparency",
        items: [
            {
                title: "Protect this window for this session",
                checkable: true,
                checked: manuallyProtectedWindows.has(identity),
                triggered: function() {
                    toggleProtection(manuallyProtectedWindows, identity);
                }
            },
            {
                title: "Protect this application for this session",
                checkable: true,
                checked: manuallyProtectedApplications.has(application),
                triggered: function() {
                    toggleProtection(manuallyProtectedApplications, application);
                }
            }
        ]
    };
});

function isProtected(window) {
    if (!window) {
        return false;
    }

    if (window.fullScreen || isManuallyProtected(window)) {
        return true;
    }

    const names = windowNames(window);
    return config.protectedClasses.some(pattern => names.some(name => {
        if (pattern.contains) {
            return name.indexOf(pattern.contains) !== -1;
        }
        return name === pattern.exact;
    }));
}


function isEligible(window) {
    return isLive(window)
        && window.normalWindow
        && !window.specialWindow
        && !window.fullScreen
        && !window.onAllDesktops
        && !isProtected(window);
}

function isBarrier(window) {
    if (!isLive(window) || window.desktopWindow || window.dock) {
        return false;
    }
    // onAllDesktops protected windows are suppressed, not barriers.
    if (window.onAllDesktops && isProtected(window)) {
        return false;
    }
    return isProtected(window) || window.onAllDesktops || !window.normalWindow;
}

function desktopKey(desktop) {
    if (!desktop) {
        return "";
    }
    return String(desktop.id || desktop.x11DesktopNumber || "");
}

function rememberDesktop(desktop) {
    const key = desktopKey(desktop);
    if (key) {
        desktopObjects.set(key, desktop);
    }
    return key;
}

function windowOnDesktop(window, key) {
    if (!window) {
        return false;
    }
    if (window.onAllDesktops) {
        return true;
    }
    return (window.desktops || []).some(desktop => desktopKey(desktop) === key);
}

function rememberActive(window) {
    if (!window) {
        return;
    }
    if (window.onAllDesktops) {
        // Only remember on the current desktop, not all desktops.
        const current = workspace.currentDesktop;
        const key = rememberDesktop(current);
        if (key) {
            lastActiveByDesktop.set(key, window);
        }
        return;
    }
    (window.desktops || []).forEach(desktop => {
        const key = rememberDesktop(desktop);
        if (key) {
            lastActiveByDesktop.set(key, window);
        }
    });
}

function intersectionRatio(top, lower) {
    const left = Math.max(top.x, lower.x);
    const topEdge = Math.max(top.y, lower.y);
    const right = Math.min(top.x + top.width, lower.x + lower.width);
    const bottom = Math.min(top.y + top.height, lower.y + lower.height);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - topEdge);
    const lowerArea = lower.width * lower.height;

    if (lowerArea <= 0) {
        return 0;
    }

    return (width * height) / lowerArea;
}

function setOpacity(window, opacity) {
    if (!isLive(window) || typeof window.opacity === "undefined") {
        return;
    }

    if (Math.abs(Number(window.opacity) - opacity) < 0.001) {
        return;
    }

    changingOpacity = true;
    window.opacity = opacity;
    changingOpacity = false;
}

function normalOpacity(window) {
    if (!isLive(window) || !window.normalWindow) {
        return null;
    }
    if (window.fullScreen || isProtected(window)) {
        return 1;
    }
    return window === workspace.activeWindow
        ? config.activeOpacity
        : config.inactiveOpacity;
}

function restoreNormalOpacity(window) {
    const opacity = normalOpacity(window);
    if (opacity !== null) {
        setOpacity(window, opacity);
    }
}

function syncNormalOpacity() {
    workspace.windowList().forEach(window => {
        if (!overrides.has(window)) {
            restoreNormalOpacity(window);
        }
    });
}

function applyOverride(window, key, mode) {
    if (!isLive(window)) {
        return;
    }

    let record = overrides.get(window);
    if (!record) {
        record = { owners: new Map() };
        overrides.set(window, record);
    }

    record.owners.set(key, mode);
    const hasBarrier = Array.from(record.owners.values()).some(value => value === "barrier");
    setOpacity(window, hasBarrier ? 1 : 0);
    debug(mode, window.resourceClass, window.caption, "desktop", key);
}

function releaseOverride(window, key) {
    const record = overrides.get(window);
    if (!record) {
        return;
    }

    record.owners.delete(key);
    if (record.owners.size === 0) {
        restoreNormalOpacity(window);
        overrides.delete(window);
        return;
    }

    const hasBarrier = Array.from(record.owners.values()).some(value => value === "barrier");
    setOpacity(window, hasBarrier ? 1 : 0);
}

function releaseDesktop(key) {
    for (const [window, record] of overrides) {
        if (record.owners.has(key)) {
            releaseOverride(window, key);
        }
    }
}

function releaseAllOverrides() {
    for (const window of overrides.keys()) {
        restoreNormalOpacity(window);
    }
    overrides.clear();
}


function releaseWindow(window) {
    const record = overrides.get(window);
    if (record) {
        overrides.delete(window);
    }
    for (const [key, active] of lastActiveByDesktop) {
        if (active === window) {
            lastActiveByDesktop.delete(key);
        }
    }
}

function sharesDesktop(first, second) {
    if (!first || !second || first.onAllDesktops || second.onAllDesktops) {
        return true;
    }

    const firstDesktops = first.desktops || [];
    const secondDesktops = second.desktops || [];

    if (firstDesktops.length === 0 || secondDesktops.length === 0) {
        return true;
    }

    return firstDesktops.some(firstDesktop => secondDesktops.some(secondDesktop =>
        desktopKey(firstDesktop) === desktopKey(secondDesktop)
    ));
}

function leaderForDesktop(desktop, key, stack) {
    const remembered = lastActiveByDesktop.get(key);
    if (isLive(remembered) && windowOnDesktop(remembered, key)) {
        return remembered;
    }

    for (let index = stack.length - 1; index >= 0; index -= 1) {
        const candidate = stack[index];
        if (isLive(candidate) && windowOnDesktop(candidate, key)) {
            return candidate;
        }
    }

    return null;
}

function lowerWindowsFor(leader, key, stack) {
    const leaderIndex = stack.indexOf(leader);
    if (leaderIndex < 0) {
        return [];
    }

    const lower = [];
    for (let index = 0; index < leaderIndex; index += 1) {
        const candidate = stack[index];
        if (!isLive(candidate)
            || !windowOnDesktop(candidate, key)
            || !sharesDesktop(leader, candidate)
            || intersectionRatio(leader, candidate) < config.overlapThreshold) {
            continue;
        }
        lower.push(candidate);
    }
    return lower;
}

function recomputeDesktop(desktop, key) {
    if (!desktop || !key) {
        return;
    }

    releaseDesktop(key);

    const stack = workspace.stackingOrder || [];
    const leader = leaderForDesktop(desktop, key, stack);
    if (!isEligible(leader)) {
        // Active window is a protected all-desktops window (e.g. pinned Kitty):
        // suppress all eligible and onAllDesktops-protected windows so only
        // wallpaper shows through.
        const active = workspace.activeWindow;
        if (active && active.onAllDesktops && isProtected(active) && isLive(active)) {
            stack.forEach(w => {
                if (w === active) return;
                if (isEligible(w) && windowOnDesktop(w, key)) {
                    applyOverride(w, key, "hidden");
                }
            });
        }
        return;
    }

    // Suppress onAllDesktops protected windows below the leader
    // so wallpaper shows through the leader, not pinned terminals.
    const lower = lowerWindowsFor(leader, key, stack);
    lower.forEach(w => {
        if (w.onAllDesktops && isProtected(w) && w !== workspace.activeWindow) {
            applyOverride(w, key, "hidden");
        }
    });

    if (config.barrierMode && lower.some(isBarrier)) {
        applyOverride(leader, key, "barrier");
        return;
    }
    lower.filter(isEligible).forEach(window => applyOverride(window, key, "hidden"));
}

function allDesktops() {
    const desktops = workspace.desktops || [];
    return desktops.length > 0 ? desktops : [workspace.currentDesktop];
}

function recomputeVisibleDesktops() {
    if (changingOpacity) {
        return;
    }

    releaseAllOverrides();
    setVisibleDesktops(allDesktops());
    syncNormalOpacity();
    for (const key of visibleDesktopKeys) {
        recomputeDesktop(desktopObjects.get(key), key);
    }
}

function setVisibleDesktops(desktops) {
    const next = new Set(desktops.map(rememberDesktop).filter(key => key));
    for (const key of visibleDesktopKeys) {
        if (!next.has(key)) {
            releaseDesktop(key);
        }
    }
    visibleDesktopKeys = next;
}

function onDesktopChanged(previous, current) {
    const previousKey = rememberDesktop(previous || lastDesktop);
    const currentKey = rememberDesktop(current || workspace.currentDesktop);
    lastDesktop = current || workspace.currentDesktop;

    if (previousKey) {
        desktopObjects.set(previousKey, previous || desktopObjects.get(previousKey));
    }
    if (currentKey) {
        desktopObjects.set(currentKey, current || desktopObjects.get(currentKey));
    }
    rememberActive(workspace.activeWindow);
    recomputeVisibleDesktops();
}

function watch(window) {
    if (!window || watched.has(window)) {
        return;
    }

    watched.add(window);
    window.frameGeometryChanged.connect(recomputeVisibleDesktops);
    window.fullScreenChanged.connect(recomputeVisibleDesktops);
    window.minimizedChanged.connect(recomputeVisibleDesktops);
    window.outputChanged.connect(recomputeVisibleDesktops);
    if (window.desktopsChanged) {
        window.desktopsChanged.connect(recomputeVisibleDesktops);
    }
}

function forget(window) {
    releaseWindow(window);
    watched.delete(window);
    recomputeVisibleDesktops();
}

lastDesktop = workspace.currentDesktop;
rememberDesktop(lastDesktop);
setVisibleDesktops(allDesktops());
rememberActive(workspace.activeWindow);
workspace.windowList().forEach(watch);
workspace.windowAdded.connect(window => {
    watch(window);
    recomputeVisibleDesktops();
    // Deferred recompute: Wayland windows may not be fully composited yet.
    var timer = new QTimer();
    timer.interval = 150;
    timer.singleShot = true;
    timer.timeout.connect(() => {
        recomputeVisibleDesktops();
        timer.destroy();
    });
    timer.start();
});
workspace.windowRemoved.connect(forget);
workspace.windowActivated.connect(window => {
    rememberActive(window);
    recomputeVisibleDesktops();
});
workspace.currentDesktopChanged.connect(onDesktopChanged);
workspace.currentActivityChanged.connect(recomputeVisibleDesktops);
workspace.desktopsChanged.connect(recomputeVisibleDesktops);
workspace.screensChanged.connect(recomputeVisibleDesktops);

recomputeVisibleDesktops();
