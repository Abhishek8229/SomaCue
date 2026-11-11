"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import styles from "./PatientIntake.module.css";

export type IntakeStep = "upload" | "processing" | "screening";

export interface RedFlagQuestion {
  id: string;
  text: string;
  detail?: string;
}

export interface RedFlagAnswer {
  questionId: string;
  questionText: string;
  response: "yes" | "no";
}

export interface PatientIntakeResult {
  report: string;
  answers: RedFlagAnswer[];
  emergencyFlagged: boolean;
}

export interface PatientIntakeProps {
  initialReport?: string;
  redFlagQuestions?: readonly RedFlagQuestion[];
  emergencyPhoneNumber?: string;
  onScreeningComplete?: (result: PatientIntakeResult) => void;
  onProcessReport?: (report: string) => Promise<void>;
  onEmergencyFlag?: (question: RedFlagQuestion, answer: RedFlagAnswer) => void;
  className?: string;
}

const DEFAULT_RED_FLAG_QUESTIONS: readonly RedFlagQuestion[] = [
  {
    id: "bowel-bladder-control",
    text: "Have you experienced any sudden loss of bowel or bladder control?",
    detail:
      "Sudden loss of control can indicate cauda equina syndrome, which needs emergency surgery.",
  },
  {
    id: "saddle-anaesthesia",
    text: "Have you noticed numbness in the saddle area, including the inner thighs, genitals or buttocks?",
  },
  {
    id: "progressive-leg-weakness",
    text: "Have you had progressively worsening weakness in one or both legs?",
  },
  {
    id: "cancer-weight-loss",
    text: "Have you had unexplained weight loss, or a history of cancer with new back pain?",
  },
];

const PROCESSING_DURATION_MS = 1800;

const STEPS: readonly { id: IntakeStep; label: string }[] = [
  { id: "upload", label: "Report" },
  { id: "processing", label: "Extraction" },
  { id: "screening", label: "Screening" },
];

