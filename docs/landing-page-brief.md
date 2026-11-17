# SomaCue landing page brief

A factual audit of what the SomaCue codebase does today, written to guide the SaaS landing page build. Everything here is taken from the code in `apps/web` and `prisma/`. Where something is a placeholder, unbuilt or unused, it says so.

Audit date: 2026-11-19. Paths are relative to `apps/web/` unless they start with `prisma/` or `docs/`.

**Rules for landing page copy**

- There are no usage stats, outcome data, accuracy figures, customer logos or testimonials anywhere in the code. Do not add any.
- Nothing is clinically validated. The app labels itself a prototype: the stage shows "Prototype · ranges not clinically reviewed" (`components/stage/StageV2.tsx`), the page metadata says "Stage 4 prototype" (`app/layout.tsx`), and the urgent-care notice is marked "Draft wording: needs clinical and legal review before public rollout" (`components/stage/SafetyNotice.tsx`).
- No compliance work exists (no HIPAA, GDPR, CE/FDA, SOC 2 code or docs). Do not claim any.
- The AI is not a diagnosis. The product's own wording is "AI-generated assessment, not a medical diagnosis. Confirm it with a clinician." (`components/workspace/ConditionCard.tsx`). Use the same framing.

---

## 1. Core value proposition and end-to-end user flow

### What the product is, in its own words

The live home page (`app/page.tsx`) positions SomaCue as "one interactive 3D workspace" that brings "anatomy, movement, and clinical safety" together "for better rehabilitation conversations". The working product is a patient-facing, AI-assisted home-rehab workspace. The patient uploads reports, answers adaptive questions, gets an AI-identified condition with its evidence source and a safety verdict, then follows a multi-month plan demonstrated by a 3D figure. Daily feedback and Pain Override reports reshape the plan, and repeated problems lock the platform and send the patient to in-person care.

Note: the current home page copy talks about "anatomy exploration" and selecting regions to "reveal the structures beneath". The live workspace has no anatomy-exploration feature; that belongs to the experimental `/3d-lab` route (see section 5). The new landing page should describe the workspace flow below.

### End-to-end flow (as built)

All steps happen on `/workspace` (`app/workspace/WorkspaceClient.tsx`, `app/workspace/WorkspaceParts.tsx`), which requires sign-in.

**Step 0. Account.** Email, password (minimum 8 characters) and full name at `/register`. Every new account gets the role `patient` (`app/api/auth/register/route.ts`).

**Step 1. 01 / Intake ("Discovery" panel, left sidebar).**
- Two separate multi-file upload areas, each accepting images and PDFs, up to 10 files per area:
  - "Medical scans / imaging": "MRI, X-ray, CT scan or other diagnostic imaging".
  - "Clinical prescriptions & notes": "Prescriptions, assessment notes or reports from a doctor, physio or other clinician".
- Files upload as soon as they're added (Azure Blob storage, or a local fallback), each with an upload status.
- "Describe your symptoms" text box with a microphone button for voice dictation (browser speech recognition, `en-US`, `hooks/useDictation.ts`).
- With no prescription uploaded, a required checkbox appears (see section 2). The button reads **Start diagnostic**.

**Step 2. Diagnostic triage wait screen.** A full-screen progress card (`components/workspace/AnalysisProgress.tsx`) with:
- a ring that eases toward 95% and finishes to 100% when the AI responds;
- status lines personalised from the intake (body area, side, trigger, file counts) that advance every 7–9 seconds and never loop (`lib/analysis/progressCopy.ts`);
- small tags such as "Right knee · 2 scans · 1 prescription".

The triage AI call has a 60-second timeout.

**Step 3. Condition detection and safety verdict.** In the same AI call (`actions/generatePlan.ts` → `generateTriageQuiz`), the model returns:
- a condition title and a 2–3 sentence plain-language summary;
- whether the case is manageable with guided online rehab;
- its safety reasoning and any red flags.

Evidence priority is written into the prompt: clinical prescriptions and notes first, then scans plus symptoms, then symptoms alone. The result is saved to the database and shown in the **Detected condition** card in the left sidebar. If the case is not safe for online rehab, no quiz or plan is created and the platform locks (section 3).

**Step 4. Adaptive cross-questioning.** A modal with 6–12 AI-generated questions ("simple, specific issues need 6 to 8 … complex or vague issues may need 10 to 12"). Each question is either multiple choice (Yes / No / Not Sure or a short option list) or short text. Every question must be answered before continuing. Answers are screened for red flags before any plan is generated.

**Step 5. Treatment synthesis.** A second wait screen with a longer sequence of personalised lines, some quoting the patient's own answers. The plan AI call has a 180-second timeout. The plan (`aiTreatmentPlanSchema` in `actions/generatePlan.ts`) contains:
- `durationMonths`: whole months from 1 to 12, chosen by the AI from case complexity. Do not advertise a fixed "2-month" plan.
- one phase per month, each with a name and tagline, shown as month tabs in the workspace header;
- exactly 3 baseline exercises, each with name, duration, a spoken instruction (voice cue) and a movement description for the 3D figure;
- a rolling daily schedule of up to 7 days (the prompt asks for 3–7), each day marked active, upcoming or rest.

