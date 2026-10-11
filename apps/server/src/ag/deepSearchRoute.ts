// Deep search (fork, FORK.md): semantic search over open threads and Ag's tabs, beside the palette's
// substring search. The index and the EmbeddingGemma 2 model live in Ag's `ag-deepsearch` service on the
// session host (127.0.0.1:7395); this route authenticates the client and forwards the query.
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";

export const AG_DEEP_SEARCH_PATH = "/api/ag/deep-search";
const upstream = process.env.AG_DEEPSEARCH_URL ?? "http://127.0.0.1:7395";

const authenticate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
    Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
      failEnvironmentAuthInvalid(
        EnvironmentAuth.serverAuthCredentialReason(error),
        EnvironmentAuth.serverAuthDpopFailureReason(error),
      ),
    ),
    Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
      failEnvironmentInternal("internal_error", error),
    ),
  );
  if (!session.scopes.includes(AuthOrchestrationReadScope)) {
    return yield* failEnvironmentScopeRequired(AuthOrchestrationReadScope);
  }
});

export const layerAgDeepSearchRoute = HttpRouter.add(
  "GET",
  AG_DEEP_SEARCH_PATH,
  Effect.gen(function* () {
    yield* authenticate;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const httpClient = yield* HttpClient.HttpClient;
    return yield* httpClient.get(`${upstream}/search${url.value.search}`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.map((body) =>
        HttpServerResponse.jsonUnsafe(body, { headers: { "cache-control": "no-store" } }),
      ),
      Effect.orElseSucceed(() =>
        HttpServerResponse.jsonUnsafe(
          { error: "Deep search is unavailable (ag-deepsearch.service on the session host)." },
          { status: 503 },
        ),
      ),
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);
