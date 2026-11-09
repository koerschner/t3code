/**
 * How long Ag keeps an idle thread's provider session (its Pi process) loaded. Upstream unloads after 30 minutes,
 * and the next message then waits 2–3.5 s for Pi to boot and resume the session before the model is called; Ag's
 * threads are often picked up again within a couple of hours. Each loaded Pi session holds about 200–450 MB.
 */
export const AG_PROVIDER_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
