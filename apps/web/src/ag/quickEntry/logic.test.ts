import type { ModelSelection, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  parseQuickEntryAction,
  quickEntryModelOptions,
  quickEntryTitleSeed,
  usualProjectModel,
} from "./logic";

const pi = "pi" as ProviderInstanceId;
const codex = "codex" as ProviderInstanceId;

const provider = (
  instanceId: ProviderInstanceId,
  enabled: boolean,
  models: Array<{ slug: string; name: string; shortName?: string }>,
) => ({ instanceId, enabled, models }) as unknown as ServerProvider;

describe("parseQuickEntryAction", () => {
  it("ignores other menu actions", () => {
    expect(parseQuickEntryAction("sidebar.toggle")).toBeNull();
  });

  it("reads a plain open and a screenshot open", () => {
    expect(parseQuickEntryAction("ag.quickEntry:{}")).toEqual({ shot: null, shotError: null });
    expect(
      parseQuickEntryAction(
        `ag.quickEntry:${JSON.stringify({
          shot: {
            dataUrl: "data:image/png;base64,AAAA",
            appName: "Safari",
            windowTitle: "Docs",
            capturedAt: "2026-10-11T00:00:00.000Z",
          },
        })}`,
      ),
    ).toEqual({
      shot: {
        dataUrl: "data:image/png;base64,AAAA",
        appName: "Safari",
        windowTitle: "Docs",
        capturedAt: "2026-10-11T00:00:00.000Z",
      },
      shotError: null,
    });
  });

  it("drops a malformed screenshot but still opens, keeping the error", () => {
    expect(
      parseQuickEntryAction(
        `ag.quickEntry:${JSON.stringify({ shot: { dataUrl: "javascript:x" }, shotError: "denied" })}`,
      ),
    ).toEqual({ shot: null, shotError: "denied" });
    expect(parseQuickEntryAction("ag.quickEntry:not json")).toEqual({
      shot: null,
      shotError: null,
    });
  });
});

describe("quickEntryModelOptions", () => {
  const providers = [
    provider(pi, true, [
      { slug: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5", shortName: "Opus 5.5" },
      { slug: "openai/gpt-6", name: "GPT-6" },
    ]),
    provider(codex, false, [{ slug: "gpt-6", name: "GPT-6" }]),
  ];

  it("leads with the new-thread default, then favorites on enabled providers, without duplicates", () => {
    const options = quickEntryModelOptions({
      providers,
      newThreadDefault: { instanceId: pi, model: "openai/gpt-6" } as ModelSelection,
      favorites: [
        { provider: pi, model: "anthropic/claude-opus-5-5" },
        { provider: pi, model: "openai/gpt-6" },
        { provider: codex, model: "gpt-6" },
      ],
    });
    expect(options.map((option) => [option.key, option.label])).toEqual([
      ["pi:openai/gpt-6", "GPT-6"],
      ["pi:anthropic/claude-opus-5-5", "Opus 5.5"],
    ]);
  });

  it("tells the same model through two routes apart", () => {
    const options = quickEntryModelOptions({
      providers: [
        provider(pi, true, [
          { slug: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5" },
          { slug: "truefoundry/anthropic-primary/claude-opus-5-5", name: "Claude Opus 5.5" },
        ]),
      ],
      newThreadDefault: {
        instanceId: pi,
        model: "truefoundry/anthropic-primary/claude-opus-5-5",
      } as ModelSelection,
      favorites: [{ provider: pi, model: "anthropic/claude-opus-5-5" }],
    });
    expect(options.map((option) => option.label)).toEqual([
      "Claude Opus 5.5 · truefoundry",
      "Claude Opus 5.5 · anthropic",
    ]);
  });

  it("falls back to the slug's last segment for unknown models", () => {
    const options = quickEntryModelOptions({
      providers,
      newThreadDefault: null,
      favorites: [{ provider: pi, model: "vendor/some-model" }],
    });
    expect(options[0]?.label).toBe("some-model");
  });
});

describe("quickEntryTitleSeed", () => {
  it("uses the first line, or names an image-only prompt", () => {
    expect(quickEntryTitleSeed("  fix the build\nand more ", 0)).toBe("fix the build");
    expect(quickEntryTitleSeed("", 1)).toBe("Image");
    expect(quickEntryTitleSeed("", 0)).toBe("New thread");
  });
});

describe("usualProjectModel", () => {
  const shell = (model: string, createdAt: string, projectId = "p") => ({
    environmentId: "e",
    projectId,
    createdAt,
    modelSelection: { instanceId: pi, model } as ModelSelection,
  });

  it("takes the most common recent model, so a stray newest thread doesn't win", () => {
    const shells = [
      shell("truefoundry/opus", "2026-10-11T01:00:00Z"),
      shell("truefoundry/opus", "2026-10-11T02:00:00Z"),
      shell("anthropic/opus", "2026-10-11T03:00:00Z"),
      shell("other", "2026-10-11T04:00:00Z", "q"),
    ];
    expect(usualProjectModel(shells, { environmentId: "e", id: "p" })?.model).toBe(
      "truefoundry/opus",
    );
    expect(usualProjectModel([], { environmentId: "e", id: "p" })).toBeNull();
  });
});
