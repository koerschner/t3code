// Ag fork (FORK.md): vim-style normal mode, app-wide. You're in normal mode whenever no text field, terminal,
// dialog or menu has focus; Esc in the composer drops you into it. Keys:
//   j / k  next / previous session in the sidebar
//   i      insert: focus the prompt
//   e      settle the open session (⌘Z un-settles it and opens it again)
// Works through the DOM (sidebar rows, the composer editor, the row's Settle button), so no upstream file needs
// more than the one import that installs it.

const EDITABLE =
  'input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]';
const FLOATING_LAYER = [
  '[role="dialog"][aria-modal="true"]',
  '[data-slot$="-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sidebar"][data-mobile="true"]:is([data-open],[data-ending-style])',
].join(",");
const TERMINAL = ".xterm,[data-terminal],[data-slot='terminal']";
const COMPOSER = '[data-testid="composer-editor"]';

const asElement = (t: EventTarget | null) =>
  t && typeof (t as Element).closest === "function" ? (t as Element) : null;

export type NormalModeKey = "j" | "k" | "i" | "e";

/** The normal-mode key this event means, or null when it should go where it normally would. */
export function normalModeKey(
  event: KeyboardEvent,
  doc: Document = document,
): NormalModeKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing)
    return null;
  if (event.key !== "j" && event.key !== "k" && event.key !== "i" && event.key !== "e") return null;
  const target = asElement(event.target);
  if (target?.closest(EDITABLE) || target?.closest(TERMINAL)) return null;
  if (doc.activeElement?.closest(EDITABLE) || doc.activeElement?.closest(TERMINAL)) return null;
  if (doc.querySelector(FLOATING_LAYER)) return null;
  return event.key;
}