Before saving, every exercise's movement is checked and repaired by deterministic code with no second AI call (`lib/kinematics/plan-repair.ts`). Each movement is clamped to a joint-range table and solved on the real body. If it still fails, it's replaced by a matching reference exercise, or shown as text only.

**Step 6. 02 / Daily prescription (right sidebar) and the 3D stage (centre).**
- Calendar ("Daily schedule"): a month grid. Dates before the schedule start are blurred and disabled. Dates past the rolling horizon show "Too soon to be here. We'll update this part of the plan after your feedback and the next AI analysis."
- Day card: "{Day}'s plan" with each exercise, its duration ("60s guided movement") and the quoted voice cue. A rest day shows "Nothing is prescribed today. Rest and let your body recover."
- Tick boxes per exercise, only on today's date, with an "x of y movements checked" counter.
- The 3D stage demonstrates the selected exercise (section 2).

**Step 7. Daily feedback.** The "Done for today" button opens "How was the exercise today?" (`components/workspace/FeedbackModal.tsx`):
- Three choices: **More relief**, **About the same**, **More discomfort**, plus optional notes ("Anything you want your plan to know?").
- **More discomfort** requires naming the exercises and describing the trigger. The AI then rewrites tomorrow and later days to avoid or modify those movements (180-second timeout). Today's exercises are never changed.
- A **Reset** control restores the day and undoes any schedule change that day's feedback caused.

**Step 8. Pain Override.** The red button in the footer ("Sharp pain or sudden loss of movement"):
- stops the session at once, and the figure eases to a resting pose;
- the reported body area glows red;
- a "Stop and report" form records which exercise, what happened (Sharp pain / Sudden loss of movement / Something else), where (body regions) and details.

The report is saved before any AI work. The AI then makes a conservative reschedule ("Make tomorrow a rest or recovery day … say in tomorrow's tagline that a clinician should review the plan"). Deterministic code also removes every later exercise that loads a reported region (`stripFlaggedMovements`). Regions reported on earlier days show as amber rings on the figure. A stopped day is "not counted as done".

**Step 9. Progress tracking and escalation.** Completion, feedback and stops are stored per day (`DailyProgress`, `PainEvent` tables). The calendar shows a dot for completed days and a red dot for stopped days. After every feedback and Pain Override, the server checks the history and can lock the platform for in-person care (section 3).

**Throughout: Rehab Companion.** A chat assistant scoped to the patient's own condition, plan and the platform (section 2).

**Re-run analysis** starts a fresh intake. The new intake gets its own report, plan and chat history.

---

## 2. Verified product capabilities and differentiators

### Split multi-file uploads
- Two upload areas: "Medical scans / imaging" and "Clinical prescriptions & notes" (`app/workspace/WorkspaceParts.tsx`, `DROPZONES`).
- Each accepts `image/*` and `application/pdf`, with drag and drop or Browse, up to 10 files per area (`MAX_FILES_PER_CATEGORY`, `lib/intake/reportFiles.ts`).
- The categories are stored separately in the database (`ClinicalReport.scanUrls`, `prescriptionUrls`) and sent to the AI in labelled groups, prescriptions first as "primary evidence".
- The server only accepts file links produced by SomaCue's own upload action (`isTrustedUploadUrl`).
- No file-size limit is enforced in code.

### Mandatory no-prescription disclaimer
- Shown when the prescriptions area has no file (or only failed uploads). "Start diagnostic" stays disabled until it is ticked.
- Exact text (`AI_DISCLAIMER_TEXT`, `lib/intake/reportFiles.ts`): "I understand that AI analysis without a physical medical evaluation or a doctor's prescription may not be completely accurate."
- Enforced on the server too: an intake with no prescription and no acknowledgment is rejected. The acknowledgment time is stored (`aiDisclaimerAcceptedAt`).
- With a prescription uploaded, the panel shows "Prescription provided · The analysis will follow your clinician's guidance and limits."

### Evidence-attributed Detected Condition card
`components/workspace/ConditionCard.tsx`, left sidebar under Discovery:
- "Triage summary / Detected condition", an "AI assessment" chip, the condition title and the 2–3 sentence summary.
- A source line computed from what was actually uploaded, never from the AI's own claim (`deriveConditionSource`, `lib/clinical/assessment.ts`):
  - "Derived from medical reports & scans"
  - "Derived from medical reports & symptoms"
  - "Derived from imaging scans & symptoms only"
  - "Derived from uploaded reports & symptoms" (older reports without categories)
  - "Derived from symptom description only"
- A verdict box: green "Suitable for guided online rehab" with the AI's reasoning, or red "Requires immediate in-person medical evaluation" with the reason.
- Footer: "AI-generated assessment, not a medical diagnosis. Confirm it with a clinician."
- The card persists across reloads.

