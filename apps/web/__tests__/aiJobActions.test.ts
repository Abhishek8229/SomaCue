// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  after: vi.fn(),
  submitIntakeForm: vi.fn(),
  completeTriageQuiz: vi.fn(),
  reschedulePainEvent: vi.fn(),
  submitDailyFeedback: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/actions/intake", () => ({ submitIntakeForm: mocks.submitIntakeForm, completeTriageQuiz: mocks.completeTriageQuiz }));
vi.mock("@/actions/painEvent", () => ({ reschedulePainEvent: mocks.reschedulePainEvent }));
vi.mock("@/actions/dailyProgress", () => ({ submitDailyFeedback: mocks.submitDailyFeedback }));

import { getAiJob, startFeedbackJob, startIntakeJob, startPainRescheduleJob, startQuizJob } from "@/actions/aiJobs";
import { clearJobs } from "@/lib/jobs/store";

/** `after` runs its task once the response is out; here the test runs the captured tasks on demand. */
const afterTasks = () => mocks.after.mock.calls.map((call) => call[0] as () => Promise<void>);

beforeEach(() => {
  clearJobs();
  mocks.user = { id: "user-1" };
  for (const fn of [mocks.after, mocks.submitIntakeForm, mocks.completeTriageQuiz, mocks.reschedulePainEvent, mocks.submitDailyFeedback]) fn.mockReset();
});

describe("AI job start actions", () => {
  it("refuses to start anything when signed out", async () => {
    mocks.user = null;
    for (const result of [
      await startIntakeJob(new FormData()),
      await startQuizJob("r", "q", {}),
      await startPainRescheduleJob("r", "e"),
      await startFeedbackJob("r", "2026-11-23", {} as never),
    ]) {
      expect(result).toMatchObject({ ok: false, error: "UNAUTHENTICATED" });
    }
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("returns a job id before any AI work runs", async () => {
    const form = new FormData();
    const started = await startIntakeJob(form);
    expect(started).toMatchObject({ ok: true });
    expect(mocks.submitIntakeForm).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("runs the original action with the same arguments after the response, and the poll returns its result", async () => {
    mocks.completeTriageQuiz.mockResolvedValue({ success: true, treatmentPlanId: "t1" });
    const started = await startQuizJob("report-1", "quiz-1", { pain: "6" });
    if (!started.ok) throw new Error("expected a job");

    expect(await getAiJob(started.jobId)).toEqual({ status: "running" });
    await afterTasks()[0]();

    expect(mocks.completeTriageQuiz).toHaveBeenCalledWith("report-1", "quiz-1", { pain: "6" });
    expect(await getAiJob(started.jobId)).toEqual({ status: "done", result: { success: true, treatmentPlanId: "t1" } });
  });

  it("passes the arguments of the other three actions through unchanged", async () => {
    const form = new FormData();
    form.set("primarySymptoms", "knee");
    await startIntakeJob(form);
    await startPainRescheduleJob("report-1", "event-1");
    await startFeedbackJob("report-1", "2026-11-23", { rating: 3 } as never);
    for (const task of afterTasks()) await task();

    expect(mocks.submitIntakeForm).toHaveBeenCalledWith(form);
    expect(mocks.reschedulePainEvent).toHaveBeenCalledWith("report-1", "event-1");
    expect(mocks.submitDailyFeedback).toHaveBeenCalledWith("report-1", "2026-11-23", { rating: 3 });
  });

  it("reports a failure without leaking internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reschedulePainEvent.mockRejectedValue(new Error("Invalid `prisma.x.update()` invocation: password authentication failed"));
    const started = await startPainRescheduleJob("r", "e");
    if (!started.ok) throw new Error("expected a job");
    await afterTasks()[0]();
    const poll = await getAiJob(started.jobId);
    expect(poll.status).toBe("failed");
    expect(JSON.stringify(poll)).not.toMatch(/prisma|password/i);
  });

  it("does not let another user read a job", async () => {
    const started = await startIntakeJob(new FormData());
    if (!started.ok) throw new Error("expected a job");
    mocks.user = { id: "user-2" };
    expect((await getAiJob(started.jobId)).status).toBe("unknown");
    mocks.user = null;
    expect((await getAiJob(started.jobId)).status).toBe("unknown");
  });
});
