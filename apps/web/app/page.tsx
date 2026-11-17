import type { Metadata } from "next";
import { ClosingSection, LandingFooter } from "@/components/landing/ClosingSection";
import { CompanionSection } from "@/components/landing/CompanionSection";
import { GuidanceSection } from "@/components/landing/GuidanceSection";
import { Hero } from "@/components/landing/Hero";
import { IntakeSection } from "@/components/landing/IntakeSection";
import { LandingNav } from "@/components/landing/LandingNav";
import { SafetySection } from "@/components/landing/SafetySection";
import { TriageSection } from "@/components/landing/TriageSection";
import styles from "@/components/landing/landing.module.css";

export const metadata: Metadata = {
  title: "SomaCue: bringing physiotherapy to life through 3D",
  description:
    "An AI-assisted home rehab prototype: source-attributed triage, a live 3D movement stage and deterministic safety locks.",
};

export default function HomePage() {
  return (
    <div className={styles.page}>
      <LandingNav />
      <main>
        <Hero />
        <IntakeSection />
        <TriageSection />
        <GuidanceSection />
        <CompanionSection />
        <SafetySection />
        <ClosingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
