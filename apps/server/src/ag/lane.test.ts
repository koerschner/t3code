import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import { applyLane, LANES, type LaneInput, laneVerdict, moveSelection } from "./lane.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const synced = createModelSelection(
  ProviderInstanceId.make("pi"),
  "truefoundry/anthropic-primary/claude-opus-5-5",
  [{ id: "thinking", value: "max" }],
);
const privateGpt = createModelSelection(
  ProviderInstanceId.make("piPrivate"),
  "openrouter/openai/gpt-6-astra",
);
const codex = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-astra");
const message = (overrides: Partial<MessageDispatch> = {}): MessageDispatch => ({
  type: "message.dispatch",
  commandId: CommandId.make("ag-lane-test"),
  threadId: ThreadId.make("ag-lane-thread"),
  messageId: MessageId.make("ag-lane-message"),
  text: "Off the record: what's my balance?",
  attachments: [],
  createdBy: "user",
  creationSource: "web",
  dispatchMode: { type: "start_immediately" },
  ...overrides,
});

it("moves a selection to the other lane's model, keeping its thinking level", () => {
  assert.deepStrictEqual(moveSelection(synced, "private"), {
    instanceId: LANES.private.instanceId,
    model: LANES.private.model,
    options: [{ id: "thinking", value: "max" }],
  });
  assert.deepStrictEqual(moveSelection(privateGpt, "synced"), {
    instanceId: LANES.synced.instanceId,
    model: LANES.synced.model,
  });
});

it("keeps a selection that is already in the lane, or isn't a Pi lane", () => {
  assert.strictEqual(moveSelection(privateGpt, "private"), privateGpt);
  assert.strictEqual(moveSelection(synced, "synced"), synced);
  assert.strictEqual(moveSelection(codex, "private"), codex);
});

it("leaves a message alone when no rule picks a lane", () => {
  const command = message({ modelSelection: synced });
  assert.strictEqual(applyLane(command, synced, undefined), command);
  assert.strictEqual(applyLane(command, synced, "synced"), command);
});

it("moves a message, using the thread's selection when it carries none", () => {
  const routed = applyLane(message(), synced, "private");
  assert.strictEqual(routed.modelSelection?.instanceId, LANES.private.instanceId);
  assert.deepStrictEqual(routed.dispatchMode, { type: "start_immediately" });
});

it("queues instead of steering into a running turn of the other lane", () => {
  const routed = applyLane(
    message({ modelSelection: synced, deliveryIntent: "steer" }),
    undefined,
    "private",
  );
  assert.deepStrictEqual(routed.dispatchMode, { type: "start_immediately" });
  assert.isFalse("deliveryIntent" in routed);
});

it("keeps a deferred launch deferred", () => {
  const dispatchMode = { type: "defer_start" } as const;
  const routed = applyLane(
    message({ modelSelection: privateGpt, dispatchMode }),
    undefined,
    "synced",
  );
  assert.strictEqual(routed.dispatchMode, dispatchMode);
  assert.strictEqual(routed.modelSelection?.instanceId, LANES.synced.instanceId);
});

const input: LaneInput = { text: "hello", source: "web", createdBy: "user", first: true };
const engine = (...rules: Array<(input: LaneInput) => unknown>) => ({
  rulesFor: () => rules,
  loadRule: async (rule: unknown) => rule as (input: LaneInput, ag: unknown) => unknown,
  makeAg: () => ({}),
});

it.effect("combines rule verdicts: private wins, a failing rule has no say", () =>
  Effect.gen(function* () {
    const verdict = (rules: ReturnType<typeof engine> | null) =>
      Effect.promise(() => laneVerdict(input, rules));
    assert.strictEqual(yield* verdict(null), undefined);
    assert.strictEqual(yield* verdict(engine(() => undefined)), undefined);
    assert.strictEqual(yield* verdict(engine(async () => ({ lane: "synced" }))), "synced");
    assert.strictEqual(
      yield* verdict(
        engine(
          async () => ({ lane: "synced" }),
          () => ({ lane: "private" }),
        ),
      ),
      "private",
    );
    assert.strictEqual(
      yield* verdict(
        engine(
          () => {
            throw new Error("broken rule");
          },
          () => ({ lane: "synced" }),
        ),
      ),
      "synced",
    );
  }),
);
