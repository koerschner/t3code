// Lanes (fork, FORK.md): before T3 takes a message the user sent, Ag's `lane` rules (ag-rules hook `lane`,
// ~/ag/ag-rules/README.md) can move it to the private Pi lane, `piPrivate`: Nathan's personal OpenRouter
// account, with Pi sessions stored outside Nessie (ag's docs/t3.md, "Two lanes"). His off-the-record rule does
// this when he says "off the record". T3's own lane switch does the rest (a new native session in that lane,
// with the context handoff), so the message never reaches a session that syncs to Nessie. Any failure (no ag
// checkout, a broken rule) leaves the message as it was.
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import {
  type ModelSelection,
  type OrchestrationV2Command,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export const PRIVATE_LANE = ProviderInstanceId.make("piPrivate");
export const PRIVATE_MODEL = "openrouter/anthropic/claude-opus-5.5";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
export type LaneVerdict = { readonly lane?: unknown } | undefined;

// ag-rules' TypeScript engine (Node strips its types). Loaded once; a failed load is retried on the next message.
type AgRules = { runRule: (hook: string, input: unknown) => Promise<unknown> };
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

/** The message moved to the private lane, or unchanged when no rule says so or the thread is already there. */
export function applyLane(
  command: MessageDispatch,
  current: ModelSelection | undefined,
  verdict: LaneVerdict,
): MessageDispatch {
  if (verdict?.lane !== "private") return command;
  const selection = command.modelSelection ?? current;
  if (selection?.instanceId === PRIVATE_LANE) return command;
  const thinking = selection?.options?.filter((option) => option.id === "thinking");
  const { deliveryIntent: _deliveryIntent, ...rest } = command;
  return {
    ...rest,
    modelSelection: createModelSelection(PRIVATE_LANE, PRIVATE_MODEL, thinking),
    // Never steer it into a running synced turn: it waits for that turn, then starts in the private lane.
    dispatchMode:
      command.dispatchMode.type === "defer_start"
        ? command.dispatchMode
        : { type: "start_immediately" },
  };
}

/** Route a message the user sent through the `lane` rules (the hook in ThreadMessageIntake.dispatchCommand). */
export function routeLane<C extends OrchestrationV2Command>(
  command: C,
): Effect.Effect<C, never, ThreadManagement.ThreadManagementService> {
  if (command.type !== "message.dispatch" || command.createdBy !== "user") {
    return Effect.succeed(command);
  }
  const message = command as MessageDispatch;
  return Effect.gen(function* () {
    const verdict = yield* Effect.tryPromise(async () => {
      const rules = await loadAgRules();
      return (await rules?.runRule("lane", {
        text: message.text,
        source: message.creationSource,
      })) as LaneVerdict;
    }).pipe(Effect.orElseSucceed((): LaneVerdict => undefined));
    if (verdict?.lane !== "private") return command;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const current =
      message.modelSelection ??
      (yield* threads.getThreadProjection(message.threadId).pipe(
        Effect.map((projection): ModelSelection | undefined => projection.thread.modelSelection),
        Effect.orElseSucceed((): ModelSelection | undefined => undefined),
      ));
    const routed = applyLane(message, current, verdict);
    if (routed === message) return command;
    yield* Effect.logInfo("ag lane: message moved to the private lane", {
      threadId: message.threadId,
    });
    return routed as C;
  }).pipe(Effect.withSpan("ag.routeLane"));
}
