// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINISHED_JOB_TTL_MS,
  GENERIC_JOB_ERROR,
  MAX_RUNNING_JOBS,
  RUNNING_JOB_MAX_MS,
  clearJobs,
  pollJob,
  startJob,
  userSafeMessage,
} from "@/lib/jobs/store";
import { runAiJob, type StartResponse } from "@/lib/jobs/client";

/** A scheduler that holds the task so a test decides when the "after the response" work runs. */
function manualScheduler() {
  const tasks: Array<() => Promise<void>> = [];
  return { schedule: (task: () => Promise<void>) => void tasks.push(task), runAll: () => Promise.all(tasks.splice(0).map((task) => task())) };
}

let counter = 0;
const newId = () => `job-${(counter += 1)}`;

beforeEach(() => {
  clearJobs();
  counter = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("job store", () => {
  it("returns at once and finishes later with the action's own result", async () => {
    const scheduler = manualScheduler();
    const work = vi.fn().mockResolvedValue({ success: true, reportId: "r1" });
    const started = startJob({ userId: "u1", kind: "intake", work, schedule: scheduler.schedule, newId });

    expect(started).toEqual({ ok: true, jobId: "job-1" });
    expect(work).not.toHaveBeenCalled();
    expect(pollJob("u1", "job-1")).toEqual({ status: "running" });

    await scheduler.runAll();
    expect(pollJob("u1", "job-1")).toEqual({ status: "done", result: { success: true, reportId: "r1" } });
  });

  it("keeps a result that is a plain failure object (the action decided that, not the job)", async () => {
    const scheduler = manualScheduler();
    startJob({ userId: "u1", kind: "quiz", work: async () => ({ success: false, error: "PRO_REQUIRED" }), schedule: scheduler.schedule, newId });
    await scheduler.runAll();
    expect(pollJob("u1", "job-1")).toEqual({ status: "done", result: { success: false, error: "PRO_REQUIRED" } });
  });

  it("shows a thrown message the action chose, and hides internals", async () => {
    const scheduler = manualScheduler();
    startJob({ userId: "u1", kind: "quiz", work: async () => { throw new Error("Please answer every triage question before continuing."); }, schedule: scheduler.schedule, newId });
    startJob({ userId: "u1", kind: "feedback", work: async () => { throw new Error("Invalid `prisma.clinicalReport.update()` invocation: connection refused"); }, schedule: scheduler.schedule, newId });
    await scheduler.runAll();
    expect(pollJob("u1", "job-1")).toEqual({ status: "failed", message: "Please answer every triage question before continuing." });
    expect(pollJob("u1", "job-2")).toEqual({ status: "failed", message: GENERIC_JOB_ERROR });
  });

  it("filters messages that look like internals", () => {
    expect(userSafeMessage(new Error("AccessDenied: s3:GetObject"))).toBe(GENERIC_JOB_ERROR);
    expect(userSafeMessage(new Error("a".repeat(300)))).toBe(GENERIC_JOB_ERROR);
    expect(userSafeMessage("nope")).toBe(GENERIC_JOB_ERROR);
    expect(userSafeMessage(new Error(""))).toBe(GENERIC_JOB_ERROR);
  });

  it("only lets the owner read a job", async () => {
    const scheduler = manualScheduler();
    startJob({ userId: "u1", kind: "intake", work: async () => "secret", schedule: scheduler.schedule, newId });
    await scheduler.runAll();
    expect(pollJob("u2", "job-1").status).toBe("unknown");
    expect(pollJob("u1", "missing").status).toBe("unknown");
    expect(JSON.stringify(pollJob("u2", "job-1"))).not.toContain("secret");
  });

  it("joins a job of the same kind that is already running instead of starting a second", () => {
    const scheduler = manualScheduler();
    const work = vi.fn().mockResolvedValue(1);
    const first = startJob({ userId: "u1", kind: "intake", work, schedule: scheduler.schedule, newId });
    const second = startJob({ userId: "u1", kind: "intake", work, schedule: scheduler.schedule, newId });
    expect(second).toEqual(first);
    // A different kind, or a different user, is its own job.
    expect(startJob({ userId: "u1", kind: "quiz", work, schedule: scheduler.schedule, newId })).toEqual({ ok: true, jobId: "job-2" });
    expect(startJob({ userId: "u2", kind: "intake", work, schedule: scheduler.schedule, newId })).toEqual({ ok: true, jobId: "job-3" });
  });

  it("starts a new job once the previous one has finished", async () => {
    const scheduler = manualScheduler();
    startJob({ userId: "u1", kind: "intake", work: async () => 1, schedule: scheduler.schedule, newId });
    await scheduler.runAll();
    expect(startJob({ userId: "u1", kind: "intake", work: async () => 2, schedule: scheduler.schedule, newId })).toEqual({ ok: true, jobId: "job-2" });
  });

  it("refuses new work when too many jobs are running", () => {
    const scheduler = manualScheduler();
    for (let user = 0; user < MAX_RUNNING_JOBS; user += 1) {
      expect(startJob({ userId: `u${user}`, kind: "intake", work: async () => 1, schedule: scheduler.schedule, newId }).ok).toBe(true);
    }
    const refused = startJob({ userId: "late", kind: "intake", work: async () => 1, schedule: scheduler.schedule, newId });
    expect(refused).toMatchObject({ ok: false, error: "BUSY" });
  });

  it("fails a job that has been running too long, and forgets finished jobs after a while", async () => {
    const scheduler = manualScheduler();
    startJob({ userId: "u1", kind: "intake", work: () => new Promise(() => {}), schedule: scheduler.schedule, newId, now: 1_000 });
    void scheduler.runAll();
    expect(pollJob("u1", "job-1", 1_000 + RUNNING_JOB_MAX_MS - 1)).toEqual({ status: "running" });
    expect(pollJob("u1", "job-1", 1_000 + RUNNING_JOB_MAX_MS + 1)).toEqual({ status: "failed", message: GENERIC_JOB_ERROR });
    expect(pollJob("u1", "job-1", 1_000 + RUNNING_JOB_MAX_MS + FINISHED_JOB_TTL_MS + 5).status).toBe("unknown");
  });
});

describe("browser polling (runAiJob)", () => {
  const options = (polls: Array<ReturnType<typeof pollJob> | Error>) => {
    let time = 0;
    return {
      poll: vi.fn(async () => {
        const next = polls.shift();
        if (next instanceof Error) throw next;
        return next ?? { status: "running" as const };
      }),
      wait: vi.fn(async (ms: number) => void (time += ms)),
      now: () => time,
      intervalMs: 2_000,
      giveUpMs: 20_000,
    };
  };
  const started = async (): Promise<StartResponse> => ({ ok: true, jobId: "j1" });

  it("polls until the job is done and returns the original result", async () => {
    const o = options([{ status: "running" }, { status: "running" }, { status: "done", result: { success: true } }]);
    await expect(runAiJob(started, o)).resolves.toEqual({ success: true });
    expect(o.poll).toHaveBeenCalledTimes(3);
    expect(o.wait).toHaveBeenCalledWith(2_000);
  });

  it("throws what the action threw when the job failed", async () => {
    const o = options([{ status: "failed", message: "Please answer every triage question before continuing." }]);
    await expect(runAiJob(started, o)).rejects.toThrow("Please answer every triage question before continuing.");
  });

  it("throws the message when the job is unknown (server restarted)", async () => {
    const o = options([{ status: "unknown", message: "We lost track of that request. Please try again." }]);
    await expect(runAiJob(started, o)).rejects.toThrow(/lost track/);
  });

  it("throws the start failure without polling", async () => {
    const o = options([]);
    await expect(runAiJob(async () => ({ ok: false, error: "BUSY", message: "Many plans are being prepared right now." }), o)).rejects.toThrow(/Many plans/);
    expect(o.poll).not.toHaveBeenCalled();
  });

  it("survives a few dropped polls but not many", async () => {
    const drop = () => new Error("network");
    const ok = options([drop(), drop(), { status: "done", result: 7 }]);
    await expect(runAiJob(started, ok)).resolves.toBe(7);
    const bad = options([drop(), drop(), drop(), drop(), drop(), { status: "done", result: 7 }]);
    await expect(runAiJob(started, bad)).rejects.toThrow(/could not reach the server/i);
  });

  it("gives up after the time limit", async () => {
    const o = options([]);
    await expect(runAiJob(started, o)).rejects.toThrow(/taking longer than expected/);
    expect(o.poll.mock.calls.length).toBeLessThanOrEqual(11);
  });
});
