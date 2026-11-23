import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AnalysisProgress } from "@/components/workspace/AnalysisProgress";
import { buildSynthesisCopy, buildTriageCopy } from "@/lib/analysis/progressCopy";
import { isTrustedUploadUrl, orderedReportFiles, reportFilesFromRecord } from "@/lib/intake/reportFiles";

const intake = {
  symptoms: "Pain and stiffness around the right knee after long walks.",
  scanCount: 2,
  prescriptionCount: 1,
};

describe("analysis progress copy", () => {
  it("personalises triage lines from the categorized intake", () => {
    const copy = buildTriageCopy(intake);
    const text = copy.lines.join("\n");

    expect(text).toContain("your 3 uploaded files");
    expect(text).toContain("your 2 scans");
    expect(text).toContain("your clinician's prescription");
    expect(text).toContain("guidance in your clinician's notes");
    expect(text).not.toContain("no clinician's prescription");
    expect(text).toContain("right knee");
    expect(text).toContain("long walks");
    expect(copy.context).toEqual(["Right knee", "2 scans", "1 prescription", "Long walks"]);
    expect(new Set(copy.lines).size).toBe(copy.lines.length);
  });

  it("adds a caution line when no prescription was uploaded", () => {
    const copy = buildTriageCopy({ ...intake, prescriptionCount: 0 });
    const text = copy.lines.join("\n");

    expect(text).toContain("no clinician's prescription was provided");
    expect(copy.context).toEqual(["Right knee", "2 scans", "Long walks"]);
  });

  it("falls back to symptom-only copy without uploads", () => {
    const copy = buildTriageCopy({ symptoms: "Something feels off", scanCount: 0, prescriptionCount: 0 });

    expect(copy.lines[0]).toBe("Reading your symptom description closely…");
    expect(copy.lines.join(" ")).not.toMatch(/scan|report|file/i);
    expect(copy.context).toEqual(["Symptom description"]);
  });

  it("builds a longer synthesis sequence that quotes the patient", () => {
    const triage = buildTriageCopy(intake);
    const copy = buildSynthesisCopy(intake, [
      { question: "When does it hurt?", answer: "Only after activity", multipleChoice: true },
      { question: "How bad is it?", answer: "About 6/10 at worst", multipleChoice: false },
      { question: "Any swelling?", answer: "No", multipleChoice: true },
    ]);
    const text = copy.lines.join("\n");

    expect(copy.lines.length).toBeGreaterThan(triage.lines.length);
    expect(text).toContain("3 answers");
    expect(text).toContain("“Only after activity”");
    expect(text).toContain("6/10");
    expect(text).toContain("right knee");
    expect(text).toContain("within your clinician's prescription");
    expect(text).toContain("against your 2 scans");
    expect(text).toContain("walking distance tolerance");
    expect(new Set(copy.lines).size).toBe(copy.lines.length);
  });

  it("describes reports saved before uploads were categorized", () => {
    const copy = buildTriageCopy({ symptoms: "Sore neck", scanCount: 0, prescriptionCount: 0, otherCount: 2 });

    expect(copy.lines.join("\n")).toContain("your 2 reports");
    expect(copy.context).toContain("2 reports");
  });
});

