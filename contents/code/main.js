/*
 * Wallpaper Transparency
 *
 * Keep normal KWin opacity rules in charge of a window's usual opacity.
 * When an eligible focused window overlaps lower windows, temporarily make
 * those lower windows invisible so the compositor reveals the desktop.
 */

const PREFIX = "wallpaper-transparency:";

const config = {
    overlapThreshold: clamp(Number(readConfig("overlapThreshold", 1)) / 100, 0.01, 1),
    protectedClasses: parsePatterns(String(readConfig(
        "protectedClasses",
        "kitty,{steam_app},gamescope"
    ))),
    barrierMode: Boolean(readConfig("barrierMode", true)),
    debug: Boolean(readConfig("debugLogging", false))
};

const suppressed = new Map();
const opaqueBarriers = new Map();
const watched = new Set();
let changingOpacity = false;

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

function isProtected(window) {
    if (!window) {
        return false;
    }

    if (window.fullScreen) {
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
        && !isProtected(window);
}

function isBarrier(window) {
    if (!isLive(window) || window.desktopWindow || window.dock) {
        return false;
    }

    return isProtected(window) || !window.normalWindow;
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
        firstDesktop.id === secondDesktop.id
    ));
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

function suppress(window) {
    if (!isLive(window) || suppressed.has(window)) {
        return;
    }

    suppressed.set(window, Number(window.opacity));
    setOpacity(window, 0);
    debug("suppressed", window.resourceClass, window.caption);
}

function makeOpaqueBarrier(window) {
    if (!isLive(window) || opaqueBarriers.has(window)) {
        return;
    }

    opaqueBarriers.set(window, Number(window.opacity));
    setOpacity(window, 1);
    debug("opaque barrier", window.resourceClass, window.caption);
}

function restoreAll() {
    for (const [window, opacity] of suppressed) {
        if (isLive(window)) {
            setOpacity(window, opacity);
        }
    }
    suppressed.clear();

    for (const [window, opacity] of opaqueBarriers) {
        if (isLive(window)) {
            setOpacity(window, opacity);
        }
    }
    opaqueBarriers.clear();
}

function isLowerOverlapping(active, candidate, activeIndex, candidateIndex) {
    return candidateIndex < activeIndex
        && isLive(candidate)
        && sharesDesktop(active, candidate)
        && intersectionRatio(active, candidate) >= config.overlapThreshold;
}

function recompute() {
    if (changingOpacity) {
        return;
    }

    restoreAll();

    const active = workspace.activeWindow;
    if (!isEligible(active)) {
        return;
    }

    const stack = workspace.stackingOrder || [];
    const activeIndex = stack.indexOf(active);
    if (activeIndex < 0) {
        return;
    }

    const lower = [];
    for (let index = 0; index < activeIndex; index += 1) {
        const candidate = stack[index];
        if (isLowerOverlapping(active, candidate, activeIndex, index)) {
            lower.push(candidate);
        }
    }

    const barrier = lower.some(isBarrier);
    if (barrier && config.barrierMode) {
        makeOpaqueBarrier(active);
        return;
    }

    lower.filter(isEligible).forEach(suppress);
}

function watch(window) {
    if (!window || watched.has(window)) {
        return;
    }

    watched.add(window);
    window.frameGeometryChanged.connect(recompute);
    window.fullScreenChanged.connect(recompute);
    window.minimizedChanged.connect(recompute);
    window.outputChanged.connect(recompute);
}

function forget(window) {
    suppressed.delete(window);
    opaqueBarriers.delete(window);
    watched.delete(window);
    recompute();
}

workspace.windowList().forEach(watch);
workspace.windowAdded.connect(window => {
    watch(window);
    recompute();
});
workspace.windowRemoved.connect(forget);
workspace.windowActivated.connect(recompute);
workspace.currentDesktopChanged.connect(recompute);
workspace.currentActivityChanged.connect(recompute);
workspace.screensChanged.connect(recompute);

recompute();