### Real-time 3D figure stage
`components/stage/StageV2.tsx`, `StageCanvas.tsx`, `lib/kinematics/*`:
- **Figure:** a rigged human body (Quaternius Universal Base Characters, CC0, `public/assets/stage/soma-body.glb`, 0.5 MB) on a lit stage with a floor grid. three.js through @react-three/fiber.
- **Motion:** driven live from a movement description, not from pre-recorded clips. The vocabulary covers 5 postures, 12 body segments, 24 anatomical motions and 17 regions (section 4). Every movement uses gentle angles from anatomical zero, and the engine never animates past the computed safe range.
- **Views:** two per posture, plus free orbit.
  - Standing, seated and hands-and-knees: Anterior / Posterior.
  - Lying on the back or face down: Top / Side, and lying exercises open on Side.
- **Speed:** 0.5x or 1.0x.
- **Pace:**
  - Guided: "Waits for each spoken instruction before moving". The figure pauses at the start of each step until the voice cue finishes.
  - Real-time: "Moves continuously with no spoken instructions". Voice is disabled in this pace.
- **Voice cues:**
  - Browser text-to-speech, preferring Chrome's "Google US English" voice.
  - The first rep reads the full instruction; later reps use short prompts ("Rep 3. Move.", "Hold.").
  - Long instructions are spoken sentence by sentence (`lib/speech.ts`).
  - Mute button in the footer.
- **Live caption** above the figure: Move / Hold with a seconds countdown / Return / Rest / Rest between sets / Done, plus "Left leg" or "Right leg" style side labels on alternating exercises.
- **Region glow:** the exercise's target regions glow on the body. Pain reports glow red, and earlier-flagged regions show amber.
- **Set/rep counter** (`components/workspace/SetRepCounter.tsx`, footer):
  - a SET badge with one pip per set, and "Rep x of y" with one segment per rep (a single bar above 12 reps);
  - "All sets done" when finished;
  - per rep, a soft synthesised pop of about 160 ms and a 650 ms animation;
  - per set, a rising four-note chime (C5 E5 G5 C6) and a 1600 ms burst with "Set N complete". No audio files are used.
- **Fallbacks:** "Text view" toggle; a text description when WebGL is unavailable ("3D is not available in this browser.") or when the model fails to load ("Try 3D again"). The stage shows "3D stage locked" until intake and triage are done.
- Prev / Play / Next controls step through the day's exercises.

### Guarded Rehab Companion chatbot
`app/api/chat/route.ts`, `lib/clinical/chatGuardrails.ts`, `components/workspace/RehabChatDrawer.tsx`:
- **Launcher:** an emerald card pinned to the bottom of the left sidebar ("Rehab Companion · AI · Ask about your condition, today's exercises or SomaCue"). It opens a chat panel from the left.
- **Scope:** only the patient's own condition, uploads and symptom assessment; their plan, today's exercises, sets/reps, form cues, feedback and Pain Override history; and how to use SomaCue. Everything else gets: "I can only help with your SomaCue rehab plan, scheduled exercises, condition summary, and platform features."
- **Checks before any AI call (no tokens spent):**
  - red-flag symptoms first, answered with a clinical "Safety warning";
  - prompt-injection and jailbreak patterns;
  - off-topic requests: coding, homework, maths, trivia, writing, politics, finance, recipes.
- **Limits:**
  - 500 characters per message;
  - the last 10 messages sent as history, with blocked exchanges dropped;
  - 350-token answers and a 45-second timeout;
  - 40 messages per patient per day, blocked ones included.
- **Patient data the AI receives:** condition, summary, source, verdict, any active lockout, plan months and phases, upcoming days, today's exercises with sets, reps, cues and stop-if notes, the last 7 feedback days and the last 5 Pain Override stops.
- **UI:**
  - streaming replies with bold and list formatting, a typing indicator and auto-scroll;
  - a 0/500 character counter and a "messages left today" counter;
  - Clear chat, Enter to send, Escape to close;
  - three starter prompts that change with state, for example "Explain my detected condition", "Walk me through today's exercises" and "What if an exercise feels uncomfortable?". Before intake they read "How do I start my assessment?"; after a lockout, "Why do I need in-person care?".
- **Storage:** history is kept per intake (`ChatMessage` table). Clear chat hides messages but keeps them counted toward the daily limit.

### Other verified details
- Data is stored in PostgreSQL (Neon) through Prisma 7.
- AI runs through OpenRouter (`lib/ai/client.ts`) using the model `nvidia/nemotron-3.5-super-vl:free` for triage, plans, rescheduling and chat. `AI_CHAT_MODEL` can override the chat model.
- Accessibility work that exists:
  - reduced-motion support (a global rule in `app/base.css`, plus per-component rules);
  - focus-visible outlines;
  - ARIA labels and live regions in the stage, chat and wait screens;
  - the safety lockout uses a modal `<dialog>`.

---

## 3. Clinical safety and guardrail architecture