describe("report files", () => {
  describe("accepts only references produced by the upload action", () => {
    const UUID = "12f80538-4e07-4160-82c1-48d2dccb3612";

    beforeEach(() => {
      vi.stubEnv("UPLOADS_BUCKET", "somacue-uploads-test");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("accepts a file in the configured bucket and, outside production, a development file", () => {
      expect(isTrustedUploadUrl(`s3://somacue-uploads-test/uploads/${UUID}.pdf`)).toBe(true);
      expect(isTrustedUploadUrl(`s3://somacue-uploads-test/uploads/${UUID}`)).toBe(true);
      expect(isTrustedUploadUrl(`/uploads/${UUID}.jpeg`)).toBe(true);
    });

    it("rejects other buckets, other prefixes, traversal and every URL form", () => {
      expect(isTrustedUploadUrl(`s3://another-bucket/uploads/${UUID}.pdf`)).toBe(false);
      expect(isTrustedUploadUrl(`s3://somacue-uploads-test/releases/${UUID}.pdf`)).toBe(false);
      expect(isTrustedUploadUrl("s3://somacue-uploads-test/uploads/../secrets.pdf")).toBe(false);
      expect(isTrustedUploadUrl("s3://somacue-uploads-test/uploads/a.pdf")).toBe(false);
      expect(isTrustedUploadUrl(`https://somacue-uploads-test.s3.amazonaws.com/uploads/${UUID}.pdf`)).toBe(false);
      expect(isTrustedUploadUrl("https://acct.blob.core.windows.net/patient-scans/a.pdf")).toBe(false);
      expect(isTrustedUploadUrl("/uploads/../../.env")).toBe(false);
      expect(isTrustedUploadUrl("/etc/passwd")).toBe(false);
      expect(isTrustedUploadUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    });

    it("accepts nothing from S3 when no bucket is configured", () => {
      vi.stubEnv("UPLOADS_BUCKET", "");
      expect(isTrustedUploadUrl(`s3://somacue-uploads-test/uploads/${UUID}.pdf`)).toBe(false);
    });

    it("does not accept development files in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(isTrustedUploadUrl(`/uploads/${UUID}.jpeg`)).toBe(false);
      expect(isTrustedUploadUrl(`s3://somacue-uploads-test/uploads/${UUID}.pdf`)).toBe(true);
    });
  });

  it("lists a report's files in the order the download route uses", () => {
    expect(
      orderedReportFiles({ fileUrls: ["s1", "p1", "old"], scanUrls: ["s1"], prescriptionUrls: ["p1"] }),
    ).toEqual(["s1", "p1", "old"]);
  });
  it("splits a stored report into categories and keeps legacy files", () => {
    expect(
      reportFilesFromRecord({ fileUrls: ["s", "p"], scanUrls: ["s"], prescriptionUrls: ["p"] }),
    ).toEqual({ scans: ["s"], prescriptions: ["p"], uncategorized: [] });
    expect(reportFilesFromRecord({ fileUrls: ["old1", "old2"] })).toEqual({
      scans: [],
      prescriptions: [],
      uncategorized: ["old1", "old2"],
    });
  });
});

describe("AnalysisProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5); // 8 s per line
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const copy = { lines: ["First step…", "Second step…", "Last step…"], holdMessage: "Please wait.", context: ["Right knee"] };

  const renderProgress = (arrived = false, onComplete = vi.fn()) =>
    render(
      <AnalysisProgress
        arrived={arrived}
        copy={copy}
        doneMessage="Ready."
        eyebrow="Diagnostic triage"
        footnote="Opens here."
        onComplete={onComplete}
        timeConstant={30}
      />,
    );

  it("advances one line every 7–9 s, never loops, then holds", () => {
    renderProgress();
    expect(screen.getByText("First step…")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(7900));
    expect(screen.getByText("First step…")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("Second step…")).toBeInTheDocument();

    // Each line's timer is scheduled after the previous render, so step through them.
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText("Last step…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText("Please wait.")).toBeInTheDocument();

    for (let i = 0; i < 6; i += 1) act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Please wait.")).toBeInTheDocument();
    expect(screen.queryByText("First step…")).not.toBeInTheDocument();
  });

  it("eases toward 95% while waiting and completes to 100% on arrival", () => {
    const onComplete = vi.fn();
    const { rerender } = renderProgress(false, onComplete);
    const ring = screen.getByRole("progressbar");

    act(() => vi.advanceTimersByTime(20_000));
    const midway = Number(ring.getAttribute("aria-valuenow"));
    expect(midway).toBeGreaterThan(15);
    expect(midway).toBeLessThan(95);

    act(() => vi.advanceTimersByTime(600_000));
    expect(Number(ring.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(95);

    rerender(
      <AnalysisProgress
        arrived
        copy={copy}
        doneMessage="Ready."
        eyebrow="Diagnostic triage"
        footnote="Opens here."
        onComplete={onComplete}
        timeConstant={30}
      />,
    );
    act(() => vi.advanceTimersByTime(3000));

    expect(ring).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("Ready.")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