/** Sidebar session rows in display order, and the index of the open one (-1 if none). */
// The desktop app uses hash history (#/env/thread); the web app uses the path.
export function currentRoutePath(loc: Pick<Location, "hash" | "pathname"> = location): string {
  const fromHash = loc.hash.startsWith("#/") ? loc.hash.slice(1) : "";
  return (fromHash || loc.pathname).split(/[?#]/)[0] ?? "";
}

export function sidebarRows(doc: Document = document, path = currentRoutePath()) {
  const rows = [...doc.querySelectorAll<HTMLElement>("li[data-thread-item]")];
  const active = rows.findIndex((li) => {
    const [env, id] = (li.dataset.threadItem ?? "").split(":");
    return !!id && (path.endsWith(`/${env}/${id}`) || path.endsWith(`/${id}`));
  });
  return { rows, active };
}

function rowButton(li: HTMLElement | undefined) {
  return li?.querySelector<HTMLElement>(':scope [role="button"]') ?? null;
}

function step(direction: 1 | -1) {
  const { rows, active } = sidebarRows();
  if (rows.length === 0) return;
  const next = active < 0 ? (direction > 0 ? 0 : rows.length - 1) : active + direction;
  rowButton(rows[next])?.click();
}

// Normal mode is the default: T3 focuses the prompt by itself whenever a thread opens, which would put every
// keystroke into it. Only a focus you asked for (i, a click or tap in the prompt, or a key you just pressed with
// a modifier, e.g. a shortcut) is allowed to stay; any other focus landing in the prompt is undone.
let insertRequestedAt = 0;
const requestInsert = () => {
  insertRequestedAt = Date.now();
};
const insertWasRequested = () => Date.now() - insertRequestedAt < 400;

function focusPrompt() {
  requestInsert();
  const host = document.querySelector<HTMLElement>(COMPOSER);
  const editor = host?.matches(EDITABLE) ? host : host?.querySelector<HTMLElement>(EDITABLE);
  if (!editor) return;
  editor.focus();
  const selection = getSelection();
  if (selection && editor.isContentEditable) {
    selection.selectAllChildren(editor);
    selection.collapseToEnd();
  }
}

// The last session settled with e, so ⌘Z can bring it back: T3's own undo only lasts 5 seconds and, because
// settling moves you to the next session, leaves you looking at a different one.
let lastSettled: { item: string; at: number } | null = null;
const UNDO_WINDOW_MS = 10 * 60_000;

function settleOpen() {
  const { rows, active } = sidebarRows();
  const row = rows[active];
  const button = row?.querySelector<HTMLButtonElement>('button[aria-label="Settle thread"]');
  if (!row || !button) return;
  lastSettled = { item: row.dataset.threadItem ?? "", at: Date.now() };
  button.click();
}

const rowFor = (item: string) =>
  [...document.querySelectorAll<HTMLElement>("li[data-thread-item]")].find(
    (li) => li.dataset.threadItem === item,
  );

function openRow(item: string, tries = 10) {
  const button = rowButton(rowFor(item));
  if (button) return button.click();
  if (tries > 0) setTimeout(() => openRow(item, tries - 1), 150);
}

/** ⌘Z after e: un-settle that session (T3's undo while its notice is up, else the row's Un-settle) and open it. */
function undoSettle(event: KeyboardEvent): void {
  const last = lastSettled;
  if (!last || Date.now() - last.at > UNDO_WINDOW_MS) return;
  lastSettled = null;
  const notice = [...document.querySelectorAll('[role="status"] button')].some((b) =>
    /undo/i.test(b.textContent ?? ""),
  );
  if (!notice) {
    const unsettle = rowFor(last.item)?.querySelector<HTMLButtonElement>(
      'button[aria-label="Un-settle thread"]',
    );
    if (!unsettle) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    unsettle.click();
  }
  // Either way (T3 handles the key when its notice is up), go back to the session once its row is active again.
  setTimeout(() => openRow(last.item), 250);
}

export const isUndoKey = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === "z";

const ACTIONS: Record<NormalModeKey, () => void> = {
  j: () => step(1),
  k: () => step(-1),
  i: focusPrompt,
  e: settleOpen,
};

let installed = false;
export function installNormalMode(win: Window = window) {
  if (installed) return;
  installed = true;
  // Capture phase, so these keys win over type-to-focus (which would put them into the prompt).
  win.addEventListener(
    "keydown",
    (event) => {
      if (isUndoKey(event) && !event.repeat) {
        const target = asElement(event.target);
        if (!target?.closest(EDITABLE) && !document.activeElement?.closest(EDITABLE))
          undoSettle(event);
        return;
      }
      const key = normalModeKey(event);
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat || key === "j" || key === "k") ACTIONS[key]();
    },
    { capture: true },
  );
  win.addEventListener(
    "pointerdown",
    (event) => {
      if (asElement(event.target)?.closest(COMPOSER)) requestInsert();
    },
    { capture: true },
  );
  win.addEventListener(
    "keydown",
    (event) => {
      // Shortcuts that focus the prompt (modifier chords) and typing into it while already there count as asking.
      // Other printable keys keep T3's type-to-start: they begin a prompt, so they count too.
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length === 1) requestInsert();
    },
    { capture: true },
  );
  win.addEventListener(
    "focusin",
    (event) => {
      const target = asElement(event.target);
      if (!target?.closest(COMPOSER) || insertWasRequested()) return;
      (target as HTMLElement).blur();
    },
    { capture: true },
  );
  // Esc in the prompt leaves insert mode, unless a prompt menu (slash commands, @files, stash) or a popup is open:
  // then Esc closes that first. Decided before any handler runs, because the prompt editor (Lexical) marks every
  // Escape as handled, so defaultPrevented can't tell us whether something used it.
  win.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const target = asElement(event.target);
      if (!target?.closest(COMPOSER) || document.querySelector(FLOATING_LAYER)) return;
      if (document.querySelector("[data-composer-command-drawer]")) return;
      insertRequestedAt = 0; // a refocus right after this Esc must not count as asked for
      setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest(COMPOSER)) active.blur();
      }, 0);
    },
    { capture: true },
  );
}