### Layer 1: deterministic red-flag screening
`screenRedFlags` and `screenQuizAnswers` in `lib/clinical/assessment.ts`. These are fixed keyword patterns, not AI, with negation handling so "no fever" is ignored. The eight flags:
1. Loss of bladder or bowel control
2. Numbness in the groin or saddle area
3. Progressive weakness or foot drop
4. Possible fracture (including "can't bear weight")
5. Possible tendon or ligament rupture
6. Fever or unexplained weight loss with pain
7. Chest pain or trouble breathing
8. Pain after major trauma (road accident, fall from height)

Where it runs:
- **Intake symptoms:** a match locks the case even if the AI misses it or the AI is unavailable.
- **Triage answers:** a "yes"-style answer to a red-flag question, or a free-text answer naming a flag, locks the case before any plan is generated.
- **Every chat message:** a match returns a clinical warning without calling the AI.

### Layer 2: the AI safety verdict
The triage prompt tells the model to set "manageable with guided rehab" to false for red-flag neurological signs, suspected or confirmed fracture, acute rupture or complete tear, severe structural damage or instability, signs of infection, tumour or inflammatory disease, severe unrelenting night pain, major trauma or chest pain. It also says "When unsure, choose false."

### Layer 3: full-platform lockout (`components/workspace/EscalationAlert.tsx`)
- A modal `<dialog>` that Escape can't close. The rest of the page is inert, and the page itself, navbar included, is blurred (`html[data-clinical-lock]` in `app/globals.css`).
- **Content:**
  - "Clinical safety alert", with the title "Stop. Please get in-person medical care now" for triage, or "Stop your exercises and get seen in person" for progress;
  - the reason and the detected condition;
  - the evidence list ("Warning signs in your intake" or "What your sessions showed");
  - "What to do now": stop the plan; book an in-person doctor or physiotherapist and bring your reports; call the local emergency number for loss of bladder or bowel control, groin numbness, sudden or spreading weakness, chest pain or severe uncontrolled pain.
- **Only action:** "Start a new intake".
- **Persistence:** the lock is stored on the report (`escalationKind`, `escalationReason`, `escalationEvidence`, `escalatedAt`) and survives reloads. All progress actions are refused on the server while it is locked.

### Layer 4: progress-based escalation
`evaluateProgressEscalation` and `ESCALATION_RULES` in `lib/clinical/assessment.ts`, run after every feedback submission and every Pain Override. A session counts as negative if it ended in "More discomfort" or a Pain Override. The platform locks when any of these is true:
- Pain Override used on **2 separate days within 14 days**;
- the **last 3 sessions** were all negative;
- the **last 5–7 sessions** brought no relief and **at least 2** were negative.

Pain Override events are never deleted by a day reset.

### Layer 5: plan safety
- Deterministic movement repair against a joint-range table before any plan is saved (`plan-repair.ts`, `joint-table.ts`).
- After "More discomfort", reported exercises can't reappear under their original name, and modified exercises must tell the patient to stop if the pain returns.
- After a Pain Override, a red-flag veto removes every later exercise that loads a reported region. Days left empty become rest days.

### Exact disclaimers and boundaries in the product today

| Where | Text |
| --- | --- |
| Intake, no prescription | "I understand that AI analysis without a physical medical evaluation or a doctor's prescription may not be completely accurate." |
| Detected condition card | "AI-generated assessment, not a medical diagnosis. Confirm it with a clinician." |
| 3D stage badge | "Prototype · ranges not clinically reviewed" |
| Pain Override notice (`SafetyNotice.tsx`, marked draft) | "Stop exercising now. If you have sudden severe pain, chest pain, numbness or tingling, loss of bladder or bowel control, or you cannot move an arm or leg, get urgent medical care now. Call your local emergency number." / "SomaCue is not an emergency service and cannot contact anyone for you." |
| Chat red-flag reply | "Please stop exercising now. What you describe (…) can be a sign of a serious problem that needs an in-person medical evaluation, not online rehab. Contact a doctor or physiotherapist today. If symptoms are severe or getting worse quickly, call your local emergency number or go to the nearest emergency department." |
| Chat system prompt | "You are not a doctor and do not diagnose." It may not invent exercises or change doses. |
| Plan prompts | "Do not diagnose." No equipment, no unsafe intensity. |

The landing page should repeat these boundaries, not soften them.

---

## 4. Real clinical examples and exercise vocabulary

### Conditions that appear in code, prompts and tests

| Example | Where | Safe to show as |
| --- | --- | --- |
| "L4–L5 disc bulge" | triage prompt example; `__tests__/chatGuardrails.test.ts`, `escalationUi.test.tsx` | Suitable-for-rehab card |
| "Patellofemoral pain syndrome" | triage prompt example; `__tests__/intakeAction.test.ts`, `chatRoute.test.ts` | Suitable-for-rehab card |
| "Suspected tibial plateau fracture" | `__tests__/intakeAction.test.ts` (escalated case) | Lockout example |
| "Likely lower lumbar disc bulge" | a real AI result seen in the live workspace during development, source "Derived from imaging scans & symptoms only" | Realistic AI output (not stored in code) |
| Herniation, bulge, stenosis, sprain at C1–S5 | `lib/safety/engine.ts` and `lib/ai/extractor.ts` (legacy, unused by the live flow) | Do not showcase as a feature |

