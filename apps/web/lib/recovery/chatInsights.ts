import type { ChatCategory } from "./timeline";

/*
 * Picks the clinically useful statement out of a Rehab Companion message, for the Recovery Timeline.
 * Plain rules, no AI call: it costs no tokens and no time, and it runs on the message the patient
 * already sent. Questions, chit-chat and anything that is not the patient describing their own body
 * or movement return null, so the timeline stays a clinical record.
 */

export type ChatInsight = { category: ChatCategory; text: string };

const MAX_SENTENCE_CHARS = 280;
const MIN_SENTENCE_CHARS = 8;

const FIRST_PERSON = /\b(i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|me|my|mine|myself)\b/i;
const QUESTION_START = /^(can|could|should|would|is|are|am|do|does|did|how|what|why|when|where|which|who|will|may|might|shall|any tips?|any advice)\b/i;
const HYPOTHETICAL = /^(what if|suppose|imagine|hypothetically|in case|if only)\b/i;

/** Symptom words. Neurological ones matter on their own; the rest need a sign that they are new. */
const NEURO = /\b(numb(?:ness)?|tingl\w*|pins and needles|burning|shooting|electric(?:al)?|weakness|weak|giving way|gave way|buckl\w*|foot drop|radiat\w*|sciatica)\b/i;
const SYMPTOM = /\b(pain\w*|ache\w*|aching|hurt\w*|sore\w*|stiff\w*|swell\w*|swollen|cramp\w*|spasm\w*|clicking|popping|locking|locked|throb\w*|sharp|tight\w*|inflam\w*|bruis\w*|dizz\w*|headache|nausea)\b/i;
const NOVEL = /\b(new|started|starting|began|begun|noticed|developed|developing|since (?:yesterday|today|last|the)|also|another|suddenly|just (?:started|noticed|got|began)|now (?:have|feel|get|got)|first time)\b/i;

const MOVEMENT =
  /\b(bend\w*|squat\w*|lift\w*|walk\w*|stairs?|climb\w*|sit\w*|stand\w*|twist\w*|rotat\w*|reach\w*|sleep\w*|roll\w*|kneel\w*|run\w*|jog\w*|driv\w*|carry\w*|pick\w* up|put\w* on|get\w* (?:up|out|in)|turn\w*|stretch\w*|pelvic|bridge|cat.?cow|heel slide|ankle pump|squeeze|exercis\w*|move\w*|movement|knee|hip|back|neck|shoulder|leg|arm|foot|ankle)\b/i;
const DIFFICULTY = /\b(can't|can’t|cannot|couldn't|couldn’t|unable|struggl\w*|difficult\w*|hard to|trouble|tough|impossible|find it hard|painful to|hurts? to)\b/i;
const TRIGGER = /\b(when|while|after|during|whenever|every time|each time|if i|once i)\b/i;
const WORSE = /\b(worse|worsen\w*|getting worse|got worse|increas\w*|more pain|spread\w*|flar\w*|sharper|intense|aggravat\w*|escalat\w*|unbearable|can't bear)\b/i;
const BETTER =
  /\b(better|improv\w*|less (?:pain|sore|stiff|tight)|reduced|easier|stronger|relief|relieved|no longer|not (?:hurt\w*|painful) anymore|stopped hurting|pain[- ]free|gone|back to normal|able to|can now|managed to|finally (?:able|can)|can\s+\w+(?:\s+\w+){0,3}\s+(?:now|again|without (?:pain|help)))\b/i;
const NEGATION_BEFORE_SYMPTOM = new RegExp(
  `\\b(no|not|without|never|nothing|none|isn't|isn’t|aren't|don't have|don’t have|doesn't have|haven't had|haven’t had|free of)\\b(?:\\s+\\w+){0,3}?\\s+(?:${NEURO.source}|${SYMPTOM.source})`,
  "i",
);

function sentencesOf(message: string): string[] {
  return message
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_CHARS)
    .map((sentence) => (sentence.length > MAX_SENTENCE_CHARS ? `${sentence.slice(0, MAX_SENTENCE_CHARS - 1).trimEnd()}…` : sentence));
}

/** Safety first: a worse sign outranks a trigger, which outranks a new symptom, then an improvement. */
const PRIORITY: ChatCategory[] = ["worsening", "movement_difficulty", "pain_trigger", "new_symptom", "improvement"];

function categoryOf(sentence: string): ChatCategory | null {
  if (sentence.endsWith("?") || QUESTION_START.test(sentence) || HYPOTHETICAL.test(sentence)) return null;
  if (!FIRST_PERSON.test(sentence)) return null;

  const hasSymptom = NEURO.test(sentence) || SYMPTOM.test(sentence);
  const negated = NEGATION_BEFORE_SYMPTOM.test(sentence);
  const hasMovement = MOVEMENT.test(sentence);

  if (BETTER.test(sentence) && (hasSymptom || hasMovement) && !WORSE.test(sentence)) return "improvement";
  // "No pain" is not a symptom. "Can't bend without pain" is trouble with a movement, so it stays.
  if (negated && !WORSE.test(sentence) && !DIFFICULTY.test(sentence)) return null;

  if (WORSE.test(sentence) && (hasSymptom || hasMovement)) return "worsening";
  if (DIFFICULTY.test(sentence) && hasMovement) return "movement_difficulty";
  if (hasSymptom && TRIGGER.test(sentence) && hasMovement) return "pain_trigger";
  if (NEURO.test(sentence)) return "new_symptom";
  if (SYMPTOM.test(sentence) && NOVEL.test(sentence)) return "new_symptom";
  return null;
}

/**
 * The most useful statement in a message, or null when there is none. At most one insight per message,
 * with the patient's own words kept so a clinician reads what was actually said.
 */
export function extractChatInsight(message: string): ChatInsight | null {
  let best: ChatInsight | null = null;
  for (const sentence of sentencesOf(message)) {
    const category = categoryOf(sentence);
    if (!category) continue;
    if (!best || PRIORITY.indexOf(category) < PRIORITY.indexOf(best.category)) best = { category, text: sentence };
  }
  return best;
}
