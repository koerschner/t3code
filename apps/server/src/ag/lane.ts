// Lanes (fork, FORK.md): before T3 takes a message, Ag's `lane` rules (ag-rules hook `lane`, ~/ag/ag-rules/README.md)
// can pick the Pi lane it runs in: `piPrivate` (Nathan's personal OpenRouter account, Pi sessions outside Nessie) or
// `pi` (company TrueFoundry models, synced to Nessie); ag's docs/t3.md, "Two lanes". Nathan's rules move a message
// private when he says "off the record", and can decide a new thread's lane from its first message. T3's own lane
// switch does the rest, so the message only ever reaches a session of the chosen lane. Rules run for every message
// the user sends and for the first message of any thread (incl. threads agents launch); when they disagree, private
// wins. Any failure (no ag checkout, a broken or slow rule) leaves the selection as it was.
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import {
  type ModelSelection,
  type OrchestrationV2Command,
  ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import type { ThreadLaunchInput } from "../orchestration-v2/ThreadLaunchService.ts";

export type Lane = "private" | "synced";
/** Each Pi lane's instance and the model a thread gets when it moves there. */
export const LANES = {
  private: {
    instanceId: ProviderInstanceId.make("piPrivate"),
    model: "openrouter/anthropic/claude-opus-5.5",
  },
  synced: {
    instanceId: ProviderInstanceId.make("pi"),
    model: "truefoundry/anthropic-primary/claude-opus-5-5",
  },
} as const;
const RULES_TIMEOUT = Duration.seconds(15);

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
/** What every lane rule gets (ag-rules' `LaneMessage`). */
export interface LaneInput {
  readonly text: string;
  readonly source: string;
  readonly createdBy: string;
  readonly first: boolean;
}

const laneOf = (instanceId: string): Lane | null =>
  instanceId === LANES.private.instanceId
    ? "private"
    : instanceId === LANES.synced.instanceId
      ? "synced"
      : null;

/**
 * The selection moved to `lane`'s default model, keeping its thinking level. Unchanged when it's already in that
 * lane (an explicit model pick survives) or isn't a Pi lane at all (other providers are left alone).
 */
export function moveSelection(selection: ModelSelection | undefined, lane: Lane): ModelSelection {
  if (selection === undefined)
    return createModelSelection(LANES[lane].instanceId, LANES[lane].model);
  const current = laneOf(selection.instanceId);
  if (current === null || current === lane) return selection;
  const thinking = selection.options?.filter((option) => option.id === "thinking");
  return createModelSelection(LANES[lane].instanceId, LANES[lane].model, thinking);
}

/** The message moved to `lane`, or the same command when it's already there (or no rule picked a lane). */
export function applyLane(
  command: MessageDispatch,
  current: ModelSelection | undefined,
  lane: Lane | undefined,
): MessageDispatch {
  if (lane === undefined) return command;
  const selection = command.modelSelection ?? current;
  const moved = moveSelection(selection, lane);
  if (moved === selection) return command;
  const { deliveryIntent: _deliveryIntent, ...rest } = command;
  return {
    ...rest,
    modelSelection: moved,
    // Never steer it into a running turn of the other lane: it waits for that turn, then starts in its own lane.
    dispatchMode:
      command.dispatchMode.type === "defer_start"
        ? command.dispatchMode
        : { type: "start_immediately" },
  };
}

// ag-rules' TypeScript engine (Node strips its types). Loaded once; a failed load is retried on the next message.
type Rule = (input: LaneInput, ag: unknown) => unknown;
type AgRules = {
  rulesFor: (hook: string) => ReadonlyArray<unknown>;
  loadRule: (rule: unknown) => Promise<Rule | null>;
  makeAg: (extra?: Record<string, unknown>) => unknown;
};
let agRules: Promise<AgRules | null> | undefined;
const loadAgRules = () =>
  (agRules ??= import(
    /* @vite-ignore */
    NodeURL.pathToFileURL(`${process.env.AG_DIR || `${NodeOS.homedir()}/ag`}/ag-rules/engine.ts`)
      .href
  ).catch(() => {
    agRules = undefined;
    return null;
  }));

/** Every enabled lane rule's verdict, combined: private wins; synced only when some rule says so and none objects. */
export async function laneVerdict(
  input: LaneInput,
  rules: AgRules | null,
): Promise<Lane | undefined> {
  if (rules === null) return undefined;
  let verdict: Lane | undefined;
  for (const info of rules.rulesFor("lane")) {
    const run = await rules.loadRule(info);
    if (run === null) continue;
    try {
      const out = (await run(input, rules.makeAg())) as { readonly lane?: unknown } | undefined;
      if (out?.lane === "private") return "private";
      if (out?.lane === "synced") verdict = "synced";
    } catch {
      // A failing rule has no say.
    }
  }
  return verdict;
}

const decide = (input: LaneInput) =>
  Effect.tryPromise(async () => laneVerdict(input, await loadAgRules())).pipe(
    Effect.timeoutOption(RULES_TIMEOUT),
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed((): Lane | undefined => undefined),
  );

const isFirstMessage = (
  threads: ThreadManagement.ThreadManagementServiceShape,
  threadId: ThreadId,
) =>
  threads.getMessageCount(threadId).pipe(
    Effect.map((count) => count === 0),
    Effect.orElseSucceed(() => false),
  );

/** Route a message through the `lane` rules (the hook in ThreadMessageIntake.dispatchCommand). */
export function routeLane<C extends OrchestrationV2Command>(
  command: C,
): Effect.Effect<C, never, ThreadManagement.ThreadManagementService> {
  if (command.type !== "message.dispatch") return Effect.succeed(command);
  const message = command as MessageDispatch;
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const first = yield* isFirstMessage(threads, message.threadId);
    if (!first && message.createdBy !== "user") return command;
    const lane = yield* decide({
      text: message.text,
      source: message.creationSource,
      createdBy: message.createdBy,
      first,
    });
    if (lane === undefined) return command;
    const current =
      message.modelSelection ??
      (yield* threads.getThreadProjection(message.threadId).pipe(
        Effect.map((projection): ModelSelection | undefined => projection.thread.modelSelection),
        Effect.orElseSucceed((): ModelSelection | undefined => undefined),
      ));
    const routed = applyLane(message, current, lane);
    if (routed === message) return command;
    yield* Effect.logInfo(`ag lane: message moved to the ${lane} lane`, {
      threadId: message.threadId,
    });
    return routed as C;
  }).pipe(Effect.withSpan("ag.routeLane"));
}

/** Route a launch's first message through the `lane` rules (the hook in ThreadMessageIntake.launchThread). */
export function routeLaunch(
  input: ThreadLaunchInput,
): Effect.Effect<ThreadLaunchInput, never, ThreadManagement.ThreadManagementService> {
  const initial = input.initialMessage;
  if (initial === undefined) return Effect.succeed(input);
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const first =
      input.reuseExistingThread !== true || input.threadId === undefined
        ? true
        : yield* isFirstMessage(threads, input.threadId);
    if (!first && input.createdBy !== "user") return input;
    const lane = yield* decide({
      text: initial.text,
      source: input.creationSource,
      createdBy: input.createdBy,
      first,
    });
    if (lane === undefined) return input;
    const moved = moveSelection(input.modelSelection, lane);
    if (moved === input.modelSelection) return input;
    yield* Effect.logInfo(`ag lane: new thread starts in the ${lane} lane`, {
      threadId: input.threadId,
    });
    return { ...input, modelSelection: moved };
  }).pipe(Effect.withSpan("ag.routeLaunch"));
}