The default symptom text in the intake box is "Pain and stiffness around the right knee after long walks." The test suite also uses "Low back pain" and "Sore neck".

The body areas the wait-screen copy recognises (`lib/analysis/progressCopy.ts`) are lower back, upper back, neck, shoulder, elbow, wrist, hip, knee, hamstring, calf, ankle, foot and back.

### Anatomical regions (17, `REGION_LABELS` in `lib/kinematics/vocabulary.ts`)
Head, Neck, Upper back, Lower back, Pelvis, Left/Right shoulder, Left/Right elbow, Left/Right wrist and hand, Left/Right hip, Left/Right knee, Left/Right ankle and foot.

### Postures (5)
Standing, Seated, Lying on the back, Lying face down, Hands and knees.

### Motions (24)
flexion, extension, lateral flexion, rotation, retraction, anterior tilt, posterior tilt, elevation, depression, protraction, abduction, adduction, horizontal abduction, horizontal adduction, internal rotation, external rotation, pronation, supination, radial deviation, ulnar deviation, dorsiflexion, plantarflexion, inversion, eversion.

### Movement spec limits (`lib/kinematics/movement-spec.ts`)
- 1–30 reps and 1–5 sets.
- Tempo in seconds per rep: move, hold up to 30, return and rest up to 30.
- 1–6 target regions, up to 4 cues and up to 3 stop-if notes.

### Reference exercises (18, `lib/kinematics/reference-exercises.ts`)
These have hand-written motion data, so they animate without any AI. They're the safest choice for landing page demos.

| Exercise | Posture | Default dose | Target regions |
| --- | --- | --- | --- |
| Seated Chin Tuck | seated | 1 × 8 | neck |
| Seated Neck Rotation | seated | 1 × 6 | neck |
| Seated Trunk Rotation | seated | 1 × 6 | upper back |
| Supine Pelvic Tilt | supine | 1 × 10 | lower back, pelvis |
| Supine Heel Slide | supine | 1 × 8 | left knee, left hip |
| Supine Knee Lift | supine | 1 × 8 | left hip, lower back |
| Glute Bridge | supine | 1 × 8 | both hips, lower back |
| Ankle Pumps | supine | 1 × 12 | both ankles and feet |
| Prone Press-Up | prone | 1 × 8 | lower and upper back |
| Cat-Cow | hands and knees | 1 × 8 | upper and lower back |
| Bird Dog | hands and knees | 1 × 6 | lower back, right shoulder, left hip |
| Standing Arm Raise | standing | 1 × 8 | both shoulders |
| Seated Knee Extension | seated | 1 × 8 | left knee |
| Seated Knee Lift | seated | 1 × 10 | left hip |
| Seated Elbow Bend | seated | 1 × 10 | both elbows |
| Seated Wrist Bend | seated | 1 × 10 | both wrists and hands |
| Standing Heel Raise | standing | 1 × 10 | both ankles and feet |
| Mini Squat | standing | 1 × 8 | both knees and hips |

Example copy from the data:
- **Supine Pelvic Tilt.** Voice cue: "Lie on your back with knees bent and gently flatten your lower back into the floor." Cues: "Tighten your tummy muscles gently." "Keep breathing during the hold." Stop if: "Pain spreads down your leg."
- **Bird Dog.** Voice cue: "On hands and knees, reach one arm forward and the opposite leg back." Cues: "Keep your back flat like a table." "Do not rotate your hips." Stop if: "Pain in your lower back."

### Other fixed labels
- **Feedback choices:** More relief / About the same / More discomfort.
- **Pain Override types:** Sharp pain / Sudden loss of movement / Something else.
- **Stage phases:** Moving, Hold, Returning, Rest, Rest between sets, Complete.

---

## 5. Routes, auth and navigation map

### Pages

