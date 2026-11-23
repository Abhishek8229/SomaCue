"use server";

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { pollJob, startJob, type JobPoll, type JobKind, type StartedJob } from "@/lib/jobs/store";
import { submitDailyFeedback } from "./dailyProgress";
import { completeTriageQuiz, submitIntakeForm } from "./intake";
import { reschedulePainEvent } from "./painEvent";
import type { QuizAnswers } from "./generatePlan";

/*
 * The AI actions can run for minutes, which a CloudFront-fronted server cannot hold one request open for. Each start
 * action below only checks that someone is signed in, registers a job and returns its id. The real action then runs
 * after the response is sent (`after`, which keeps the request's cookies), unchanged: it checks the session, the
 * plan limits and ownership itself, exactly as when it was called directly. The browser collects the result with
 * `getAiJob`. See lib/jobs/store.ts.
 */

type Failure = Extract<StartedJob, { ok: false }> | { ok: false; error: "UNAUTHENTICATED"; message: string };

async function start(kind: JobKind, work: () => Promise<unknown>): Promise<StartedJob | Failure> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED", message: "Please sign in to continue." };
  return startJob({ userId: user.id, kind, work, schedule: (task) => after(task) });
}

export async function startIntakeJob(formData: FormData) {
  return start("intake", () => submitIntakeForm(formData));
}

export async function startQuizJob(reportId: string, quizId: string, answers: QuizAnswers) {
  return start("quiz", () => completeTriageQuiz(reportId, quizId, answers));
}

export async function startPainRescheduleJob(reportId: string, eventId: string) {
  return start("pain-reschedule", () => reschedulePainEvent(reportId, eventId));
}

export async function startFeedbackJob(...args: Parameters<typeof submitDailyFeedback>) {
  return start("feedback", () => submitDailyFeedback(...args));
}

export async function getAiJob(jobId: string): Promise<JobPoll> {
  const user = await getCurrentUser();
  if (!user) return { status: "unknown", message: "Please sign in to continue." };
  return pollJob(user.id, typeof jobId === "string" ? jobId : "");
}
