/**
 * Status copy for the two AI wait screens in the workspace.
 *
 * Each sequence is built once when a wait starts, from what the patient
 * actually told us, and is read top to bottom without ever looping.
 */

export type IntakeSnapshot = {
  symptoms: string;
  /** Medical scans / imaging. */
  scanCount: number;
  /** Clinical prescriptions and notes from a clinician. */
  prescriptionCount: number;
  /** Files from reports created before uploads were categorized. */
  otherCount?: number;
};

export type QuizAnswerSnapshot = {
  question: string;
  answer: string;
  multipleChoice: boolean;
};

export type AnalysisCopy = {
  lines: string[];
  holdMessage: string;
  /** Short tags shown under the title, e.g. "Right knee", "2 reports". */
  context: string[];
};

type BodyArea = {
  label: string;
  structure: string;
  pattern: RegExp;
};

// Ordered from most to least specific so "lower back" wins over "back".
const BODY_AREAS: BodyArea[] = [
  { label: "lower back", structure: "lumbar segmental loading", pattern: /\b(lower|low)\s+back\b|\blumbar\b|\bsciatic/i },
  { label: "upper back", structure: "thoracic mobility", pattern: /\bupper\s+back\b|\bthoracic\b|\bshoulder\s+blades?\b/i },
  { label: "neck", structure: "cervical posture and nerve-root signs", pattern: /\bneck\b|\bcervical\b/i },
  { label: "shoulder", structure: "rotator cuff and shoulder-blade rhythm", pattern: /\bshoulders?\b|\brotator\s+cuff\b/i },
  { label: "elbow", structure: "forearm tendon load at the elbow", pattern: /\belbows?\b|\btennis\s+elbow\b/i },
  { label: "wrist", structure: "wrist and forearm tendon load", pattern: /\bwrists?\b|\bhands?\b|\bfingers?\b|\bcarpal\b/i },
  { label: "hip", structure: "hip joint and gluteal loading", pattern: /\bhips?\b|\bgroin\b|\bgluteal?\b/i },
  { label: "knee", structure: "patellofemoral and tibiofemoral loading", pattern: /\bknees?\b|\bpatell|\bmenisc|\bacl\b/i },
  { label: "hamstring", structure: "posterior-thigh muscle load", pattern: /\bhamstrings?\b/i },
  { label: "calf", structure: "calf and Achilles loading", pattern: /\bcalf\b|\bcalves\b|\bachilles\b|\bshins?\b/i },
  { label: "ankle", structure: "ankle stability and ligament load", pattern: /\bankles?\b/i },
  { label: "foot", structure: "plantar fascia and arch loading", pattern: /\bfoot\b|\bfeet\b|\bheels?\b|\bplantar\b/i },
  { label: "back", structure: "spinal loading", pattern: /\bback\b|\bspine\b/i },
];

type Trigger = {
  /** Fits "pain during ___". */
  during: string;
  /** Fits "your ___ tolerance"; null when it would read badly. */
  tolerance: string | null;
  chip: string;
  pattern: RegExp;
};

const TRIGGERS: Trigger[] = [
  { during: "long walks", tolerance: "walking distance", chip: "Long walks", pattern: /\blong\s+walks?\b/i },
  { during: "walking", tolerance: "walking", chip: "Walking", pattern: /\bwalk(ing|s)?\b/i },
  { during: "running", tolerance: "running", chip: "Running", pattern: /\brun(ning|s)?\b|\bjog(ging)?\b/i },
  { during: "stairs", tolerance: "stair-climbing", chip: "Stairs", pattern: /\bstairs?\b/i },
  { during: "prolonged sitting", tolerance: "sitting", chip: "Sitting", pattern: /\bsit(ting|s)?\b|\bdesk\b/i },
  { during: "standing", tolerance: "standing", chip: "Standing", pattern: /\bstand(ing|s)?\b/i },
  { during: "lifting", tolerance: "lifting", chip: "Lifting", pattern: /\blift(ing|s)?\b|\bcarry(ing)?\b/i },
  { during: "squatting or kneeling", tolerance: "deep-bending", chip: "Squatting", pattern: /\bsquat(ting|s)?\b|\bkneel(ing)?\b/i },
  { during: "overhead reaching", tolerance: "overhead", chip: "Overhead reaching", pattern: /\boverhead\b|\breach(ing)?\b/i },
  { during: "sleep", tolerance: null, chip: "Night pain", pattern: /\bsleep(ing)?\b|\bnight\b/i },
  { during: "the morning", tolerance: null, chip: "Mornings", pattern: /\bmornings?\b/i },
];

