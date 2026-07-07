// @ts-nocheck
import { stateUtilsJs } from "./state-utils.mjs";
import { statsGalleryJs } from "./stats-gallery.mjs";
import { searchOverlayJs } from "./search-overlay.mjs";
import { settingsReadingJs } from "./settings-reading.mjs";
import { sessionsSidebarJs } from "./sessions-sidebar.mjs";
import { transcriptLiveTailJs } from "./transcript-live-tail.mjs";
import { sharingActionsJs } from "./sharing-actions.mjs";
import { bindingsShortcutsJs } from "./bindings-shortcuts.mjs";
export function serverJs() {
    return [
        stateUtilsJs,
        statsGalleryJs,
        searchOverlayJs,
        settingsReadingJs,
        sessionsSidebarJs,
        transcriptLiveTailJs,
        sharingActionsJs,
        bindingsShortcutsJs,
    ].join("");
}
