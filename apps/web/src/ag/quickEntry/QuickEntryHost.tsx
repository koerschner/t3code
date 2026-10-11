// Quick entry (fork, FORK.md): the floating box the desktop app opens when both Command keys are pressed
// anywhere (with Shift, a screenshot of the window you were in comes attached). Type and press Enter: a new
// thread starts in the background and the box gets out of the way, leaving you in the app you were in.
//
// The box is a popup window this React tree renders into through a portal (./popupDocument.ts), so it uses
// T3's components, theme, stores and the existing environment connection. The desktop app makes the popup
// a floating, non-activating panel and drives it (apps/desktop/src/ag/QuickEntry.ts).
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { truncate } from "@t3tools/shared/String";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { ImageIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Kbd } from "~/components/ui/kbd";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadActions } from "~/hooks/useThreadActions";
import { cn, newMessageId, newThreadId } from "~/lib/utils";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useProjects } from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import {
  modelKey,
  parseQuickEntryAction,
  quickEntryModelOptions,
  quickEntryTitleSeed,
  type QuickEntryShot,
} from "./logic";
import { openQuickEntryPopup, type QuickEntryPopup } from "./popupDocument";

type DesktopMessage =
  | { type: "ready" }
  | { type: "resize"; height: number }
  | { type: "show" }
  | { type: "hide" }
  | { type: "reveal-main" };

const agDesktop = (globalThis as { agDesktop?: { quickEntry: (message: DesktopMessage) => void } })
  .agDesktop;

interface DraftImage {
  readonly id: string;
  readonly dataUrl: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly shot?: QuickEntryShot;
}

interface Draft {
  readonly text: string;
  readonly images: ReadonlyArray<DraftImage>;
}

const EMPTY_DRAFT: Draft = { text: "", images: [] };

type SendIntent = "send" | "pin" | "open";

/**
 * The server keeps only an attachment's name (not its SnapShot source), so the name says what was
 * captured: "Screenshot of Safari — Page title.png".
 */
function screenshotName(shot: QuickEntryShot): string {
  const what = shot.windowTitle ? `${shot.appName} — ${shot.windowTitle}` : shot.appName;
  return `Screenshot of ${what.replaceAll(/[/\\:]/g, "-").slice(0, 200)}.png`;
}

/** Decoded size of a base64 data URL (the server checks it against the payload exactly). */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

/** Mounted once in the root route; renders nothing outside the desktop app. */
export function AgQuickEntryHost() {
  if (!agDesktop || !window.desktopBridge) return null;
  return <QuickEntryHost />;
}