type Quality = "stiffness" | "neural" | "swelling" | "instability" | "sharp";

const QUALITIES: { quality: Quality; pattern: RegExp }[] = [
  { quality: "neural", pattern: /\bnumb(ness)?\b|\btingl|\bpins\s+and\s+needles\b|\bradiat|\bshooting\b/i },
  { quality: "swelling", pattern: /\bswell|\bswollen\b|\binflam/i },
  { quality: "instability", pattern: /\bgiv(es|ing)\s+way\b|\bunstable\b|\block(s|ing)?\b|\bclick/i },
  { quality: "sharp", pattern: /\bsharp\b|\bstabbing\b/i },
  { quality: "stiffness", pattern: /\bstiff/i },
];

const PAIN_SCORE = /\b(10|[0-9])\s*(?:\/|out\s+of)\s*10\b/i;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detectSide(text: string) {
  const left = /\bleft\b/i.test(text);
  const right = /\bright\b/i.test(text);
  if (/\bboth\b|\bbilateral/i.test(text) || (left && right)) return "both";
  if (left) return "left";
  if (right) return "right";
  return null;
}

export function describeBodyArea(symptoms: string) {
  const area = BODY_AREAS.find((entry) => entry.pattern.test(symptoms));
  if (!area) return null;

  const side = detectSide(symptoms);
  const label =
    side === "both" ? `${area.label}s on both sides` : side ? `${side} ${area.label}` : area.label;
  return { label, structure: area.structure };
}

function detectTrigger(text: string) {
  return TRIGGERS.find((entry) => entry.pattern.test(text)) ?? null;
}

function detectQuality(text: string) {
  return QUALITIES.find((entry) => entry.pattern.test(text))?.quality ?? null;
}

function fileCounts(intake: IntakeSnapshot | null) {
  const scans = intake?.scanCount ?? 0;
  const prescriptions = intake?.prescriptionCount ?? 0;
  const other = intake?.otherCount ?? 0;
  return { scans, prescriptions, other, total: scans + prescriptions + other };
}

function fileChips(counts: ReturnType<typeof fileCounts>) {
  return [
    counts.scans > 0 && plural(counts.scans, "scan"),
    counts.prescriptions > 0 && plural(counts.prescriptions, "prescription"),
    counts.other > 0 && plural(counts.other, "report"),
  ];
}

function unique(lines: (string | null | false | undefined)[]) {
  return [...new Set(lines.filter((line): line is string => Boolean(line)))];
}

const QUALITY_LINES: Record<Quality, string> = {
  neural: "Screening the numbness and tingling you mentioned for nerve involvement…",
  swelling: "Separating the swelling you described from mechanical irritation…",
  instability: "Assessing the catching or giving way you described…",
  sharp: "Characterizing the sharp pain you described…",
  stiffness: "Separating stiffness patterns from signs of inflammation…",
};

