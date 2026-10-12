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

import {
  applyLane,
  DEFAULT_MODEL,
  LANES,
  type LaneInput,
  laneVerdict,
  moveSelection,
} from "./lane.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const synced = createModelSelection(
  ProviderInstanceId.make("pi"),
  "truefoundry/anthropic-primary/claude-opus-5-5",
  [{ id: "thinking", value: "max" }],
);
const syncedGpt = createModelSelection(
  ProviderInstanceId.make("pi"),
  "truefoundry-openai/gpt-6-astra",
  [{ id: "reasoningEffort", value: "high" }],
);
const privateGpt = createModelSelection(
  ProviderInstanceId.make("piPrivate"),
  "truefoundry-openai/gpt-6-astra",
);
const privateOpenRouter = createModelSelection(
  ProviderInstanceId.make("piPrivate"),
  "openrouter/anthropic/claude-opus-5.5",
  [{ id: "thinking", value: "high" }],
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

it("moves a selection to the other lane, keeping its TrueFoundry model and options", () => {
  assert.deepStrictEqual(moveSelection(synced, "private"), {
    instanceId: LANES.private,
    model: synced.model,
    options: [{ id: "thinking", value: "max" }],
  });
  assert.deepStrictEqual(moveSelection(syncedGpt, "private"), {
    instanceId: LANES.private,
    model: "truefoundry-openai/gpt-6-astra",
    options: [{ id: "reasoningEffort", value: "high" }],
  });
  assert.deepStrictEqual(moveSelection(privateGpt, "synced"), {
    instanceId: LANES.synced,
    model: "truefoundry-openai/gpt-6-astra",
  });
});

it("replaces a model outside TrueFoundry with the default, keeping the thinking level", () => {
  assert.deepStrictEqual(moveSelection(privateOpenRouter, "synced"), {
    instanceId: LANES.synced,
    model: DEFAULT_MODEL,
    options: [{ id: "thinking", value: "high" }],
  });
  assert.deepStrictEqual(moveSelection(undefined, "private"), {
    instanceId: LANES.private,
    model: DEFAULT_MODEL,
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
  assert.strictEqual(routed.modelSelection?.instanceId, LANES.private);
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
  assert.strictEqual(routed.modelSelection?.instanceId, LANES.synced);
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
