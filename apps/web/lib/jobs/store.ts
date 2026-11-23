/*
 * Background AI jobs, kept in memory.
 *
 * Plan generation can take minutes, and CloudFront cuts a request that waits more than about a minute. So the long AI
 * actions do not run inside the request that starts them: a start action registers a job here, schedules the work to
 * run after its response is sent, and returns the job id at once. The browser then asks for the result every couple of
 * seconds (see lib/jobs/client.ts), and each of those requests is short.
 *
 * One server process serves the whole app, so a Map is enough. A restart loses running jobs; the poll then reports the
 * job as unknown and the screen offers a retry. The Map lives on globalThis because Next can load this module more than
 * once (one copy per bundle).
 */

export type JobKind = "intake" | "quiz" | "pain-reschedule" | "feedback";

export type JobState = {
  id: string;
  userId: string;
  kind: JobKind;
  status: "running" | "done" | "failed";
  result?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export type StartedJob = { ok: true; jobId: string } | { ok: false; error: "BUSY"; message: string };

export type JobPoll =
  | { status: "running" }
  | { status: "done"; result: unknown }
  | { status: "failed"; message: string }
  | { status: "unknown"; message: string };

/** Total jobs running at once. Each holds an AI request and a few MB, on a 2 GiB host shared with the database. */
export const MAX_RUNNING_JOBS = 6;
/** A job still running after this long is reported as failed (the AI calls time out well before). */
export const RUNNING_JOB_MAX_MS = 6 * 60_000;
/** A finished job's result is kept this long, so a slow or reconnecting browser can still collect it. */
export const FINISHED_JOB_TTL_MS = 15 * 60_000;

export const GENERIC_JOB_ERROR = "Something went wrong. Please try again.";

type Registry = Map<string, JobState>;
const holder = globalThis as typeof globalThis & { __somacueAiJobs?: Registry };
const jobs: Registry = (holder.__somacueAiJobs ??= new Map());

function sweep(now: number) {
  for (const [id, job] of jobs) {
    if (job.status === "running" && now - job.startedAt > RUNNING_JOB_MAX_MS) {
      job.status = "failed";
      job.error = GENERIC_JOB_ERROR;
      job.finishedAt = now;
    }
    if (job.finishedAt !== undefined && now - job.finishedAt > FINISHED_JOB_TTL_MS) jobs.delete(id);
  }
}

/** Messages the actions throw on purpose are shown to the user. Database and library errors never are. */
export function userSafeMessage(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC_JOB_ERROR;
  const message = error.message.trim();
  if (!message || message.length > 200 || /prisma|invocation|ECONN|ENOTFOUND|\n|postgres|S3|AWS/i.test(message)) {
    return GENERIC_JOB_ERROR;
  }
  return message;
}

export type StartJobOptions = {
  userId: string;
  kind: JobKind;
  /** the existing action, run exactly as it ran before (it re-checks the session and the plan limits itself) */
  work: () => Promise<unknown>;
  /** run the work after the response is sent: `after` from next/server in production */
  schedule: (task: () => Promise<void>) => void;
  now?: number;
  newId?: () => string;
};

export function startJob({ userId, kind, work, schedule, now = Date.now(), newId = () => crypto.randomUUID() }: StartJobOptions): StartedJob {
  sweep(now);

  // The same user starting the same kind again (a double click, a reload) joins the job already running.
  for (const job of jobs.values()) {
    if (job.userId === userId && job.kind === kind && job.status === "running") return { ok: true, jobId: job.id };
  }

  const running = [...jobs.values()].filter((job) => job.status === "running").length;
  if (running >= MAX_RUNNING_JOBS) {
    return { ok: false, error: "BUSY", message: "Many plans are being prepared right now. Please try again in a minute." };
  }

  const job: JobState = { id: newId(), userId, kind, status: "running", startedAt: now };
  jobs.set(job.id, job);

  schedule(async () => {
    try {
      job.result = await work();
      job.status = "done";
    } catch (error) {
      console.error(`[SomaCue jobs] ${kind} job failed.`, error instanceof Error ? error.message : error);
      job.error = userSafeMessage(error);
      job.status = "failed";
    } finally {
      job.finishedAt = Date.now();
    }
  });

  return { ok: true, jobId: job.id };
}

/** Only the user who started a job can read it. Anything else looks like a job that does not exist. */
export function pollJob(userId: string, jobId: string, now = Date.now()): JobPoll {
  sweep(now);
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId) {
    return { status: "unknown", message: "We lost track of that request. Please try again." };
  }
  if (job.status === "running") return { status: "running" };
  if (job.status === "failed") return { status: "failed", message: job.error ?? GENERIC_JOB_ERROR };
  return { status: "done", result: job.result };
}

/** Test helper. */
export function clearJobs() {
  jobs.clear();
}