| Route | Status | Auth | Notes |
| --- | --- | --- | --- |
| `/` | Live | Public | Current marketing page (`app/page.tsx`). CTAs: "Start exploring" and "Create your workspace" go to `/register`; "Open the workspace" goes to `/workspace`; the footer links to `/login` and `/register`. The section `id="platform"` is the target of the nav's "How it works" link. To be replaced. |
| `/register` | Live | Public; a signed-in user is redirected to `/dashboard` | Full name, email, password (8+). Always creates a `patient`. |
| `/login` | Live | Public; a signed-in user is redirected to `/dashboard` | Honours `?from=` for redirects (relative paths only). Defaults to `/dashboard`. |
| `/dashboard` | Live, placeholder content | Signed in | The nav labels it **"Overview"**. The content is static: "Saved plans: None yet", "Safety engine: Active". It links to `/workspace`. |
| `/workspace` | Live, the product | Signed in | Everything in sections 1–3. |
| `/3d-lab` | Experimental | Public, `noindex` | An anatomy and motion compatibility test (`components/lab/LabWorkspace.tsx`). Not linked anywhere. Do not link from marketing. |
| `/overview` | **Not built** | – | Only a nav label; the real route is `/dashboard`. |
| `/pricing` | **Not built** | – | No billing, plans or payment code exists. |
| `/about`, `/contact`, `/privacy`, `/terms`, `/security` | **Not built** | – | No legal pages exist. They'll be needed for a medical SaaS. |
| Forgot password, email verification | **Not built** | – | |
| Clinician sign-up or portal | **Not built** | – | The `clinician` role exists in the schema and the navbar shows "Dr." for it, but there's no way to create one or any clinician view. |

