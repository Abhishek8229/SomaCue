#!/usr/bin/env node
/**
 * Creates the "SomaCue Pro Monthly" Razorpay plan and writes its id into
 * apps/web/.env as RAZORPAY_PRO_PLAN_ID.
 *
 *   node scripts/setup-razorpay-plan.mjs [--force]
 *
 * - Does nothing when RAZORPAY_PRO_PLAN_ID is already set (use --force to replace it).
 * - Razorpay plans cannot be deleted, so before creating one the script looks for
 *   an existing plan with the same name, period and amount and reuses it. Running
 *   it twice, or after a failed .env write, never leaves duplicates.
 * - Reads RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from apps/web/.env. Secrets are
 *   never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, "apps/web/.env");
const API = "https://api.razorpay.com/v1";

export const PRO_PLAN = {
  name: "SomaCue Pro Monthly",
  description: "30 days of SomaCue Pro: unlimited re-analysis, the full adaptive schedule and Rehab Companion chat.",
  period: "monthly",
  interval: 1,
  amount: 19900, // paise: Rs 199.00
  currency: "INR",
};

function readEnvValue(text, name) {
  const match = new RegExp(`^${name}\\s*=\\s*(.*)$`, "m").exec(text);
  if (!match) return "";
  return match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
}

/** Sets name=value in .env text, keeping every other line and the file's line endings. */
export function withEnvValue(text, name, value) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}\\s*=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text}${text.endsWith("\n") || text.length === 0 ? "" : eol}${line}${eol}`;
}

async function razorpay(path, { method = "GET", body } = {}, auth) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.description ?? `HTTP ${response.status}`;
    throw new Error(`Razorpay ${method} ${path} failed: ${reason}`);
  }
  return data;
}

const matches = (plan) =>
  plan?.period === PRO_PLAN.period &&
  plan?.interval === PRO_PLAN.interval &&
  plan?.item?.name === PRO_PLAN.name &&
  plan?.item?.amount === PRO_PLAN.amount &&
  plan?.item?.currency === PRO_PLAN.currency;

async function main() {
  const force = process.argv.includes("--force");
  const envText = readFileSync(ENV_PATH, "utf8");
  const keyId = readEnvValue(envText, "RAZORPAY_KEY_ID");
  const keySecret = readEnvValue(envText, "RAZORPAY_KEY_SECRET");
  const existing = readEnvValue(envText, "RAZORPAY_PRO_PLAN_ID");

  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in apps/web/.env.");
  }
  if (existing && !force) {
    console.log(`RAZORPAY_PRO_PLAN_ID is already set (${existing}). Nothing to do. Use --force to replace it.`);
    return;
  }

  const mode = keyId.startsWith("rzp_live_") ? "LIVE" : "test";
  console.log(`Razorpay ${mode} mode.`);
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  const list = await razorpay("/plans?count=100", {}, auth);
  const reusable = (list.items ?? []).find(matches);
  let plan = reusable;
  if (reusable) {
    console.log(`Found an existing "${PRO_PLAN.name}" plan, reusing it.`);
  } else {
    plan = await razorpay(
      "/plans",
      {
        method: "POST",
        body: {
          period: PRO_PLAN.period,
          interval: PRO_PLAN.interval,
          item: {
            name: PRO_PLAN.name,
            description: PRO_PLAN.description,
            amount: PRO_PLAN.amount,
            currency: PRO_PLAN.currency,
          },
          notes: { product: "somacue-pro" },
        },
      },
      auth,
    );
    console.log(`Created plan "${PRO_PLAN.name}".`);
  }

  if (typeof plan?.id !== "string" || !plan.id.startsWith("plan_")) {
    throw new Error("Razorpay did not return a plan id.");
  }

  writeFileSync(ENV_PATH, withEnvValue(envText, "RAZORPAY_PRO_PLAN_ID", plan.id));
  console.log(`RAZORPAY_PRO_PLAN_ID=${plan.id}`);
  console.log("Written to apps/web/.env. Restart the server so it picks up the new value.");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
