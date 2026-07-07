// @ts-nocheck
import { themeCss } from "./theme.mjs";
import { baseCss } from "./base.mjs";
import { sidebarCss } from "./sidebar.mjs";
import { splitterCss } from "./splitter.mjs";
import { viewerCss } from "./viewer.mjs";
import { transcriptCss } from "./transcript.mjs";
import { overlaysCss } from "./overlays.mjs";
import { designElevationCss } from "./design-elevation.mjs";
import { readingControlsCss } from "./reading-controls.mjs";
export function serverCss() {
    return [
        themeCss,
        baseCss,
        sidebarCss,
        splitterCss,
        viewerCss,
        transcriptCss,
        overlaysCss,
        designElevationCss,
        readingControlsCss,
    ].join("");
}
