import type { AngleEntry, MovementSpec } from "./movement-spec";
import type { Posture } from "./vocabulary";

/**
 * Hand-checked reference exercises. They are used as AI examples, as the
 * fallback for plans created before movement specs existed, and as the
 * verify:motion regression suite. Draft content, not clinically reviewed.
 */
export type ReferenceExercise = {
  id: string;
  name: string;
  keywords: string[];
  voiceCue: string;
  spec: MovementSpec;
};

const e = (
  segment: AngleEntry["segment"],
  motion: AngleEntry["motion"],
  degrees: number,
  side?: AngleEntry["side"],
): AngleEntry => ({ segment, motion, degrees, ...(side ? { side } : {}) });

const tempo = (upSeconds: number, holdSeconds: number, downSeconds: number, restSeconds: number) => ({
  upSeconds,
  holdSeconds,
  downSeconds,
  restSeconds,
});

const hookLying = [e("hip", "flexion", 45, "both"), e("knee", "flexion", 90, "both")];

export const REFERENCE_EXERCISES: ReferenceExercise[] = [
  {
    id: "chin_tuck",
    name: "Seated Chin Tuck",
    keywords: ["chin tuck", "cervical retraction", "neck retraction", "chin tucks"],
    voiceCue: "Sit tall and gently draw your chin straight back, then relax.",
    spec: {
      posture: "seated",
      startPose: [],
      movements: [e("cervical", "retraction", 15)],
      alternateSides: false,
      pins: [],
      tempo: tempo(2, 3, 2, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["cervical"],
      cues: ["Keep your eyes level.", "Make a gentle double chin, do not tip your head down."],
      stopIf: ["Pain or tingling spreads into your arm."],
    },
  },
  {
    id: "neck_rotation",
    name: "Seated Neck Rotation",
    keywords: ["neck rotation", "cervical rotation", "head turn", "neck turns"],
    voiceCue: "Slowly turn your head to look over one shoulder, then the other.",
    spec: {
      posture: "seated",
      startPose: [],
      movements: [e("cervical", "rotation", 40, "left")],
      alternateSides: true,
      pins: [],
      tempo: tempo(2, 2, 2, 1),
      reps: 6,
      sets: 1,
      targetRegions: ["cervical"],
      cues: ["Keep your shoulders still.", "Turn only as far as is comfortable."],
      stopIf: ["You feel dizzy or your vision changes."],
    },
  },
  {
    id: "seated_trunk_rotation",
    name: "Seated Trunk Rotation",
    keywords: ["trunk rotation", "thoracic rotation", "seated rotation", "spinal twist", "seated twist"],
    voiceCue: "Sit tall and rotate your upper back to one side, then return to centre.",
    spec: {
      posture: "seated",
      startPose: [e("shoulder", "flexion", 40, "both"), e("elbow", "flexion", 100, "both")],
      movements: [e("thoracic", "rotation", 24, "left"), e("lumbar", "rotation", 3, "left")],
      alternateSides: true,
      pins: [],
      tempo: tempo(3, 2, 3, 1),
      reps: 6,
      sets: 1,
      targetRegions: ["thoracic"],
      cues: ["Keep your hips still on the chair.", "Breathe out as you turn."],
      stopIf: ["Sharp pain in your back or ribs."],
    },
  },
  {
    id: "supine_pelvic_tilt",
    name: "Supine Pelvic Tilt",
    keywords: ["pelvic tilt", "pelvic tilts", "posterior tilt", "back flattening"],
    voiceCue: "Lie on your back with knees bent and gently flatten your lower back into the floor.",
    spec: {
      posture: "supine",
      startPose: hookLying,
      movements: [e("pelvis", "posterior_tilt", 10), e("lumbar", "flexion", 6)],
      alternateSides: false,
      pins: ["left_foot", "right_foot"],
      tempo: tempo(2, 3, 2, 1),
      reps: 10,
      sets: 1,
      targetRegions: ["lumbar", "pelvis"],
      cues: ["Tighten your tummy muscles gently.", "Keep breathing during the hold."],
      stopIf: ["Pain spreads down your leg."],
    },
  },
  {
    id: "heel_slide",
    name: "Supine Heel Slide",
    keywords: ["heel slide", "heel slides"],
    voiceCue: "Slide one heel toward you along the floor, then slide it back out.",
    spec: {
      posture: "supine",
      startPose: [],
      movements: [e("hip", "flexion", 55, "left"), e("knee", "flexion", 95, "left")],
      alternateSides: true,
      pins: [],
      tempo: tempo(3, 1, 3, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["knee_left", "hip_left"],
      cues: ["Keep your heel on the floor.", "Move slowly and smoothly."],
      stopIf: ["Sharp pain at the front or back of your knee."],
    },
  },
  {
    id: "supine_march",
    name: "Supine Knee Lift",
    keywords: ["supine knee lift", "supine march", "knee to chest", "lying knee lift", "supine knee lifts"],
    voiceCue: "From lying with knees bent, lift one knee toward your chest, then lower it.",
    spec: {
      posture: "supine",
      startPose: hookLying,
      movements: [e("hip", "flexion", 90, "left")],
      alternateSides: true,
      pins: [],
      tempo: tempo(2, 1, 2, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["hip_left", "lumbar"],
      cues: ["Keep your lower back relaxed on the floor."],
      stopIf: ["Pain in your lower back increases."],
    },
  },
  {
    id: "glute_bridge",
    name: "Glute Bridge",
    keywords: ["bridge", "bridging", "glute bridge", "hip bridge"],
    voiceCue: "Press through your feet and lift your hips until your body is in a line.",
    spec: {
      posture: "supine",
      startPose: hookLying,
      movements: [e("hip", "extension", 0, "both")],
      alternateSides: false,
      pins: ["left_foot", "right_foot"],
      tempo: tempo(2, 3, 2, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["hip_left", "hip_right", "lumbar"],
      cues: ["Squeeze your buttocks.", "Do not arch your lower back."],
      stopIf: ["Cramping or sharp pain in your back."],
    },
  },
  {
    id: "ankle_pumps",
    name: "Ankle Pumps",
    keywords: ["ankle pump", "ankle pumps", "ankle circles"],
    voiceCue: "Point your toes away, then pull them back toward you.",
    spec: {
      posture: "supine",
      startPose: [e("ankle", "plantarflexion", 30, "both")],
      movements: [e("ankle", "dorsiflexion", 14, "both")],
      alternateSides: false,
      pins: [],
      tempo: tempo(1.5, 0.5, 1.5, 0),
      reps: 12,
      sets: 1,
      targetRegions: ["ankle_foot_left", "ankle_foot_right"],
      cues: ["Keep your knees straight and relaxed."],
      stopIf: ["Calf pain with swelling or warmth."],
    },
  },
  {
    id: "prone_press_up",
    name: "Prone Press-Up",
    keywords: ["press up", "press-up", "back extension", "prone extension", "sphinx", "mckenzie extension"],
    voiceCue: "Lying face down, gently push your chest up while your hips stay on the floor.",
    spec: {
      posture: "prone",
      startPose: [
        e("shoulder", "abduction", 65, "both"),
        e("shoulder", "external_rotation", 72, "both"),
        e("elbow", "flexion", 110, "both"),
      ],
      movements: [
        e("lumbar", "extension", 16),
        e("thoracic", "extension", 14),
        e("cervical", "extension", 10),
      ],
      alternateSides: false,
      pins: ["left_hand", "right_hand"],
      tempo: tempo(3, 2, 3, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["lumbar", "thoracic"],
      cues: ["Keep your hips on the floor.", "Stop at a pain-free height."],
      stopIf: ["Pain spreads further down your leg."],
    },
  },
  {
    id: "cat_cow",
    name: "Cat-Cow",
    keywords: ["cat cow", "cat-cow", "cat camel", "cat and cow", "gentle cat cow"],
    voiceCue: "On hands and knees, round your back up, then let it gently sink.",
    spec: {
      posture: "quadruped",
      startPose: [
        e("lumbar", "extension", 12),
        e("thoracic", "extension", 10),
        e("cervical", "extension", 15),
      ],
      movements: [
        e("lumbar", "flexion", 30),
        e("thoracic", "flexion", 22),
        e("cervical", "flexion", 20),
      ],
      alternateSides: false,
      pins: [],
      tempo: tempo(3, 1, 3, 0.5),
      reps: 8,
      sets: 1,
      targetRegions: ["thoracic", "lumbar"],
      cues: ["Move with your breath.", "Keep your arms straight."],
      stopIf: ["Wrist or knee pain."],
    },
  },
  {
    id: "bird_dog",
    name: "Bird Dog",
    keywords: ["bird dog", "bird-dog", "quadruped arm and leg"],
    voiceCue: "On hands and knees, reach one arm forward and the opposite leg back.",
    spec: {
      posture: "quadruped",
      startPose: [],
      movements: [
        e("shoulder", "flexion", 144, "right"),
        e("hip", "extension", 10, "left"),
        e("knee", "extension", 0, "left"),
      ],
      alternateSides: true,
      pins: [],
      tempo: tempo(2, 3, 2, 1),
      reps: 6,
      sets: 1,
      targetRegions: ["lumbar", "shoulder_right", "hip_left"],
      cues: ["Keep your back flat like a table.", "Do not rotate your hips."],
      stopIf: ["Pain in your lower back."],
    },
  },
  {
    id: "standing_arm_raise",
    name: "Standing Arm Raise",
    keywords: ["arm raise", "shoulder flexion", "overhead reach", "arm raises"],
    voiceCue: "Stand tall and slowly raise both arms in front of you as high as is comfortable.",
    spec: {
      posture: "standing",
      startPose: [],
      movements: [e("shoulder", "flexion", 140, "both")],
      alternateSides: false,
      pins: [],
      tempo: tempo(3, 2, 3, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["shoulder_left", "shoulder_right"],
      cues: ["Keep your shoulders relaxed, away from your ears."],
      stopIf: ["Sharp or catching pain in the shoulder."],
    },
  },
  {
    id: "seated_knee_extension",
    name: "Seated Knee Extension",
    keywords: ["knee extension", "long arc quad", "seated leg straighten", "leg extension"],
    voiceCue: "Sitting tall, straighten one knee, hold, then lower it slowly.",
    spec: {
      posture: "seated",
      startPose: [],
      movements: [e("knee", "extension", 0, "left")],
      alternateSides: true,
      pins: [],
      tempo: tempo(2, 3, 2, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["knee_left"],
      cues: ["Tighten the muscle on top of your thigh."],
      stopIf: ["Sharp pain in the knee."],
    },
  },
  {
    id: "seated_knee_lift",
    name: "Seated Knee Lift",
    keywords: ["knee lift", "knee lifts", "seated march", "marching", "seated knee lifts"],
    voiceCue: "Sitting tall, lift one knee a little, then lower it and switch sides.",
    spec: {
      posture: "seated",
      startPose: [],
      movements: [e("hip", "flexion", 108, "left")],
      alternateSides: true,
      pins: [],
      tempo: tempo(1.5, 1, 1.5, 0.5),
      reps: 10,
      sets: 1,
      targetRegions: ["hip_left"],
      cues: ["Do not lean back."],
      stopIf: ["Pain in your hip or groin."],
    },
  },
  {
    id: "seated_elbow_flexion",
    name: "Seated Elbow Bend",
    keywords: ["elbow flexion", "elbow bend", "biceps curl", "bicep curl", "elbow bends"],
    voiceCue: "Bend both elbows to bring your hands toward your shoulders, then lower them.",
    spec: {
      posture: "seated",
      startPose: [e("shoulder", "flexion", 0, "both"), e("elbow", "flexion", 10, "both")],
      movements: [e("elbow", "flexion", 115, "both")],
      alternateSides: false,
      pins: [],
      tempo: tempo(2, 1, 2, 1),
      reps: 10,
      sets: 1,
      targetRegions: ["elbow_left", "elbow_right"],
      cues: ["Keep your upper arms still by your sides."],
      stopIf: ["Pain at the elbow."],
    },
  },
  {
    id: "seated_wrist_flexion",
    name: "Seated Wrist Bend",
    keywords: ["wrist flexion", "wrist extension", "wrist bend", "wrist curls"],
    voiceCue: "With your forearm supported, bend your wrist up and down slowly.",
    spec: {
      posture: "seated",
      startPose: [
        e("shoulder", "flexion", 20, "both"),
        e("elbow", "flexion", 90, "both"),
        e("forearm", "pronation", 60, "both"),
        e("wrist", "extension", 40, "both"),
      ],
      movements: [e("wrist", "flexion", 50, "both")],
      alternateSides: false,
      pins: [],
      tempo: tempo(2, 1, 2, 1),
      reps: 10,
      sets: 1,
      targetRegions: ["wrist_hand_left", "wrist_hand_right"],
      cues: ["Move only at the wrist."],
      stopIf: ["Numbness or tingling in your fingers."],
    },
  },
  {
    id: "standing_heel_raise",
    name: "Standing Heel Raise",
    keywords: ["heel raise", "calf raise", "heel raises", "calf raises"],
    voiceCue: "Stand tall and rise up onto your toes, then lower slowly.",
    spec: {
      posture: "standing",
      startPose: [],
      movements: [e("ankle", "plantarflexion", 30, "both")],
      alternateSides: false,
      pins: [],
      tempo: tempo(2, 1, 2, 1),
      reps: 10,
      sets: 1,
      targetRegions: ["ankle_foot_left", "ankle_foot_right"],
      cues: ["Hold a stable surface for balance."],
      stopIf: ["Pain at the back of the heel."],
    },
  },
  {
    id: "mini_squat",
    name: "Mini Squat",
    keywords: ["mini squat", "squat", "sit to stand", "partial squat"],
    voiceCue: "Bend your hips and knees a little as if to sit, then stand back up.",
    spec: {
      posture: "standing",
      startPose: [],
      movements: [
        e("hip", "flexion", 45, "both"),
        e("knee", "flexion", 55, "both"),
        e("ankle", "dorsiflexion", 12, "both"),
        e("shoulder", "flexion", 60, "both"),
      ],
      alternateSides: false,
      pins: ["left_foot", "right_foot"],
      tempo: tempo(3, 1, 3, 1),
      reps: 8,
      sets: 1,
      targetRegions: ["knee_left", "knee_right", "hip_left", "hip_right"],
      cues: ["Keep your knees in line with your toes."],
      stopIf: ["Sharp knee pain."],
    },
  },
];

const POSTURE_WORDS: Record<Posture, string[]> = {
  standing: ["standing", "stand"],
  seated: ["seated", "sitting", "chair"],
  supine: ["supine", "lying on back", "on your back", "lying"],
  prone: ["prone", "face down", "on your front"],
  quadruped: ["quadruped", "hands and knees", "all fours"],
};

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best reference exercise for an exercise name, or null when nothing matches. */
export function findReferenceExercise(name: string): ReferenceExercise | null {
  const text = ` ${normalize(name)} `;
  let best: { exercise: ReferenceExercise; score: number } | null = null;
  for (const exercise of REFERENCE_EXERCISES) {
    let score = 0;
    for (const keyword of exercise.keywords) {
      if (text.includes(` ${normalize(keyword)} `)) score = Math.max(score, normalize(keyword).length);
    }
    if (score === 0) continue;
    if (POSTURE_WORDS[exercise.spec.posture].some((word) => text.includes(` ${normalize(word)} `))) score += 50;
    if (!best || score > best.score) best = { exercise, score };
  }
  return best?.exercise ?? null;
}
