import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { applyLane, PRIVATE_LANE, PRIVATE_MODEL } from "./lane.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const synced = createModelSelection(
  ProviderInstanceId.make("pi"),
  "truefoundry/anthropic-primary/claude-opus-5-5",
  [{ id: "thinking", value: "max" }],
);
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

it("leaves a message alone when no rule moves it", () => {
  const command = message({ modelSelection: synced });
  assert.strictEqual(applyLane(command, synced, undefined), command);
  assert.strictEqual(applyLane(command, synced, { lane: "synced" }), command);
});

it("moves a message to the private lane, keeping its thinking level", () => {
  const routed = applyLane(message({ modelSelection: synced }), undefined, { lane: "private" });
  assert.deepStrictEqual(routed.modelSelection, {
    instanceId: PRIVATE_LANE,
    model: PRIVATE_MODEL,
    options: [{ id: "thinking", value: "max" }],
  });
  assert.deepStrictEqual(routed.dispatchMode, { type: "start_immediately" });
});

it("uses the thread's selection when the message carries none", () => {
  const routed = applyLane(message(), synced, { lane: "private" });
  assert.strictEqual(routed.modelSelection?.instanceId, PRIVATE_LANE);
});

it("queues instead of steering into a running synced turn", () => {
  const routed = applyLane(
    message({ modelSelection: synced, deliveryIntent: "steer" }),
    undefined,
    { lane: "private" },
  );
  assert.deepStrictEqual(routed.dispatchMode, { type: "start_immediately" });
  assert.isFalse("deliveryIntent" in routed);
});

it("keeps a deferred launch deferred", () => {
  const dispatchMode = { type: "defer_start" } as const;
  const routed = applyLane(message({ modelSelection: synced, dispatchMode }), undefined, {
    lane: "private",
  });
  assert.strictEqual(routed.dispatchMode, dispatchMode);
});

it("leaves a thread that is already private alone", () => {
  const privateSelection = createModelSelection(PRIVATE_LANE, PRIVATE_MODEL);
  const command = message({ modelSelection: privateSelection });
  assert.strictEqual(applyLane(command, undefined, { lane: "private" }), command);
});
