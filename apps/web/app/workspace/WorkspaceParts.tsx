"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Mic, MicOff } from "lucide-react";
import Image from "next/image";
import { submitIntakeForm } from "@/actions/intake";
import type { TreatmentPlan, TriageQuestion } from "@/actions/generatePlan";
import { useDictation } from "@/hooks/useDictation";
import type { IntakeSnapshot } from "@/lib/analysis/progressCopy";
import type { DetectedCondition, Escalation } from "@/lib/clinical/assessment";
import {
  AI_DISCLAIMER_TEXT,
  MAX_FILES_PER_CATEGORY,
  type ReportCategory,
} from "@/lib/intake/reportFiles";
import type { ScheduleDayWithSteps, StoredTreatmentPlan } from "@/lib/progress/dailyProgress";

export type TreatmentRoutineStep = TreatmentPlan["steps"][number];
export type TreatmentScheduleDay = ScheduleDayWithSteps;
export type TreatmentPlanPayload = StoredTreatmentPlan;

export type InitialQuiz = {
  id: string;
  reportId: string;
  questions: TriageQuestion[];
};

export type FlowPhase = "discovery" | "preparing" | "quiz" | "finalizing" | "ready";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {children}
    </svg>
  );
}

export type TriageReadyResult = {
  reportId: string;
  /** null when the case was escalated for in-person care and no quiz was made. */
  quizId: string | null;
  questions: TriageQuestion[];
  condition: DetectedCondition | null;
  escalation: Escalation | null;
};

type SidebarIntakeProps = {
  reportsSubmitted: boolean;
  flowPhase: FlowPhase;
  flowError: string | null;
  onPreparing: (intake: IntakeSnapshot) => void;
  onTriageReady: (result: TriageReadyResult) => void;
  /** Rendered under the intake form, e.g. the detected-condition card. */
  summary?: ReactNode;
  onError: (message: string) => void;
  onRerunAnalysis: () => void;
};

type SelectedFile = {
  file: File;
  preview: string;
  category: ReportCategory;
  uploadStatus: "pending" | "uploading" | "success" | "error";
  url?: string;
  storage?: "azure" | "local";
};

const DROPZONES: Record<
  ReportCategory,
  { title: string; detail: string; listLabel: string; icon: ReactNode }
> = {
  scan: {
    title: "Medical scans / imaging",
    detail: "MRI, X-ray, CT scan or other diagnostic imaging",
    listLabel: "Selected scans",
    icon: (
      <>
        <rect height="16" rx="2" stroke="currentColor" strokeWidth="1.6" width="18" x="3" y="4" />
        <path d="M12 8v8M9 10.5c1 .6 5 .6 6 0M9 13.5c1 .6 5 .6 6 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      </>
    ),
  },
  prescription: {
    title: "Clinical prescriptions & notes",
    detail: "Prescriptions, assessment notes or reports from a doctor, physio or other clinician",
    listLabel: "Selected prescriptions and notes",
    icon: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
        <path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      </>
    ),
  },
};

