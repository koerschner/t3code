// Quick entry's pure logic (fork, FORK.md): the open payload from the desktop app, and which model a
// quick-entry thread starts on. The UI is ./QuickEntryHost.tsx; the native side is
// apps/desktop/src/ag/QuickEntry.ts.
import type { ModelSelection, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

/** Menu action the desktop app sends to open the box: the prefix, then a JSON QuickEntryOpenPayload. */
export const QUICK_ENTRY_ACTION_PREFIX = "ag.quickEntry:";
/** window.open target name; the desktop app shapes the window it opens by this name. */
export const QUICK_ENTRY_FRAME_NAME = "ag-quick-entry";

export interface QuickEntryShot {
  readonly dataUrl: string;
  readonly appName: string;
  readonly windowTitle: string;
  readonly appIdentifier?: string;
  readonly capturedAt: string;
}

export interface QuickEntryOpenPayload {
  readonly shot: QuickEntryShot | null;
  readonly shotError: string | null;
}

const isString = (value: unknown): value is string => typeof value === "string";

/** The payload of an `ag.quickEntry:` menu action, or null for any other action. */
export function parseQuickEntryAction(action: string): QuickEntryOpenPayload | null {
  if (!action.startsWith(QUICK_ENTRY_ACTION_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(action.slice(QUICK_ENTRY_ACTION_PREFIX.length));
  } catch {
    raw = {};
  }
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const shotRecord =
    typeof record.shot === "object" && record.shot !== null
      ? (record.shot as Record<string, unknown>)
      : null;
  const shot: QuickEntryShot | null =
    shotRecord &&
    isString(shotRecord.dataUrl) &&
    shotRecord.dataUrl.startsWith("data:image/") &&
    isString(shotRecord.appName) &&
    isString(shotRecord.capturedAt)
      ? {
          dataUrl: shotRecord.dataUrl,
          appName: shotRecord.appName,
          windowTitle: isString(shotRecord.windowTitle) ? shotRecord.windowTitle : "",
          ...(isString(shotRecord.appIdentifier)
            ? { appIdentifier: shotRecord.appIdentifier }
            : {}),
          capturedAt: shotRecord.capturedAt,
        }
      : null;
  return { shot, shotError: isString(record.shotError) ? record.shotError : null };
}

export interface QuickEntryModelOption {
  readonly key: string;
  readonly selection: ModelSelection;
  readonly label: string;
}

export const modelKey = (selection: Pick<ModelSelection, "instanceId" | "model">) =>
  `${selection.instanceId}:${selection.model}`;

function modelLabel(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
  slug: string,
): string {
  const model = providers
    .find((provider) => provider.instanceId === instanceId)
    ?.models.find((entry) => entry.slug === slug);
  return model?.shortName ?? model?.name ?? slug.slice(slug.lastIndexOf("/") + 1);
}

/**
 * The models offered as chips, the first selected: the model a new thread would start on (resolved by the
 * caller like T3's new-thread button), then the
 * user's favorites on enabled providers. With neither, the first favorite leads.
 */
export function quickEntryModelOptions(input: {
  readonly favorites: ReadonlyArray<{
    readonly provider: ProviderInstanceId;
    readonly model: string;
  }>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly newThreadDefault: ModelSelection | null;
}): QuickEntryModelOption[] {
  const enabled = new Set(
    input.providers.filter((provider) => provider.enabled).map((provider) => provider.instanceId),
  );
  const options: QuickEntryModelOption[] = [];
  const add = (selection: ModelSelection) => {
    const key = modelKey(selection);
    if (options.some((option) => option.key === key)) return;
    options.push({
      key,
      selection,
      label: modelLabel(input.providers, selection.instanceId, selection.model),
    });
  };
  if (input.newThreadDefault) add(input.newThreadDefault);
  for (const favorite of input.favorites) {
    if (!enabled.has(favorite.provider)) continue;
    add({ instanceId: favorite.provider, model: favorite.model });
  }
  // The same model through two routes (e.g. anthropic/… and truefoundry/anthropic-primary/…) shares a
  // name: tell them apart by the route, the slug's first segment.
  return options.map((option) => {
    const sameLabel = options.filter((other) => other.label === option.label).length > 1;
    const route = option.selection.model.split("/")[0];
    return sameLabel && route && route !== option.selection.model
      ? { ...option, label: `${option.label} · ${route}` }
      : option;
  });
}

/** A thread title from the prompt, like the composer's (first line, trimmed). */
export function quickEntryTitleSeed(text: string, imageCount: number): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine) return firstLine;
  return imageCount > 0 ? "Image" : "New thread";
}
