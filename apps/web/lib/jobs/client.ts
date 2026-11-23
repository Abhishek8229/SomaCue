import type { JobPoll } from "./store";

/*
 * Browser side of a background AI job. `start` calls one of the start actions in actions/aiJobs.ts; this then asks
 * `getAiJob` for the outcome every couple of seconds. It resolves with exactly what the original action returned, and
 * throws an Error(message) where the original action threw, so the screens keep their existing result handling.
 */

export type StartResponse = { ok: true; jobId: string } | { ok: false; error: string; message: string };

export const POLL_INTERVAL_MS = 2_000;
/** A little longer than the server's own limit for a running job. */
export const POLL_GIVE_UP_MS = 6.5 * 60_000;

export type RunAiJobOptions = {
  poll?: (jobId: string) => Promise<JobPoll>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  giveUpMs?: number;
};

export async function runAiJob<T>(start: () => Promise<StartResponse>, options: RunAiJobOptions = {}): Promise<T> {
  const poll = options.poll ?? (async (jobId: string) => (await import("@/actions/aiJobs")).getAiJob(jobId));
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const giveUpMs = options.giveUpMs ?? POLL_GIVE_UP_MS;

  const started = await start();
  if (!started.ok) throw new Error(started.message);

  const deadline = now() + giveUpMs;
  let failures = 0;
  while (now() < deadline) {
    await wait(intervalMs);
    let outcome: JobPoll;
    try {
      outcome = await poll(started.jobId);
      failures = 0;
    } catch {
      // A dropped connection or a deploy in progress: keep trying for a while before giving up.
      failures += 1;
      if (failures >= 5) throw new Error("We could not reach the server. Check your connection and try again.");
      continue;
    }
    if (outcome.status === "done") return outcome.result as T;
    if (outcome.status === "failed" || outcome.status === "unknown") throw new Error(outcome.message);
  }
  throw new Error("This is taking longer than expected. Please try again.");
}