function QuickEntryHost() {
  const [popup, setPopup] = useState<QuickEntryPopup | null>(null);
  const popupRef = useRef<QuickEntryPopup | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);

  const navigate = useNavigate();
  const { defaultProjectRef } = useHandleNewThread();
  const projects = useProjects();
  const project = defaultProjectRef
    ? (projects.find(
        (candidate) =>
          candidate.id === defaultProjectRef.projectId &&
          candidate.environmentId === defaultProjectRef.environmentId,
      ) ?? null)
    : null;
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const serverConfig = project ? (serverConfigs.get(project.environmentId) ?? null) : null;
  const favorites = useClientSettings((settings) => settings.favorites);
  const stickySelection = useComposerDraftStore((store) =>
    store.stickyActiveProvider
      ? (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null)
      : null,
  );
  const projectSettings = useMemo(
    () =>
      resolveProjectSettings(
        serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
        project?.id ?? null,
        project,
      ).settings,
    [project, serverConfig],
  );
  const modelOptions = useMemo(
    () =>
      quickEntryModelOptions({
        favorites,
        providers: serverConfig?.providers ?? [],
        newThreadDefault: projectSettings.defaultModelSelection ?? stickySelection,
      }),
    [favorites, projectSettings.defaultModelSelection, serverConfig, stickySelection],
  );
  const selectedModel =
    modelOptions.find((option) => option.key === selectedModelKey) ?? modelOptions[0] ?? null;

  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const { pinThread } = useThreadActions();

  const open = useCallback((shot: QuickEntryShot | null, shotError: string | null) => {
    let current = popupRef.current;
    if (!current || current.window.closed) {
      current?.dispose();
      current = openQuickEntryPopup();
      popupRef.current = current;
      setPopup(current);
    }
    if (shot) {
      setDraft((previous) => ({
        ...previous,
        // A new screenshot replaces an unsent one; pasted images stay.
        images: [
          ...previous.images.filter((image) => !image.shot),
          {
            id: newMessageId(),
            dataUrl: shot.dataUrl,
            name: screenshotName(shot),
            mimeType: "image/png",
            sizeBytes: dataUrlBytes(shot.dataUrl),
            shot,
          },
        ],
      }));
    }
    setNotice(shotError);
    setSelectedModelKey(null);
    setOpenCount((count) => count + 1);
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      const payload = parseQuickEntryAction(action);
      if (payload) open(payload.shot, payload.shotError);
    });
    agDesktop?.quickEntry({ type: "ready" });
    return () => unsubscribe?.();
  }, [open]);

  useEffect(
    () => () => {
      popupRef.current?.dispose();
    },
    [],
  );

  const hide = useCallback(() => agDesktop?.quickEntry({ type: "hide" }), []);

  const send = useCallback(
    async (intent: SendIntent) => {
      const text = draft.text.trim();
      if (!text && draft.images.length === 0) return;
      if (!project || !selectedModel) {
        setNotice(project ? "No model to start the thread on." : "Add a project in T3 Code first.");
        return;
      }
      const sent = draft;
      const selection: ModelSelection =
        stickySelection && modelKey(stickySelection) === selectedModel.key
          ? stickySelection
          : selectedModel.selection;
      setDraft(EMPTY_DRAFT);
      setNotice(null);
      hide();

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const title = truncate(quickEntryTitleSeed(text, sent.images.length));
      const attachments: UploadChatImageAttachment[] = sent.images.map((image) => ({
        type: "image",
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: image.dataUrl,
        ...(image.shot
          ? {
              source: {
                kind: "snap-shot" as const,
                capturedAt: image.shot.capturedAt,
                appName: image.shot.appName,
                windowTitle: image.shot.windowTitle,
                ...(image.shot.appIdentifier ? { appIdentifier: image.shot.appIdentifier } : {}),
              },
            }
          : {}),
      })) as UploadChatImageAttachment[];
      const runtimeMode = projectSettings.defaultRuntimeMode;
      const result = await startThreadTurn({
        environmentId: project.environmentId,
        input: {
          threadId,
          message: { messageId: newMessageId(), role: "user", text, attachments },
          modelSelection: selection,
          titleSeed: title,
          runtimeMode,
          interactionMode: "default",
          bootstrap: {
            createThread: {
              projectId: project.id,
              title,
              modelSelection: selection,
              runtimeMode,
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        // Hand the prompt back rather than lose it.
        setDraft((current) => (current.text || current.images.length ? current : sent));
        setNotice(
          `Couldn't start the thread: ${error instanceof Error ? error.message : String(error)}`,
        );
        agDesktop?.quickEntry({ type: "show" });
        return;
      }
      useComposerDraftStore.getState().setStickyModelSelection(selection);
      const threadRef = scopeThreadRef(project.environmentId, threadId);
      if (intent === "pin") void pinThread(threadRef);
      if (intent === "open") {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        });
        agDesktop?.quickEntry({ type: "reveal-main" });
      }
    },
    [
      draft,
      hide,
      navigate,
      pinThread,
      project,
      projectSettings.defaultRuntimeMode,
      selectedModel,
      startThreadTurn,
      stickySelection,
    ],
  );

  if (!popup) return null;
  return createPortal(
    <QuickEntryPanel
      popupWindow={popup.window}
      openCount={openCount}
      draft={draft}
      onDraftChange={setDraft}
      notice={notice}
      projectTitle={project?.title ?? null}
      modelOptions={modelOptions}
      selectedModelKey={selectedModel?.key ?? null}
      onSelectModel={setSelectedModelKey}
      onSend={send}
      onClose={hide}
    />,
    popup.container,
  );
}

function QuickEntryPanel(props: {
  readonly popupWindow: Window;
  readonly openCount: number;
  readonly draft: Draft;
  readonly onDraftChange: (update: (previous: Draft) => Draft) => void;
  readonly notice: string | null;
  readonly projectTitle: string | null;
  readonly modelOptions: ReadonlyArray<{ key: string; label: string }>;
  readonly selectedModelKey: string | null;
  readonly onSelectModel: (key: string) => void;
  readonly onSend: (intent: SendIntent) => void;
  readonly onClose: () => void;
}) {
  const { popupWindow, openCount, draft, onDraftChange, modelOptions, selectedModelKey } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Each open: the cursor goes to the end of the prompt.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || openCount === 0) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [openCount]);

  // The window follows the card's height. The popup's own ResizeObserver: the main window's would report
  // on the main window's frames, which stop while it is hidden.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const report = () =>
      agDesktop?.quickEntry({ type: "resize", height: Math.ceil(card.offsetHeight) });
    const PopupResizeObserver = (popupWindow as Window & typeof globalThis).ResizeObserver;
    const observer = new PopupResizeObserver(report);
    observer.observe(card);
    report();
    return () => observer.disconnect();
  }, [popupWindow]);

  const cycleModel = (step: number) => {
    if (modelOptions.length < 2) return;
    const index = modelOptions.findIndex((option) => option.key === selectedModelKey);
    const next = modelOptions[(index + step + modelOptions.length) % modelOptions.length];
    if (next) props.onSelectModel(next.key);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      cycleModel(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      props.onSend(event.metaKey ? "pin" : event.altKey ? "open" : "send");
    }
  };

  const onPaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    const images = await Promise.all(
      files.map(async (file) => ({
        id: newMessageId(),
        dataUrl: await readFileAsDataUrl(file),
        name: file.name || "pasted.png",
        mimeType: file.type,
        sizeBytes: file.size,
      })),
    );
    onDraftChange((previous) => ({ ...previous, images: [...previous.images, ...images] }));
  };

  const removeImage = (id: string) => {
    onDraftChange((previous) => ({
      ...previous,
      images: previous.images.filter((image) => image.id !== id),
    }));
    textareaRef.current?.focus();
  };

  return (
    <div
      ref={cardRef}
      className="flex flex-col gap-3 overflow-hidden rounded-3xl border border-border bg-popover px-4 pt-3.5 pb-2.5 font-sans text-popover-foreground"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft.text}
        placeholder="Start a new thread…"
        onChange={(event) => {
          const text = event.target.value;
          onDraftChange((previous) => ({ ...previous, text }));
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => void onPaste(event)}
        className="field-sizing-content max-h-[22rem] min-h-7 w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground/70"
        style={{ fontSize: "calc(var(--font-size-prompt, 14px) + 3px)" }}
      />
      {draft.images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {draft.images.map((image) => (
            <div
              key={image.id}
              className="group relative flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-1 pr-2"
            >
              <img src={image.dataUrl} alt="" className="h-14 max-w-40 rounded-lg object-cover" />
              <div className="flex min-w-0 max-w-48 flex-col text-xs leading-tight">
                <span className="truncate font-medium text-foreground">
                  {image.shot ? image.shot.appName : "Image"}
                </span>
                <span className="truncate text-muted-foreground">
                  {image.shot ? image.shot.windowTitle || "Screenshot" : image.name}
                </span>
              </div>
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => removeImage(image.id)}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {props.notice ? <p className="text-destructive-foreground text-xs">{props.notice}</p> : null}
      <div className="-mx-4 flex items-center gap-1.5 border-border/70 border-t px-3 pt-2 text-muted-foreground text-xs">
        {modelOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelectModel(option.key)}
            className={cn(
              "rounded-full border px-2 py-0.5 transition-colors",
              option.key === selectedModelKey
                ? "border-border bg-accent text-accent-foreground"
                : "border-transparent hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
        {props.projectTitle ? (
          <span className="ml-1 truncate text-muted-foreground/70">in {props.projectTitle}</span>
        ) : null}
        <span className="flex-1" />
        {draft.images.length === 0 ? (
          <span className="hidden items-center gap-1 sm:flex">
            <ImageIcon className="size-3" />
            <Kbd>⌘V</Kbd>
          </span>
        ) : null}
        <span className="flex items-center gap-1">
          <Kbd>↩</Kbd>
          Send
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌘↩</Kbd>
          Pin
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌥↩</Kbd>
          Open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
        </span>
      </div>
    </div>
  );
}
