// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  report: null as null | Row,
  writes: 0,
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => ({ id: "patient-1", email: "a@b.c", name: "Asha" }) }));
vi.mock("@/lib/billing/entitlements", () => ({ getBillingStatus: async () => ({ tier: "free" }) }));
vi.mock("@/lib/clinical/server-escalation", () => ({ toEscalation: () => null }));
vi.mock("@/lib/intake/reportFiles", () => ({ reportFilesFromRecord: () => ({ scans: [], prescriptions: [], uncategorized: [] }) }));
vi.mock("@/app/workspace/WorkspaceClient", () => ({ default: () => null }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    clinicalReport: { findFirst: async () => db.report },
    dailyProgress: {
      findMany: async () => {
        return [{ dateKey: keyDaysAgo(0), feedback: "issue", discomfortExercises: ["Ankle Pumps"] }];
      },
    },
    painEvent: { findMany: async () => [] },
    treatmentPlan: {
      update: async () => {
        db.writes += 1;
        return {};
      },
    },
  },
}));

import WorkspacePage from "@/app/workspace/page";
import { initialPrecautions, SAFE_DEFAULTS } from "@/lib/precautions/precautions";

const keyDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const STEPS = [
  { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
  { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
  { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
];

function setReport(plan: { permanentPrecautions: unknown; dynamicPrecautions: unknown }, startDaysAgo = 9) {
  db.report = {
    id: "report-1",
    patientId: "patient-1",
    primarySymptoms: "Low back pain",
    createdAt: new Date(),
    conditionTitle: null,
    conditionSummary: null,
    conditionSource: null,
    requiresInPersonCare: false,
    careReason: null,
    triageQuiz: null,
    dailyProgress: [],
    painEvents: [],
    treatmentPlan: {
      id: "plan-1",
      createdAt: new Date(Date.now() - startDaysAgo * 86_400_000),
      routine: {
        durationMonths: 2,
        phases: [
          { phase: "Calm", tagline: "Settle the irritated tissue" },
          { phase: "Build", tagline: "Add strength and range" },
        ],
        steps: STEPS,
        startDateKey: keyDaysAgo(startDaysAgo),
      },
      ...plan,
    },
  };
}

async function renderedProps() {
  const element = (await WorkspacePage({ searchParams: Promise.resolve({}) })) as { props: Row };
  return element.props;
}

beforeEach(() => {
  db.report = null;
  db.writes = 0;
});

describe("/workspace for a plan saved before precautions existed", () => {
  it("builds the card from the safe defaults, the current week and recent feedback, with no write", async () => {
    setReport({ permanentPrecautions: null, dynamicPrecautions: null }, 9); // Day 10, week 2
    const props = await renderedProps();
    const precautions = props.initialPrecautions as NonNullable<ReturnType<typeof initialPrecautions>>;

    expect(precautions).not.toBeNull();
    expect(precautions.permanent).toEqual([...SAFE_DEFAULTS]);
    expect(precautions.dynamic).toMatchObject({ kind: "week", badge: "Week 2 • Active", weekNumber: 2, phaseIndex: 0, seenAt: null });
    expect(precautions.dynamic.items.length).toBeGreaterThanOrEqual(3);
    expect(precautions.dynamic.items.length).toBeLessThanOrEqual(5);
    expect(precautions.dynamic.items.join(" ")).toContain("More discomfort with Ankle Pumps");
    expect(db.writes).toBe(0);
  });

  it("fills only the missing half when one column is null", async () => {
    const saved = initialPrecautions({ permanentPrecautions: ["Keep your back neutral.", "Avoid heavy lifting.", "Stop for leg numbness."], dynamicPrecautions: ["Small ranges."] });
    setReport({ permanentPrecautions: saved.permanent, dynamicPrecautions: null }, 2);
    const half = (await renderedProps()).initialPrecautions as typeof saved;
    expect(half.permanent).toEqual(saved.permanent);
    expect(half.dynamic.kind).toBe("week");

    setReport({ permanentPrecautions: null, dynamicPrecautions: saved.dynamic }, 2);
    const other = (await renderedProps()).initialPrecautions as typeof saved;
    expect(other.permanent).toEqual([...SAFE_DEFAULTS]);
    expect(other.dynamic).toEqual(saved.dynamic);
  });

  it("passes saved precautions through untouched", async () => {
    const saved = initialPrecautions({ permanentPrecautions: ["Keep your back neutral.", "Avoid heavy lifting.", "Stop for leg numbness."], dynamicPrecautions: ["Small ranges.", "Go slowly.", "Rest."] });
    setReport({ permanentPrecautions: saved.permanent, dynamicPrecautions: saved.dynamic }, 2);
    expect((await renderedProps()).initialPrecautions).toEqual(saved);
  });

  it("shows no card when there is no plan yet", async () => {
    db.report = { ...(setReport({ permanentPrecautions: null, dynamicPrecautions: null }), db.report), treatmentPlan: null };
    expect((await renderedProps()).initialPrecautions).toBeNull();
  });
});