### APIs and server actions

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/auth/register` | POST | Public | Create a patient and set the session cookie |
| `/api/auth/login` | POST | Public | Sign in |
| `/api/auth/logout` | POST | – | Clear the session cookie |
| `/api/chat` | GET / POST / DELETE | Signed in, report owner | Load history / send a message (streamed) / clear the chat |
| `/api/extract` | POST | Signed in | Legacy Gemini MRI-text extractor. **Not called by any UI.** |
| `actions/intake.ts` | Server actions | Signed in | `uploadScanFile`, `submitIntakeForm`, `completeTriageQuiz`. Note: `uploadScanFile` does not check sign-in. |
| `actions/dailyProgress.ts` | Server actions | Signed in, plan owner | Tick exercise, reset day, submit feedback |
| `actions/painEvent.ts` | Server actions | Signed in, plan owner | Report a Pain Override, reschedule |

### Auth details
- Email and password, hashed with bcrypt (10 rounds).
- The session is an HS256 JWT in an `httpOnly`, `sameSite=lax` cookie named `somacue_session`, valid for 14 days and `secure` in production (`lib/auth/*`).
- `proxy.ts` (this Next.js version's middleware) protects `/dashboard` and `/workspace` by redirecting to `/login?from=…`, and sends signed-in users away from `/login` and `/register`.
- Risk: `lib/auth/jwt.ts` falls back to a hard-coded session secret when `SESSION_SECRET` is unset, and `.env` does not set it. Fix this before any public launch.

### Navigation
- Guest navbar: brand → `/`, "How it works" → `/#platform`, "Sign in" → `/login`, and a "Get started" button → `/register`.
- Signed-in navbar: "Overview" → `/dashboard`, "Workspace" → `/workspace`, a name badge ("Pt." or "Dr."), and Sign Out.

### Recommended landing page CTA wiring
- Primary "Get started" or "Start your assessment" → `/register`.
- "Sign in" → `/login`.
- "Open workspace" for signed-in visitors → `/workspace`. Logged-out visitors are redirected to `/login?from=/workspace` and come back after signing in.
- Any "Pricing", "Privacy" or "Terms" link needs those pages built first.

### Workspace placeholders not to feature
- The header text "Clinical workspace / Jordan Lee" is hard-coded.
- The "Patient History" button does nothing.
- "Progress Saved" is a static label.
- The footer "Voice feedback" toggle only changes its own label. It doesn't listen to anything.

### Legacy components not used by any route
`components/workspace/Workspace.tsx`, `TopBar.tsx` (the only theme toggle), `StagePanel.tsx`, `GuidancePanel.tsx`, `AssetNotes.tsx`, `components/intake/PatientIntake.tsx`, `app/workspace/Workspace.module.css`, `lib/safety/engine.ts` and `lib/ai/extractor.ts`.

---

## 6. Visual design tokens and interactive demo candidates

### Design direction already in the code
The header comment in `app/globals.css` (Hallmark brief): idea "A physiotherapy demonstration inspected like a specimen on a lit bench", vibe "clinical 3D vitrine, quiet instrument", genre modern-minimal, posture restrained, axes light / grotesk-sans / cool.

There are two visual modes:
- **Marketing and auth pages:** the `--color-*` tokens. Light or dark follows `prefers-color-scheme` or a stored `somacue.theme` value. There's no visible toggle in the live UI.
- **The workspace:** always dark, using the `--workspace-*` and `--stage-*` tokens plus Tailwind `zinc` and `emerald` classes.

### Typography (`app/layout.tsx`, `app/tokens.css`)
| Role | Font | Token |
| --- | --- | --- |
| Display and headings (`h1`–`h3`) | Rethink Sans | `--font-display` |
| Body | Hanken Grotesk | `--font-body` |
| Mono and labels ("outlier") | Azeret Mono | `--font-outlier` |

- **Type scale:** `--text-xs` 0.75rem, `--text-sm` 0.8125rem, `--text-ui` 0.875rem, `--text-md` 1rem, `--text-lg` 1.125rem, `--text-xl` 1.25rem, `--text-2xl` 1.5rem, `--text-3xl` 1.875rem, `--text-display-s` 2.25rem, `--text-display` 2.75rem, `--text-section` 1.375rem, `--text-title` and `--text-lead` 1.0625rem.
- **Headings:** `--tracking-display` −0.03em.
- **Body:** line-height 1.55, and paragraphs cap at 65ch.

### Colour: marketing tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--color-paper` | oklch(96.6% 0.006 185) | oklch(15.8% 0.012 195) |
| `--color-paper-2` | oklch(93.8% 0.008 185) | oklch(18.8% 0.013 195) |
| `--color-paper-3` | oklch(90.6% 0.010 185) | oklch(22.2% 0.014 195) |
| `--color-ink` | oklch(23% 0.018 198) | oklch(94% 0.006 190) |
| `--color-ink-2` | oklch(35% 0.016 198) | oklch(82% 0.009 190) |
| `--color-muted` | oklch(49% 0.014 198) | oklch(67% 0.011 195) |
| `--color-rule` | oklch(85.5% 0.010 192) | oklch(30.5% 0.014 198) |
| `--color-accent` (teal) | oklch(49% 0.115 189) | oklch(72% 0.112 186) |
| `--color-accent-ink` | oklch(97.5% 0.006 190) | oklch(14% 0.014 198) |
| `--color-focus` | oklch(46% 0.125 189) | oklch(81% 0.112 186) |
| `--color-error` | oklch(52% 0.17 27) | oklch(72% 0.15 28) |
| `--color-success` | oklch(48% 0.11 155) | oklch(74% 0.11 155) |
| `--color-scrim` | oklch(12% 0.012 200 / 0.62) | oklch(8% 0.012 200 / 0.72) |

### Colour: workspace and stage (dark emerald theme)

| Token | Value | Use |
| --- | --- | --- |
| `--workspace-canvas` | oklch(9.2% 0.014 198) | Page background |
| `--workspace-header` | oklch(12.8% 0.018 198) | Workspace header bar |
| `--workspace-panel` | oklch(14.8% 0.018 198) | Sidebar panels, dialogs |
| `--workspace-panel-raised` | oklch(17.2% 0.021 198) | Calendar |
| `--workspace-well` | oklch(10.8% 0.016 198) | Inputs and wells |
| `--workspace-rule` / `-strong` | oklch(27% 0.018 198) / oklch(38% 0.022 198) | Borders |
| `--workspace-signal` | oklch(78% 0.14 68) | Amber highlight: selected calendar day, month nav |
| `--workspace-signal-ink` | oklch(22% 0.035 68) | Text on amber |
| `--workspace-quiet` | oklch(72% 0.018 198) | Secondary text |
| `--stage-bg` | oklch(10.5% 0.012 200) | 3D stage background |
| `--stage-ink` | oklch(94% 0.006 190) | Stage text |
| `--stage-accent` | oklch(75% 0.112 185) | Small emerald labels |
| `--stage-error` | oklch(74% 0.15 28) | Stopped state |
| `--stage-success` | oklch(76% 0.11 155) | |
| `--stage-body` | oklch(64% 0.065 58) | Figure skin tone |
| `--stage-bone` | oklch(58% 0.024 78) | |
| `--stage-grid` / `-strong` | oklch(34% 0.014 198) / oklch(47% 0.018 195) | Floor grid |

Tailwind v4 defaults used heavily in the workspace:
- `emerald-300` oklch(84.5% 0.143 164.978), the primary accent for buttons and labels;
- `emerald-200` oklch(90.5% 0.093 164.15) and `emerald-100` oklch(95% 0.052 163.051);
- `zinc-950` oklch(14.1% 0.005 285.823) and `zinc-900` oklch(21% 0.006 285.885);
- `red-300` oklch(80.8% 0.114 19.571) and `red-400` oklch(70.4% 0.191 22.216) for Pain Override and alerts;
- `amber-200` and `amber-300` for warnings and the disclaimer.

Component-specific values in `app/globals.css`:
- **Wait-screen ring** (`.analysis-*`): gradient from oklch(90% 0.11 165) through oklch(80% 0.15 163) to oklch(70% 0.12 182).
- **Chat launcher** (`.chat-launcher`): a gradient from oklch(30% 0.075 168) to oklch(19% 0.04 180), a border of oklch(82% 0.14 165 / 0.6), and an icon fill of oklch(80% 0.15 165).
- **Lockout card** (`.escalation-card`): a gradient from oklch(26% 0.09 25) to oklch(17% 0.05 25), a border of oklch(70% 0.19 25 / 0.6), and a red radial backdrop with `blur(14px)`.

### Shape, spacing and motion
- **Radii:** the marketing tokens are `--radius-shell` 10px, `--radius-card` 6px, `--radius-input` 6px and `--radius-pill` 999px. The workspace uses Tailwind's `rounded-2xl` (1rem) for panels, `rounded-3xl` (1.5rem) for dialogs and `rounded-xl` (0.75rem) for inner cards and inputs.
- **Borders:** 1px hairlines (`--rule-hair`). The workspace uses `border-white/10` and `border-white/15` mapped to the rule tokens.
- **Spacing:**
  - scale: `--space-3xs` 2px, `2xs` 4px, `xs` 8px, `sm` 12px, `md` 16px, `lg` 24px, `xl` 40px, `2xl` 64px, `3xl` 96px, `4xl` 144px;
  - containers: `--container` 1720px, `--gutter` clamp(20px, 3.4vw, 56px);
  - section gaps: 96, 128 or 160px, smaller on narrow screens;
  - `--nav-h` is 72px.
- **Shadows:** `--shadow-card` 0 1px 2px oklch(22% 0.012 195 / 0.05) and `--shadow-dialog` 0 28px 80px oklch(8% 0.012 200 / 0.35).
- **Motion:** `--ease-out` cubic-bezier(0.16, 1, 0.3, 1); durations `--dur-micro` 120ms, `--dur-short` 220ms, `--dur-long` 420ms. `app/base.css` cuts every animation and transition to 0.01ms under `prefers-reduced-motion` unless an element has the `.keep-motion` class. Landing page animations will be disabled for those users unless they opt in.

### Interactive demo candidates

| Component | Fit for a landing page preview | Notes |
| --- | --- | --- |
| `ConditionCard` (`components/workspace/ConditionCard.tsx`) | **Best and easiest.** A pure component driven by props alone. | Render with the "L4–L5 disc bulge" or "Patellofemoral pain syndrome" examples. Toggle between source lines and between the green and red verdict to show attribution and safety. Needs a dark wrapper with `workspace-shell` or the workspace tokens. |
| `AnalysisProgress` (`components/workspace/AnalysisProgress.tsx`) | **Strong hero or "how it works" animation.** Pure props. | Feed it `buildTriageCopy({ symptoms, scanCount, prescriptionCount })` and set `arrived` on a timer. It never calls the AI. The 7–9 s line pacing may be slow for a landing page; a shorter loop would need a code change. |
| `SetRepCounter` (`components/workspace/SetRepCounter.tsx`) | Good micro-demo of rep and set feedback. Pure props. | Drive `progress` and `celebration` from a timer. The chimes need a user gesture before browsers allow audio (`primeCelebrationAudio`). |
| 3D stage (`StageV2` / `StageCanvas`) | **The most distinctive feature**, but the heaviest. | It needs WebGL, the 0.5 MB body GLB and `useStageController`. Use a reference exercise (Supine Pelvic Tilt, Bird Dog, Cat-Cow) through `resolveStageExercise({ exerciseName, voiceCue })`, so no AI or database is involved. Mute speech (Real-time pace) so the page doesn't talk. Built-in fallback: the text description when WebGL is missing. Load it lazily below the fold. |
| `EscalationAlert` (`components/workspace/EscalationAlert.tsx`) | Shows the safety story well, but **don't mount it as-is**. | It calls `showModal()` and sets `data-clinical-lock` on `<html>`, which blurs and locks the whole landing page. Use a static screenshot, or a contained copy that is not a modal. |
| `RehabChatDrawer` (`components/workspace/RehabChatDrawer.tsx`) | Good for showing the guarded scope, but **not usable as-is**. | It calls `/api/chat`, which needs sign-in and a report, and it renders a sidebar launcher plus a fixed panel. For marketing, use a scripted transcript with three bubble types: a normal answer, an off-topic refusal (dashed border) and a red "Safety warning". The bubble styles (`.chat-bubble-*`) are reusable. |
| `DailyPrescriptionPanel`, calendar, `FeedbackModal`, `StopReportForm` | Usable as static or screenshot previews. | They depend on workspace state and server actions, so present them as images or lightly mocked props. |

Existing screenshots in `docs/screenshots/` and `docs/3d-lab/screenshots/` come from earlier prototype stages and don't show the current workspace. Capture fresh ones before using any.

---

## Appendix: claims checklist

| Safe to say | Do not say |
| --- | --- |
| AI-assisted triage with adaptive follow-up questions | "Diagnoses your condition" or any accuracy claim |
| Shows what each assessment was derived from | "Clinically validated", "doctor-approved", "evidence-based outcomes" |
| Fixed keyword checks for red flags, plus an AI safety verdict | "Detects all emergencies" or "replaces a physiotherapist" |
| Locks guided exercises and points to in-person care when warning signs or worsening appear | "Contacts emergency services" (it can't: "SomaCue is not an emergency service") |
| Multi-month plan (1–12 months, chosen per case) with a rolling daily schedule | "2-month program" as a fixed promise |
| Live 3D demonstrations built from a movement vocabulary, with Guided and Real-time pace, voice cues and set/rep tracking | "Motion capture", "computer vision form correction", "tracks your movement" (it doesn't use the camera) |
| Rehab Companion chat limited to your plan and the platform | General medical Q&A |
| Free sign-up (`/register`) | Pricing tiers, trials, HIPAA or any compliance badge |
