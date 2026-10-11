// Deep search (fork, FORK.md): the response of the server's /api/ag/deep-search route, which forwards
// Ag's ag-deepsearch service (EmbeddingGemma 2 over open T3 threads and Ag tabs).
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as PrimaryEnvironmentHttpLayer from "~/environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

export type DeepSearchKind = "thread" | "tab";

export interface DeepSearchResult {
  readonly kind: DeepSearchKind;
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly role: string | null;
  /** T3 threads */
  readonly project?: string;
  /** Ag tabs */
  readonly tab?: string;
  readonly link?: string;
}

export interface DeepSearchResponse {
  readonly results: ReadonlyArray<DeepSearchResult>;
  readonly indexed: number;
  /** "embedding 120/5000" while the index is still catching up. */
  readonly progress: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function parseDeepSearchResponse(body: unknown): DeepSearchResponse {
  if (!isRecord(body)) throw new Error("Deep search returned an unexpected response.");
  if (typeof body.error === "string") throw new Error(body.error);
  const results = (Array.isArray(body.results) ? body.results : []).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const kind = raw.kind === "thread" || raw.kind === "tab" ? raw.kind : null;
    const id = str(raw.id);
    if (!kind || !id) return [];
    const project = str(raw.project);
    const tab = str(raw.tab);
    const link = str(raw.link);
    return [
      {
        kind,
        id,
        title: str(raw.title) || "Untitled",
        snippet: str(raw.snippet) ?? "",
        score: typeof raw.score === "number" ? raw.score : 0,
        role: str(raw.role) ?? null,
        ...(project ? { project } : {}),
        ...(tab ? { tab } : {}),
        ...(link ? { link } : {}),
      } satisfies DeepSearchResult,
    ];
  });
  return {
    results,
    indexed: typeof body.indexed === "number" ? body.indexed : 0,
    progress: str(body.progress) ?? "",
  };
}

const runtime = ManagedRuntime.make(PrimaryEnvironmentHttpLayer.layer.pipe(Layer.orDie));

export function fetchDeepSearch(query: string, signal: AbortSignal): Promise<DeepSearchResponse> {
  const url = resolvePrimaryEnvironmentHttpUrl(
    `/api/ag/deep-search?${new URLSearchParams({ q: query, limit: "30" }).toString()}`,
  );
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get(url);
      const body = yield* response.json;
      if (response.status === 503) return parseDeepSearchResponse(body);
      yield* HttpClientResponse.filterStatusOk(response);
      return parseDeepSearchResponse(body);
    }),
    { signal },
  );
}