function ReportDropzone({
  category,
  files,
  isDragging,
  onDragChange,
  onFiles,
  onRemove,
}: {
  category: ReportCategory;
  files: SelectedFile[];
  isDragging: boolean;
  onDragChange: (dragging: boolean) => void;
  onFiles: (files: FileList | null) => void;
  onRemove: (preview: string) => void;
}) {
  const zone = DROPZONES[category];
  const inputId = `intake-${category}-files`;

  return (
    <div>
      <label
        className={`${interactive} relative flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/25 bg-zinc-950 px-3 py-3 hover:border-emerald-300/60 ${
          isDragging ? "border-emerald-300 bg-emerald-300/10" : ""
        }`}
        htmlFor={inputId}
        onDragEnter={() => onDragChange(true)}
        onDragLeave={() => onDragChange(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onDragChange(false);
          onFiles(event.dataTransfer.files);
        }}
      >
        <input
          accept="image/*,application/pdf"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          id={inputId}
          onChange={(event) => {
            onFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
          multiple
          type="file"
        />
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-300/40 text-emerald-300">
          <Icon size={18}>{zone.icon}</Icon>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">{zone.title}</span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-white/60">{zone.detail}</span>
        </span>
        <span className="shrink-0 text-[10px] text-emerald-300">
          {files.length > 0 ? `${files.length} added` : "Browse"}
        </span>
      </label>
      {files.length > 0 ? (
        <div className="mt-2 space-y-2" aria-label={zone.listLabel}>
          {files.map((item) => (
            <div
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950 px-2 py-2"
              key={item.preview}
            >
              {item.file.type.startsWith("image/") ? (
                <Image
                  alt=""
                  className="h-9 w-9 rounded-lg object-cover"
                  height={36}
                  src={item.preview}
                  unoptimized
                  width={36}
                />
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-red-300/30 bg-red-300/10 text-[9px] font-semibold text-red-200">
                  PDF
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] text-white/80">{item.file.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-white/45">
                  {item.uploadStatus === "uploading" ? (
                    <>
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/25 border-t-emerald-300" />
                      Uploading
                    </>
                  ) : item.uploadStatus === "success" ? (
                    <span className="text-emerald-300">
                      Uploaded successfully{item.storage === "local" ? " · local fallback" : ""}
                    </span>
                  ) : item.uploadStatus === "error" ? (
                    <span className="text-red-200">Upload failed. Remove it and try again.</span>
                  ) : (
                    "Preparing upload"
                  )}
                </span>
              </span>
              <button
                aria-label={`Remove ${item.file.name}`}
                className={`${interactive} grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm text-white/45 hover:bg-white/10 hover:text-white`}
                onClick={() => onRemove(item.preview)}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarIntake({
  reportsSubmitted,
  flowPhase,
  flowError,
  onPreparing,
  onTriageReady,
  onError,
  onRerunAnalysis,
  summary,
}: SidebarIntakeProps) {
  const [draggingZone, setDraggingZone] = useState<ReportCategory | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [symptoms, setSymptoms] = useState(
    "Pain and stiffness around the right knee after long walks.",
  );
  const previewUrls = useRef(new Set<string>());
  const {
    isListening: isDictating,
    transcript,
    startListening,
    stopListening,
  } = useDictation();
  const syncedTranscriptLength = useRef(0);
  const scanFiles = selectedFiles.filter((item) => item.category === "scan");
  const prescriptionFiles = selectedFiles.filter((item) => item.category === "prescription");
  // A prescription that failed to upload does not count; the patient must remove it anyway.
  const hasPrescription = prescriptionFiles.some((item) => item.uploadStatus !== "error");
  const canSubmit =
    symptoms.trim().length > 0 &&
    flowPhase === "discovery" &&
    selectedFiles.every((item) => item.uploadStatus === "success") &&
    (hasPrescription || disclaimerAccepted);
  const resetIntake = () => {
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.preview));
    previewUrls.current.clear();
    setSelectedFiles([]);
    setUploadNotice(null);
    setDisclaimerAccepted(false);
    setSymptoms("Pain and stiffness around the right knee after long walks.");
    onRerunAnalysis();
  };

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((preview) => URL.revokeObjectURL(preview));
    };
  }, []);

  const acceptReports = (files: FileList | null, category: ReportCategory) => {
    setDraggingZone(null);
    if (!files || files.length === 0) {
      return;
    }

    const existing = selectedFiles.filter((item) => item.category === category).length;
    const room = Math.max(0, MAX_FILES_PER_CATEGORY - existing);
    const accepted = Array.from(files).slice(0, room);
    setUploadNotice(
      accepted.length < files.length
        ? `Each section accepts up to ${MAX_FILES_PER_CATEGORY} files. ${files.length - accepted.length} file${files.length - accepted.length === 1 ? " was" : "s were"} not added.`
        : null,
    );

    const newFiles = accepted.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      category,
      uploadStatus: "pending" as const,
    }));

    newFiles.forEach((item) => previewUrls.current.add(item.preview));
    setSelectedFiles((current) => [...current, ...newFiles]);
    newFiles.forEach((item) => {
      void uploadFile(item.file, item.preview);
    });
  };

  const uploadFile = async (file: File, preview: string) => {
    setSelectedFiles((current) =>
      current.map((item) =>
        item.preview === preview ? { ...item, uploadStatus: "uploading" } : item,
      ),
    );

    try {
      const payload = new FormData();
      payload.set("scanFile", file);
      const response = await fetch("/api/upload", { method: "POST", body: payload });
      if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
      const result = (await response.json()) as { storage?: "azure" | "local"; url: string };
      setSelectedFiles((current) =>
        current.map((item) =>
          item.preview === preview
            ? {
                ...item,
                uploadStatus: "success",
                storage: result.storage,
                url: result.url,
              }
            : item,
        ),
      );
    } catch {
      setSelectedFiles((current) =>
        current.map((item) =>
          item.preview === preview ? { ...item, uploadStatus: "error" } : item,
        ),
      );
    }
  };

  const removeFile = (preview: string) => {
    setSelectedFiles((current) => {
      const item = current.find((entry) => entry.preview === preview);
      if (item) {
        URL.revokeObjectURL(item.preview);
        previewUrls.current.delete(item.preview);
      }
      return current.filter((entry) => entry.preview !== preview);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const submission = new FormData();
    submission.set("primarySymptoms", symptoms.trim());
    for (const item of selectedFiles) {
      if (item.uploadStatus === "success" && item.url) {
        submission.append(item.category === "scan" ? "scanUrl" : "prescriptionUrl", item.url);
      }
    }
    if (!hasPrescription) {
      submission.set("aiDisclaimerAccepted", String(disclaimerAccepted));
    }

    onPreparing({
      symptoms: symptoms.trim(),
      scanCount: scanFiles.length,
      prescriptionCount: prescriptionFiles.length,
    });

    try {
      const result = await submitIntakeForm(submission);
      if (!("error" in result)) {
        onTriageReady({
          reportId: result.reportId,
          quizId: result.quizId,
          questions: result.questions,
          condition: result.condition,
          escalation: result.escalation,
        });
      } else {
        onError(
          result.error === "AI_PROVIDER_TIMEOUT"
            ? "The AI provider timed out after 60 seconds. Please try again."
            : "The AI provider is unavailable. Please try again later.",
        );
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to prepare the triage quiz.");
    }
  };

  const updateSymptoms = (value: string) => {
    setSymptoms(value);
    syncedTranscriptLength.current = transcript.length;
  };

  return (
    <>
      <form
        className="workspace-panel rounded-2xl border border-white/15 bg-zinc-900 p-4"
        onSubmit={handleSubmit}
      >
        <div className="mb-3">
          <p className="mb-1 text-[9px] font-medium text-emerald-300">01 / intake</p>
          <h1 className="text-base font-medium tracking-tight">Discovery</h1>
        </div>
        {reportsSubmitted ? (
          <div className="rounded-xl border border-emerald-300/25 bg-emerald-300/10 p-3">
            <p className="text-xs font-medium text-emerald-100">Analysis complete</p>
            <p className="mt-1 text-[10px] leading-relaxed text-white/60">
              Your AI-driven triage is saved. Re-run the analysis to submit new symptoms or reports.
            </p>
            <button
              className={`${interactive} mt-3 w-full rounded-lg border border-emerald-300/50 px-3 py-2 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-300/15`}
              onClick={resetIntake}
              type="button"
            >
              Re-run analysis
            </button>
          </div>
        ) : (
          <>
        <div className="space-y-3">
          {(["scan", "prescription"] as const).map((category) => (
            <ReportDropzone
              category={category}
              files={category === "scan" ? scanFiles : prescriptionFiles}
              isDragging={draggingZone === category}
              key={category}
              onDragChange={(dragging) => setDraggingZone(dragging ? category : null)}
              onFiles={(files) => acceptReports(files, category)}
              onRemove={removeFile}
            />
          ))}
        </div>
        {uploadNotice ? (
          <p className="mt-2 text-[10px] text-amber-100/85" role="status">
            {uploadNotice}
          </p>
        ) : null}
        {hasPrescription ? (
          <div className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2.5 text-[10px] leading-relaxed text-emerald-100/85">
            <p className="font-semibold text-emerald-200">Prescription provided</p>
            <p className="mt-1">The analysis will follow your clinician&apos;s guidance and limits.</p>
          </div>
        ) : (
          <label
            className={`${interactive} mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[10px] leading-relaxed ${
              disclaimerAccepted
                ? "border-amber-300/20 bg-amber-300/5 text-amber-100/75"
                : "border-amber-300/40 bg-amber-300/10 text-amber-100/90"
            }`}
            htmlFor="ai-disclaimer"
          >
            <input
              checked={disclaimerAccepted}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-amber-300"
              id="ai-disclaimer"
              onChange={(event) => setDisclaimerAccepted(event.target.checked)}
              required
              type="checkbox"
            />
            <span>
              <span className="block font-semibold text-amber-200">No prescription uploaded</span>
              <span className="mt-1 block">{AI_DISCLAIMER_TEXT}</span>
            </span>
          </label>
        )}
        <label className="mt-3 block text-xs text-white/85" htmlFor="symptoms">
          Describe your symptoms
        </label>
        <div className="relative mt-2">
          <textarea
            className="min-h-28 w-full resize-y rounded-xl border border-white/15 bg-zinc-950 p-3 pr-12 text-sm leading-relaxed text-white outline-none placeholder:text-white/45 focus:border-emerald-300/60"
            id="symptoms"
            name="primarySymptoms"
            onChange={(event) => updateSymptoms(event.target.value)}
            placeholder="Share what the patient is feeling..."
            value={symptoms}
          />
          <button
            aria-label={isDictating ? "Stop voice dictation" : "Start voice dictation"}
            aria-pressed={isDictating}
            className={`${interactive} absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border ${
              isDictating
                ? "motion-safe:animate-pulse motion-reduce:animate-none border-red-300/70 bg-red-400/20 text-red-200"
                : "border-white/15 bg-white/10 text-white/65 hover:border-emerald-300/60 hover:text-emerald-200"
            }`}
            onClick={isDictating ? stopListening : startListening}
            type="button"
          >
            {isDictating ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[10px] text-white/60">
            {selectedFiles.length > 0
              ? [
                  scanFiles.length > 0 && `${scanFiles.length} scan${scanFiles.length === 1 ? "" : "s"}`,
                  prescriptionFiles.length > 0 &&
                    `${prescriptionFiles.length} prescription${prescriptionFiles.length === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ") + " ready"
              : hasPrescription || disclaimerAccepted
                ? "Uploads are optional"
                : "Confirm the note above to continue"}
          </span>
          <button
            className={`${interactive} shrink-0 rounded-lg bg-emerald-300 px-3 py-2 text-[10px] font-semibold text-black hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!canSubmit}
            type="submit"
          >
            {reportsSubmitted ? "Triage started" : "Start diagnostic"}
          </button>
        </div>
        {flowError && flowPhase === "discovery" ? (
          <p className="mt-3 rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-[10px] text-red-100">
            {flowError}
          </p>
        ) : null}
          </>
        )}
      </form>

      {summary}

      <section className={`workspace-panel rounded-2xl border border-white/15 bg-zinc-900 p-4 ${!reportsSubmitted ? "opacity-65" : ""}`}>
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-[9px] font-medium text-emerald-300">Adaptive intake</p>
            <h2 className="text-base font-medium tracking-tight">Cross-questioning</h2>
          </div>
          <span className="rounded-md bg-emerald-300/15 px-2 py-1 font-mono text-[9px] text-emerald-300">
            {reportsSubmitted ? "AI ready" : "Locked"}
          </span>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-white/85">
          {reportsSubmitted
            ? "Your tailored triage questions are ready."
            : "Submit symptoms to generate adaptive questions."}
        </p>
      </section>
    </>
  );
}

type QuizModalProps = {
  triageQuiz: InitialQuiz;
  quizAnswers: Record<string, string>;
  flowError: string | null;
  onAnswer: (questionId: string, answer: string) => void;
  onComplete: () => void;
  quizComplete: boolean;
};

export const QuizModal = memo(function QuizModal({
  triageQuiz,
  quizAnswers,
  flowError,
  onAnswer,
  onComplete,
  quizComplete,
}: QuizModalProps) {
  return (
    <section aria-labelledby="triage-quiz-title" aria-modal="true" className="workspace-dialog max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl border border-emerald-200/25 bg-zinc-900 p-6 sm:p-8" role="dialog">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium text-emerald-300">Diagnostic triage</p>
          <h2 className="mt-2 text-2xl font-medium tracking-tight" id="triage-quiz-title">
            A few questions before your plan
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
            Your answers help SomaCue set safer movement boundaries and tailor the 3D routine.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-[10px] text-white/60">
          {triageQuiz.questions.length} questions
        </span>
      </div>
      <div className="mt-7 space-y-5">
        {triageQuiz.questions.map((question, index) => {
          const options = question.options?.length ? question.options : ["Yes", "Not Sure", "No"];
          return (
            <fieldset className="rounded-2xl border border-white/10 bg-zinc-950 p-4" key={question.id}>
              <legend className="max-w-full px-1 text-sm leading-relaxed text-white/90">
                <span className="mr-2 font-mono text-[10px] text-emerald-300">{String(index + 1).padStart(2, "0")}</span>
                {question.question}
              </legend>
              {question.answerType === "short_text" ? (
                <textarea
                  className="mt-3 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-300/60"
                  onChange={(event) => onAnswer(question.id, event.target.value)}
                  placeholder="Share a brief description..."
                  value={quizAnswers[question.id] ?? ""}
                />
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {options.map((option) => (
                    <button
                      className={`${interactive} rounded-xl border px-3 py-2.5 text-left text-xs ${
                        quizAnswers[question.id] === option
                          ? "border-emerald-300/70 bg-emerald-300/15 text-emerald-100"
                          : "border-white/10 bg-black/20 text-white/65 hover:border-emerald-300/50 hover:text-white"
                      }`}
                      key={option}
                      onClick={() => onAnswer(question.id, option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
      {flowError ? (
        <p className="mt-4 rounded-xl border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs text-red-100">
          {flowError}
        </p>
      ) : null}
      <div className="mt-6 flex items-center justify-between gap-4">
        <p className="text-[10px] text-white/45">{Object.keys(quizAnswers).length} of {triageQuiz.questions.length} answered</p>
        <button className={`${interactive} rounded-xl bg-emerald-300 px-4 py-3 text-xs font-semibold text-black hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-35`} disabled={!quizComplete} onClick={onComplete} type="button">
          Generate my movement plan
        </button>
      </div>
    </section>
  );
});
