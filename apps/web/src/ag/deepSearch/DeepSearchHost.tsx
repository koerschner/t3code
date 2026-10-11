// Deep search (fork, FORK.md): ⌥⌘K opens a search by meaning over every open thread and every open Ag
// tab, beside the command palette's word search (⌘K), so the two can be compared. Results come from Ag's
// ag-deepsearch service (DigUp's recipe: EmbeddingGemma 2 on llama.cpp) through /api/ag/deep-search.
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CommandPaletteContent } from "~/components/CommandPaletteContent";
import { CommandDialog, CommandDialogPopup } from "~/components/ui/command";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { buildThreadRouteParams } from "~/threadRoutes";

import { fetchDeepSearch, type DeepSearchResponse, type DeepSearchResult } from "./logic";

const isOpenShortcut = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey && event.code === "KeyK";

export function AgDeepSearchHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOpenShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {open ? (
        <CommandDialogPopup
          aria-label="Deep search"
          className="h-105 overflow-hidden"
          data-testid="ag-deep-search"
          onBackdropPointerDown={() => setOpen(false)}
        >
          <DeepSearchDialog onClose={() => setOpen(false)} />
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}

function DeepSearchDialog(props: { readonly onClose: () => void }) {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const [query, setQuery] = useState("");
  // The answer for one query; anything typed since is still pending.
  const [settled, setSettled] = useState<{
    readonly query: string;
    readonly response: DeepSearchResponse | null;
    readonly error: string | null;
  }>({ query: "", response: null, error: null });
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  const searchable = trimmed.length >= 2;
  const pending = searchable && settled.query !== trimmed;
  const response = searchable ? settled.response : null;
  const error = searchable && !pending ? settled.error : null;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchDeepSearch(trimmed, controller.signal)
        .then((next) => {
          setSettled({ query: trimmed, response: next, error: null });
          setSelected(0);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setSettled({
            query: trimmed,
            response: null,
            error: cause instanceof Error ? cause.message : "Deep search failed.",
          });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, trimmed]);

  const results = response?.results ?? [];

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-deep-search-result="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const openResult = (result: DeepSearchResult) => {
    if (result.kind === "tab") {
      if (result.link) window.open(result.link, "_blank", "noopener");
      props.onClose();
      return;
    }
    if (!environmentId) return;
    props.onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, ThreadId.make(result.id))),
    });
  };

  return (
    <CommandPaletteContent
      aria-label="Deep search"
      footerActionLabel="Open"
      footerTrailing={
        <span className="text-muted-foreground text-xs">
          EmbeddingGemma 2 · {response?.indexed.toLocaleString() ?? "…"} passages
          {response?.progress ? ` · ${response.progress}` : ""}
        </span>
      }
      inputProps={{
        placeholder: "Describe it: open threads and Ag tabs, by meaning",
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" && results.length > 0) {
            event.preventDefault();
            setSelected((current) => (current + 1) % results.length);
          } else if (event.key === "ArrowUp" && results.length > 0) {
            event.preventDefault();
            setSelected((current) => (current - 1 + results.length) % results.length);
          } else if (event.key === "Enter") {
            const result = results[selected];
            if (result && !pending) {
              event.preventDefault();
              openResult(result);
            }
          }
        },
      }}
      mode="none"
      onValueChange={setQuery}
      panelSize="fill"
      testId="ag-deep-search-content"
      value={query}
    >
      {pending || error ? (
        <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <span className="flex items-center gap-2">
              <Spinner size="sm" /> Searching by meaning…
            </span>
          )}
        </div>
      ) : null}
      {results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {response && !pending
            ? "Nothing close. Try describing it differently."
            : "Search what was said, not the title: “where we fixed the consent email loop”."}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="py-2" ref={listRef}>
            {results.map((result, index) => (
              <button
                type="button"
                key={`${result.kind}:${result.id}`}
                data-deep-search-result={index}
                className={cn(
                  "flex w-full min-w-0 items-start gap-2.5 px-3 py-2 text-left hover:bg-accent/60",
                  index === selected && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setSelected(index)}
                onClick={() => openResult(result)}
              >
                {result.kind === "tab" ? (
                  <SquareTerminalIcon className="mt-0.5 size-4 shrink-0 text-icon-muted" />
                ) : (
                  <MessagesSquareIcon className="mt-0.5 size-4 shrink-0 text-icon-muted" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate text-foreground">{result.title}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {result.kind === "tab" ? `Ag tab ${result.tab ?? ""}` : result.project}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-3xs text-muted-foreground/70">
                      {result.score.toFixed(2)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-muted-foreground text-xs">
                    {result.role === "user" ? "You: " : ""}
                    {result.snippet}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </CommandPaletteContent>
  );
}