export function buildTriageCopy(intake: IntakeSnapshot): AnalysisCopy {
  const symptoms = intake.symptoms.trim();
  const area = describeBodyArea(symptoms);
  const trigger = detectTrigger(symptoms);
  const quality = detectQuality(symptoms);
  const files = fileCounts(intake);
  const where = area ? `your ${area.label}` : "the area you described";

  const lines = unique([
    files.total > 0
      ? `Opening ${files.total === 1 ? "your uploaded file" : `your ${files.total} uploaded files`}…`
      : "Reading your symptom description closely…",
    files.scans > 0 &&
      `Studying detail in ${files.scans === 1 ? "your scan" : `your ${files.scans} scans`}…`,
    files.prescriptions > 0 &&
      `Reading ${files.prescriptions === 1 ? "your clinician's prescription" : `your ${files.prescriptions} prescriptions and notes`}…`,
    files.other > 0 &&
      `Extracting clinical findings from ${files.other === 1 ? "your report" : `your ${files.other} reports`}…`,
    `Locating ${where} on the anatomical map…`,
    trigger && area
      ? `Relating pain during ${trigger.during} to ${area.structure}…`
      : area
        ? `Profiling ${area.structure}…`
        : "Profiling the joints and soft tissue involved…",
    quality && QUALITY_LINES[quality],
    files.prescriptions > 0
      ? "Aligning with the guidance in your clinician's notes…"
      : files.total > 0 && "Cross-referencing your files with what you described…",
    files.prescriptions === 0 &&
      "Applying extra caution, since no clinician's prescription was provided…",
    files.prescriptions > 0
      ? "Identifying your condition from your clinician's notes first…"
      : files.scans > 0
        ? "Inferring the most likely condition from your scans and symptoms…"
        : "Inferring the most likely condition from your description…",
    "Checking whether your case is safe for guided online rehab…",
    "Choosing the questions that will narrow down your case…",
    "Writing your follow-up questions…",
  ]);

  return {
    lines,
    holdMessage:
      "This is taking a little longer than expected. Your case is still being reviewed, so please wait a moment.",
    context: unique([
      area && capitalize(area.label),
      ...(files.total > 0 ? fileChips(files) : ["Symptom description"]),
      trigger?.chip,
    ]),
  };
}

function quotableAnswer(answers: QuizAnswerSnapshot[]) {
  const candidates = answers
    .map((entry) => ({ ...entry, answer: entry.answer.replace(/\s+/g, " ").trim() }))
    .filter(
      (entry) =>
        entry.answer.length >= 4 &&
        entry.answer.length <= 42 &&
        !/^(yes|no|none|n\/a|not sure|maybe)\.?$/i.test(entry.answer),
    );
  // Multiple-choice answers read cleanly in a sentence; free text second.
  return (
    candidates.find((entry) => entry.multipleChoice)?.answer ?? candidates[0]?.answer ?? null
  );
}

export function buildSynthesisCopy(
  intake: IntakeSnapshot | null,
  answers: QuizAnswerSnapshot[],
): AnalysisCopy {
  const answered = answers.filter((entry) => entry.answer.trim().length > 0);
  const allText = [intake?.symptoms ?? "", ...answered.map((entry) => entry.answer)].join(" ");
  const area = describeBodyArea(intake?.symptoms ?? "") ?? describeBodyArea(allText);
  const trigger = detectTrigger(allText);
  const painScore = allText.match(PAIN_SCORE)?.[1] ?? null;
  const quote = quotableAnswer(answered);
  const files = fileCounts(intake);
  const areaName = area ? `your ${area.label}` : "the affected area";

  const lines = unique([
    answered.length > 0
      ? `Reading your ${plural(answered.length, "answer")} alongside your intake…`
      : "Reading your triage answers alongside your intake…",
    quote && `Weighing your answer “${quote}”…`,
    painScore && `Factoring in the pain level of ${painScore}/10 you reported…`,
    area
      ? `Re-checking ${area.structure} against your answers…`
      : "Re-checking the initial findings against your answers…",
    files.prescriptions > 0 && "Keeping every exercise within your clinician's prescription…",
    files.scans > 0 &&
      `Cross-checking exercise options against ${files.scans === 1 ? "your scan" : `your ${files.scans} scans`}…`,
    files.other > 0 && `Cross-checking exercise options against your ${plural(files.other, "report")}…`,
    `Setting safe range-of-motion limits for ${areaName}…`,
    trigger?.tolerance
      ? `Calibrating starting load to your ${trigger.tolerance} tolerance…`
      : "Calibrating starting load to your current tolerance…",
    "Selecting exercises that stay inside your pain boundaries…",
    "Ruling out movements that could aggravate your symptoms…",
    "Sequencing sets, reps and rest for your first week…",
    "Mapping movement cues to the 3D anatomical stage…",
    "Shaping a month-by-month progression…",
    "Running a final safety review of your plan…",
    "Finalizing your treatment plan…",
  ]);

  return {
    lines,
    holdMessage:
      "This is taking a little longer than expected. Your plan is still being put together, so please wait a moment.",
    context: unique([
      area && capitalize(area.label),
      answered.length > 0 && plural(answered.length, "answer"),
      ...fileChips(files),
    ]),
  };
}
