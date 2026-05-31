import type { MouseEvent, RefObject } from "react";
import { renderTranscriptHtml } from "../renderers/transcript";
import { mergeLinkRel, openInNewTab } from "./utils";

export { buildTranscriptItems, renderTranscriptHtml, type TranscriptItem } from "../renderers/transcript";

export function handleContentLinkClick(event: MouseEvent<HTMLElement>): void {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) {
    return;
  }

  event.preventDefault();
  openInNewTab(link.href);
}

export function openContentLinksInNewTabs(rootRef: RefObject<HTMLElement | null>): void {
  const root = rootRef.current;
  if (!root) {
    return;
  }

  for (const link of root.querySelectorAll("a[href]")) {
    if (!(link instanceof HTMLAnchorElement)) {
      continue;
    }
    link.target = "_blank";
    link.rel = mergeLinkRel(link.rel);
  }
}
