/**
 * Blind validation pass — re-maps SIC codes independently of existing mappings.
 * Compares results against official mappings and records agreement/disagreement.
 *
 * Verdict:
 *   "agree"    — exact same NAICS code
 *   "family"   — different code but same 4-digit parent (close miss)
 *   "disagree" — different code, different parent (real disagreement)
 *
 * Usage: npx tsx scripts/validate.ts [--label "My label"] [--only-medium]
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { sicCodes, naicsCodes, mappings, validationRuns, validationResults } from "../db/schema";

const client = postgres((process.env.DATABASE_URL || process.env.POSTGRES_URL)!, { prepare: false });
const db = drizzle(client, { schema: { sicCodes, naicsCodes, mappings, validationRuns, validationResults } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 20;

const args = process.argv.slice(2);
const labelArg = args.includes("--label") ? args[args.indexOf("--label") + 1] : null;
const onlyMedium = args.includes("--only-medium");
const label = labelArg ?? `Blind validation – ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

interface BlindResult {
  sicCode: string;
  naicsCode: string;
  confidence: number;
  rationale: string;
}

async function blindMapBatch(
  sics: { code: string; description: string; divisionTitle: string; majorGroupTitle: string; industryGroupTitle: string }[],
  naicsIndex: string
): Promise<BlindResult[]> {
  const sicList = sics.map((s) =>
    `${s.code}: ${s.description}\n  Division: ${s.divisionTitle} | Major Group: ${s.majorGroupTitle} | Industry Group: ${s.industryGroupTitle}`
  ).join("\n\n");

  const prompt = `You are an industry classification expert. Map each SIC 4-digit code below to the single best NAICS 2022 code.

NAICS 2022 codes (code: title — level):
${naicsIndex}

SIC codes to map:
${sicList}

Rules:
- Choose the most specific NAICS code that genuinely fits (6-digit > 5-digit > 4-digit)
- Focus on the PRIMARY economic activity
- Do not guess — if unsure between two codes, pick the one that covers more of the SIC industry's typical activity
- Confidence: 90-100 near-perfect, 70-89 good, 50-69 reasonable, <50 poor

Respond with JSON array only:
[{ "sicCode": "XXXX", "naicsCode": "XXXXXX", "confidence": 85, "rationale": "One sentence" }]`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text}`);
  return JSON.parse(jsonMatch[0]);
}

function verdict(suggested: string, official: string): "agree" | "family" | "disagree" {
  if (suggested === official) return "agree";
  if (suggested.slice(0, 4) === official.slice(0, 4)) return "family";
  return "disagree";
}

async function main() {
  // Load NAICS codes for the prompt index (levels 4–6)
  const allNaics = await db
    .select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level })
    .from(naicsCodes)
    .then((r) => r.filter((n) => n.level >= 4));

  const naicsMap = new Map(allNaics.map((n) => [n.code, n]));
  const naicsIndex = allNaics.map((n) => `${n.code}: ${n.title} — ${n.level}-digit`).join("\n");

  // Load official mappings
  const officialMappings = await db.select().from(mappings);
  const officialMap = new Map(officialMappings.map((m) => [m.sicCode, m]));

  // Load SIC codes to validate
  const allSics = await db.select().from(sicCodes);
  const toValidate = onlyMedium
    ? allSics.filter((s) => {
        const m = officialMap.get(s.code);
        return m && m.confidence >= 50 && m.confidence < 80;
      })
    : allSics.filter((s) => officialMap.has(s.code));

  console.log(`Validating ${toValidate.length} SIC codes (${onlyMedium ? "medium confidence only" : "all mapped"})`);
  console.log(`Label: "${label}"\n`);

  // Create the run record
  const [run] = await db.insert(validationRuns).values({
    label,
    model: MODEL,
    totalCodes: toValidate.length,
    agreedCount: 0,
    familyCount: 0,
    disagreedCount: 0,
  }).returning();

  let agreed = 0, family = 0, disagreed = 0, errors = 0;

  for (let i = 0; i < toValidate.length; i += BATCH_SIZE) {
    const batch = toValidate.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toValidate.length / BATCH_SIZE)}: ${batch[0].code}–${batch[batch.length - 1].code}`);

    try {
      const results = await blindMapBatch(batch, naicsIndex);
      const valid = results.filter((r) => naicsMap.has(r.naicsCode));

      for (const r of valid) {
        const official = officialMap.get(r.sicCode);
        if (!official) continue;

        const naics = naicsMap.get(r.naicsCode)!;
        const v = verdict(r.naicsCode, official.naicsCode);

        await db.insert(validationResults).values({
          runId: run.id,
          sicCode: r.sicCode,
          suggestedNaicsCode: r.naicsCode,
          suggestedNaicsLevel: naics.level,
          suggestedConfidence: r.confidence,
          suggestedRationale: r.rationale,
          officialNaicsCode: official.naicsCode,
          officialMethod: official.method,
          officialConfidence: official.confidence,
          verdict: v,
        });

        if (v === "agree") agreed++;
        else if (v === "family") family++;
        else disagreed++;
      }

      const batchAgreed = valid.filter((r) => {
        const off = officialMap.get(r.sicCode);
        return off && verdict(r.naicsCode, off.naicsCode) === "agree";
      }).length;
      console.log(`  ${valid.length} results — ${batchAgreed} agree`);
    } catch (e) {
      console.error(`  Error:`, e);
      errors++;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  // Update run summary
  await db.update(validationRuns).set({ agreedCount: agreed, familyCount: family, disagreedCount: disagreed })
    .where(eq(validationRuns.id, run.id));

  const total = agreed + family + disagreed;
  console.log(`\n=== Validation Run #${run.id} Complete ===`);
  console.log(`Agree:     ${agreed} (${pct(agreed, total)}%)`);
  console.log(`Family:    ${family} (${pct(family, total)}%) — same 4-digit parent`);
  console.log(`Disagree:  ${disagreed} (${pct(disagreed, total)}%)`);
  console.log(`Errors:    ${errors} batches`);

  await client.end();
}

function pct(n: number, total: number) {
  return total ? Math.round(n / total * 100) : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