export function PatientIntake({
  initialReport = "",
  redFlagQuestions = DEFAULT_RED_FLAG_QUESTIONS,
  emergencyPhoneNumber,
  onScreeningComplete,
  onProcessReport,
  onEmergencyFlag,
  className,
}: PatientIntakeProps) {
  const [step, setStep] = useState<IntakeStep>("upload");
  const [report, setReport] = useState(initialReport);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<RedFlagAnswer[]>([]);
  const [emergency, setEmergency] = useState<RedFlagAnswer | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);

  const canSubmit = report.trim().length > 0;
  const screeningComplete = questionIndex >= redFlagQuestions.length;
  const currentQuestion = redFlagQuestions[questionIndex];
  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  useEffect(() => {
    if (step !== "processing") return;
    let cancelled = false;
    const processReport = async () => {
      try {
        await new Promise((resolve) => window.setTimeout(resolve, PROCESSING_DURATION_MS));
        await onProcessReport?.(report.trim());
        if (!cancelled) setStep("screening");
      } catch {
        if (!cancelled) setProcessingError("The report could not be safely processed. Please try again.");
      }
    };
    void processReport();
    return () => {
      cancelled = true;
    };
  }, [onProcessReport, report, step]);

  const handleReportChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setReport(event.target.value);
  };

  const handleSubmitReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setProcessingError(null);
    setStep("processing");
  };

  const handleAnswer = (response: RedFlagAnswer["response"]) => {
    if (!currentQuestion || emergency) return;

    const answer: RedFlagAnswer = {
      questionId: currentQuestion.id,
      questionText: currentQuestion.text,
      response,
    };

    if (response === "yes") {
      setAnswers((previous) => [...previous, answer]);
      setEmergency(answer);
      onEmergencyFlag?.(currentQuestion, answer);
      return;
    }

    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setQuestionIndex((index) => index + 1);
    if (questionIndex + 1 >= redFlagQuestions.length) {
      onScreeningComplete?.({
        report: report.trim(),
        answers: nextAnswers,
        emergencyFlagged: false,
      });
    }
  };

  const handleRestart = () => {
    setStep("upload");
    setReport("");
    setQuestionIndex(0);
    setAnswers([]);
    setEmergency(null);
  };

  return (
    <section
      className={`${styles.shell} ${className ?? ""}`.trim()}
      aria-label="Patient intake and safety screening"
    >
      <header className={styles.header}>
        <p className={styles.kicker}>Patient intake</p>
        <h2 className={styles.title}>Safety screening</h2>
        <ol className={styles.stepper} aria-label="Intake progress">
          {STEPS.map((item, index) => {
            const state =
              index === stepIndex ? "active" : index < stepIndex ? "complete" : "todo";
            return (
              <li key={item.id} className={styles.step}>
                <span
                  className={styles.stepIndex}
                  data-state={state}
                  aria-current={state === "active" ? "step" : undefined}
                >
                  {index + 1}
                </span>
                <span className={styles.stepLabel} data-state={state}>
                  {item.label}
                </span>
                {index < STEPS.length - 1 && (
                  <span className={styles.stepConnector} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </header>

      <div className={styles.body}>
        {step === "upload" && (
          <UploadStep
            report={report}
            canSubmit={canSubmit}
            onChange={handleReportChange}
            onSubmit={handleSubmitReport}
          />
        )}
        {step === "processing" && (
          <ProcessingStep error={processingError} onRestart={handleRestart} />
        )}
        {step === "screening" && (
          <ScreeningStep
            questions={redFlagQuestions}
            questionIndex={questionIndex}
            emergency={emergency}
            screeningComplete={screeningComplete}
            emergencyPhoneNumber={emergencyPhoneNumber}
            onAnswer={handleAnswer}
            onRestart={handleRestart}
          />
        )}
      </div>
    </section>
  );
}

interface UploadStepProps {
  report: string;
  canSubmit: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function UploadStep({ report, canSubmit, onChange, onSubmit }: UploadStepProps) {
  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="patient-report" className={styles.label}>
          MRI / medical report
        </label>
        <textarea
          id="patient-report"
          name="report"
          rows={12}
          required
          value={report}
          onChange={onChange}
          aria-describedby="patient-report-hint"
          placeholder="Paste the radiology report or relevant clinical notes here."
          className={styles.textarea}
        />
        <p id="patient-report-hint" className={styles.hint}>
          Extracted entities are used only to guide this screening.
        </p>
      </div>
      <button type="submit" disabled={!canSubmit} className={styles.primary}>
        Submit for Analysis
      </button>
    </form>
  );
}

function ProcessingStep({
  error,
  onRestart,
}: {
  error: string | null;
  onRestart: () => void;
}) {
  if (error) {
    return (
      <div className={styles.processing} role="alert">
        <p className={styles.processingText}>{error}</p>
        <button type="button" onClick={onRestart} className={styles.primary}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={styles.processing} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <p className={styles.processingText}>Extracting clinical entities...</p>
      <p className={styles.hint}>This usually takes a few seconds.</p>
    </div>
  );
}

interface ScreeningStepProps {
  questions: readonly RedFlagQuestion[];
  questionIndex: number;
  emergency: RedFlagAnswer | null;
  screeningComplete: boolean;
  emergencyPhoneNumber?: string;
  onAnswer: (response: RedFlagAnswer["response"]) => void;
  onRestart: () => void;
}

function ScreeningStep({
  questions,
  questionIndex,
  emergency,
  screeningComplete,
  emergencyPhoneNumber,
  onAnswer,
  onRestart,
}: ScreeningStepProps) {
  if (emergency) {
    return (
      <EmergencyBanner
        answer={emergency}
        phoneNumber={emergencyPhoneNumber}
        onRestart={onRestart}
      />
    );
  }

  if (screeningComplete) {
    return <CompletionPanel onRestart={onRestart} />;
  }

  const question = questions[questionIndex];
  if (!question) return null;

  const progress = Math.round(((questionIndex + 1) / questions.length) * 100);

  return (
    <div className={styles.screening}>
      <div className={styles.progressGroup}>
        <div className={styles.progressMeta}>
          <span>
            Question {questionIndex + 1} of {questions.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <fieldset className={styles.question}>
        <legend className={styles.questionText}>{question.text}</legend>
        {question.detail ? (
          <p className={styles.questionDetail}>{question.detail}</p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => onAnswer("yes")}
            className={styles.danger}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onAnswer("no")}
            className={styles.safe}
          >
            No
          </button>
        </div>
      </fieldset>

      <p className={styles.hint}>
        Answer honestly. A red-flag response stops the screening and shows urgent guidance.
      </p>
    </div>
  );
}

interface EmergencyBannerProps {
  answer: RedFlagAnswer;
  phoneNumber?: string;
  onRestart: () => void;
}

function EmergencyBanner({ answer, phoneNumber, onRestart }: EmergencyBannerProps) {
  return (
    <div role="alert" className={styles.banner}>
      <div className={styles.bannerHead}>
        <span className={styles.bannerIcon} aria-hidden="true">
          !
        </span>
        <div>
          <p className={styles.bannerTitle}>Red flag identified</p>
          <p className={styles.bannerQuestion}>{answer.questionText}</p>
        </div>
      </div>

      <p className={styles.bannerBody}>
        This response may indicate a condition that needs emergency assessment. Do not wait for
        an appointment. Call emergency services or go to your nearest emergency department now.
      </p>

      <div className={styles.bannerActions}>
        {phoneNumber ? (
          <a href={`tel:${phoneNumber}`} className={styles.bannerCall}>
            Call {phoneNumber}
          </a>
        ) : null}
        <button type="button" onClick={onRestart} className={styles.bannerRestart}>
          Start over
        </button>
      </div>
    </div>
  );
}

interface CompletionPanelProps {
  onRestart: () => void;
}

function CompletionPanel({ onRestart }: CompletionPanelProps) {
  return (
    <div className={styles.completion}>
      <p className={styles.completionTitle}>No red flags reported</p>
      <p className={styles.completionBody}>
        The screening is complete. A clinician reviews the extracted findings before any
        exercise is assigned.
      </p>
      <button type="button" onClick={onRestart} className={styles.completionAction}>
        Start a new intake
      </button>
    </div>
  );
}
