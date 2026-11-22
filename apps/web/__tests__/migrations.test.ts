// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * `prisma migrate deploy` on an empty database applies the migrations in name order. These checks read
 * the SQL and the schema, so a migration that uses a table nothing has created yet (as the precautions
 * migration once did) fails here instead of on a fresh deploy.
 */

const ROOT = join(__dirname, "..", "..", "..", "prisma");
const MIGRATIONS = join(ROOT, "migrations");

const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sql = (folder: string) => readFileSync(join(MIGRATIONS, folder, "migration.sql"), "utf8");

const created = (text: string) => [...text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g)].map((match) => match[1]);
const used = (text: string) => [
  ...[...text.matchAll(/ALTER TABLE (?:ONLY )?"([^"]+)"/g)].map((match) => match[1]),
  ...[...text.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"[^"]+" ON "([^"]+)"/g)].map((match) => match[1]),
  ...[...text.matchAll(/REFERENCES "([^"]+)"/g)].map((match) => match[1]),
];

describe("prisma migrations on an empty database", () => {
  it("are ordered by unique timestamps", () => {
    const stamps = folders.map((name) => name.split("_")[0]);
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(folders.every((name) => /^\d{14}_[a-z0-9_]+$/.test(name))).toBe(true);
  });

  it("never touch a table before an earlier migration (or the same one) has created it", () => {
    const known = new Set<string>();
    for (const folder of folders) {
      const text = sql(folder);
      for (const table of created(text)) known.add(table);
      const missing = [...new Set(used(text))].filter((table) => !known.has(table));
      expect(missing, `${folder} uses tables nothing has created yet`).toEqual([]);
    }
  });

  it("create every table the schema defines", () => {
    const schema = readFileSync(join(ROOT, "schema.prisma"), "utf8");
    const tables = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((match) => match[2].match(/@@map\("([^"]+)"\)/)?.[1] ?? match[1]);
    const all = new Set(folders.flatMap((folder) => created(sql(folder))));
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((table) => !all.has(table))).toEqual([]);
  });

  it("create the triage and plan tables before the precautions columns are added to them", () => {
    const triage = folders.find((name) => name.endsWith("_add_triage_and_treatment_plan"));
    const precautions = folders.find((name) => name.endsWith("_add_plan_precautions"));
    expect(triage).toBeDefined();
    expect(precautions).toBeDefined();
    expect(folders.indexOf(triage!)).toBeLessThan(folders.indexOf(precautions!));
    expect(created(sql(triage!)).sort()).toEqual(["QuizAnswer", "TreatmentPlan", "TriageQuiz"]);
  });

  it("keep the columns later migrations add out of the table's creation", () => {
    const text = sql(folders.find((name) => name.endsWith("_add_triage_and_treatment_plan"))!);
    expect(text).not.toMatch(/permanentPrecautions|dynamicPrecautions/);
  });

  it("can be run again on a database that already has these tables (every statement is guarded)", () => {
    const text = sql(folders.find((name) => name.endsWith("_add_triage_and_treatment_plan"))!);
    expect(text.match(/CREATE TABLE "/g)).toBeNull();
    expect(text.match(/CREATE (?:UNIQUE )?INDEX "/g)).toBeNull();
    const constraints = [...text.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((match) => match[1]);
    expect(constraints).toHaveLength(3);
    for (const name of constraints) expect(text).toContain(`conname = '${name}'`);
  });
});
