import { describe, expect, it } from "vite-plus/test";

import { currentRoutePath, normalModeKey, sidebarRows } from "./normalMode";

type El = { closest: (s: string) => El | null };
const plain: El = { closest: () => null };
const editable: El = { closest: (s) => (s.includes("textarea") ? editable : null) };

function doc(opts: { active?: El; floating?: boolean; rows?: string[] } = {}) {
  return {
    activeElement: opts.active ?? plain,
    querySelector: () => (opts.floating ? {} : null),
    querySelectorAll: () => (opts.rows ?? []).map((id) => ({ dataset: { threadItem: id } })),
  } as unknown as Document;
}
function key(k: string, extra: Partial<KeyboardEvent> = {}, target: El = plain) {
  return {
    key: k,
    target,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...extra,
  } as unknown as KeyboardEvent;
}

describe("normalModeKey", () => {
  it("maps j k i e u / outside text fields", () => {
    for (const k of ["j", "k", "i", "e", "u", "/"]) expect(normalModeKey(key(k), doc())).toBe(k);
  });
  it("lets other keys and modified keys through", () => {
    expect(normalModeKey(key("x"), doc())).toBeNull();
    expect(normalModeKey(key("j", { metaKey: true }), doc())).toBeNull();
    expect(normalModeKey(key("J", { shiftKey: true }), doc())).toBeNull();
  });
  it("is off while typing, or with a dialog or menu open", () => {
    expect(normalModeKey(key("j", {}, editable), doc())).toBeNull();
    expect(normalModeKey(key("j"), doc({ active: editable }))).toBeNull();
    expect(normalModeKey(key("j"), doc({ floating: true }))).toBeNull();
    expect(normalModeKey(key("/", {}, editable), doc())).toBeNull();
  });
});

describe("sidebarRows", () => {
  it("finds the open session among the rows", () => {
    const d = doc({ rows: ["env:a", "env:b", "env:c"] });
    expect(sidebarRows(d, "/env/b").active).toBe(1);
    expect(sidebarRows(d, "/draft/x").active).toBe(-1);
  });
});

describe("currentRoutePath", () => {
  it("reads the desktop app's hash route and the web app's path", () => {
    expect(currentRoutePath({ hash: "#/env/b?x=1", pathname: "/" })).toBe("/env/b");
    expect(currentRoutePath({ hash: "", pathname: "/env/b" })).toBe("/env/b");
  });
});
