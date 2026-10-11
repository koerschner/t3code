// The quick entry popup's document (fork, FORK.md). The box is a window.open popup drawn by this React app
// through a portal, so it shares T3's stores and environment connection. The popup starts as about:blank:
// this gives it T3's stylesheets and keeps its root element's theme classes, CSS variables (fonts,
// contrast, glass) and attributes in step with the main window's.
import { QUICK_ENTRY_FRAME_NAME } from "./logic";

const MIRRORED = "data-ag-mirrored";

function mirrorHead(source: Document, target: Document) {
  for (const node of target.head.querySelectorAll(`[${MIRRORED}]`)) node.remove();
  for (const node of source.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const clone = target.importNode(node, true) as HTMLElement;
    // about:blank resolves relative URLs against itself; pin stylesheets to their real address.
    if (clone instanceof target.defaultView!.HTMLLinkElement) {
      clone.href = (node as HTMLLinkElement).href;
    }
    clone.setAttribute(MIRRORED, "");
    target.head.append(clone);
  }
}

function mirrorAttributes(source: Element, target: Element) {
  // Copied first: removing attributes while iterating the live map would skip some.
  for (const { name } of Array.from(target.attributes)) {
    if (!source.hasAttribute(name)) target.removeAttribute(name);
  }
  for (const { name, value } of source.attributes) {
    if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  }
}

export interface QuickEntryPopup {
  readonly window: Window;
  readonly container: HTMLElement;
  readonly dispose: () => void;
}

/** Opens (or adopts) the popup and prepares its document. Null if the window could not be opened. */
export function openQuickEntryPopup(): QuickEntryPopup | null {
  const popup = window.open("about:blank", QUICK_ENTRY_FRAME_NAME, "popup,width=760,height=168");
  if (!popup) return null;
  const doc = popup.document;
  doc.title = "Quick entry";
  const sync = () => {
    mirrorHead(document, doc);
    mirrorAttributes(document.documentElement, doc.documentElement);
    doc.body.className = document.body.className;
  };
  sync();
  const base = doc.createElement("style");
  base.textContent =
    "html, body { background: transparent !important; margin: 0; overflow: hidden; height: auto; min-height: 0; }";
  doc.head.append(base);
  doc.body.replaceChildren();
  const container = doc.createElement("div");
  doc.body.append(container);

  const headObserver = new MutationObserver(() => mirrorHead(document, doc));
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  const rootObserver = new MutationObserver(() => {
    mirrorAttributes(document.documentElement, doc.documentElement);
    doc.body.className = document.body.className;
  });
  rootObserver.observe(document.documentElement, { attributes: true });
  rootObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  return {
    window: popup,
    container,
    dispose: () => {
      headObserver.disconnect();
      rootObserver.disconnect();
    },
  };
}
