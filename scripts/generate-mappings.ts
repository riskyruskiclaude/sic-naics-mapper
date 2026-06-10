/**
 * AI mapping pass — generates SIC→NAICS mappings for codes not yet mapped.
 * Safe to re-run — skips already-mapped SIC codes.
 * Maps to the most specific NAICS level possible (6-digit preferred, 5 or 4 if better fit).
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { sicCodes, naicsCodes, mappings, mappingRevisions } from "../db/schema";

const client = postgres((process.env.DATABASE_URL || process.env.POSTGRES_URL)!, { prepare: false });
const db = drizzle(client, { schema: { sicCodes, naicsCodes, mappings, mappingRevisions } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const BATCH_SIZE = 20;

interface MappingResult {
  sicCode: string;
  naicsCode: string;
  confidence: number;
  rationale: string;
}

async function mapBatch(
  sics: { code: string; description: string; divisionTitle: string; majorGroupTitle: string }[],
  naicsIndex: string
): Promise<MappingResult[]> {
  const sicList = sics
    .map((s) => `${s.code}: ${s.description} (Division: ${s.divisionTitle}, Group: ${s.majorGroupTitle})`)
    .join("\n");

  const prompt = `You are mapping SIC 4-digit industry codes to their best equivalent NAICS 2022 code.

NAICS codes available (code: title — level):
${naicsIndex}

SIC codes to map:
${sicList}

Instructions:
- Match each SIC to the SINGLE most accurate NAICS code
- Prefer the most specific level (6-digit > 5-digit > 4-digit) — only use a broader code if no specific code truly fits
- Focus on the PRIMARY activity of the industry, not edge cases
- Confidence: 90-100 = near-perfect match, 70-89 = good match with minor differences, 50-69 = reasonable but imprecise, <50 = best available but poor fit
- Rationale: one sentence explaining the match and any important differences

Respond with a JSON array only, no other text:
[
  {
    "sicCode": "XXXX",
    "naicsCode": "XXXXXX",
    "confidence": 85,
    "rationale": "One sentence explanation"
  }
]`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text}`);
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  // Load NAICS codes at levels 4, 5, 6 for the prompt
  const allNaics = await db
    .select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level })
    .from(naicsCodes)
    .then((rows) => rows.filter((r) => r.level >= 4));

  const naicsMap = new Map(allNaics.map((n) => [n.code, n]));
  const naicsIndex = allNaics.map((n) => `${n.code}: ${n.title} — ${n.level}-digit`).join("\n");

  // Load unmapped SIC codes
  const existing = await db.select({ sicCode: mappings.sicCode }).from(mappings);
  const mappedSet = new Set(existing.map((m) => m.sicCode));
  const unmapped = await db.select().from(sicCodes).then((rows) => rows.filter((r) => !mappedSet.has(r.code)));

  console.log(`${unmapped.length} SIC codes to map`);

  for (let i = 0; i < unmapped.length; i += BATCH_SIZE) {
    const batch = unmapped.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(unmapped.length / BATCH_SIZE)}: codes ${batch[0].code}–${batch[batch.length - 1].code}`);

    try {
      const results = await mapBatch(batch, naicsIndex);
      const valid = results.filter((r) => naicsMap.has(r.naicsCode));

      if (valid.length < results.length) {
        const invalid = results.filter((r) => !naicsMap.has(r.naicsCode));
        console.warn(`  Dropped ${invalid.length} results with invalid NAICS codes:`, invalid.map((r) => r.naicsCode));
      }

      for (const r of valid) {
        const naics = naicsMap.get(r.naicsCode)!;
        const [inserted] = await db.insert(mappings).values({
          sicCode: r.sicCode,
          naicsCode: r.naicsCode,
          naicsLevel: naics.level,
          confidence: r.confidence,
          method: "ai_generated",
          rationale: r.rationale,
        }).onConflictDoNothing().returning();

        if (inserted) {
          // Record initial state in history
          await db.insert(mappingRevisions).values({
            mappingId: inserted.id,
            sicCode: inserted.sicCode,
            naicsCode: inserted.naicsCode,
            naicsLevel: inserted.naicsLevel,
            confidence: inserted.confidence,
            method: inserted.method,
            rationale: inserted.rationale,
            changedBy: "system:ai_generated",
          });
        }
      }

      console.log(`  Inserted ${valid.length} mappings`);
    } catch (e) {
      console.error(`  Error in batch:`, e);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await client.end();
  console.log("Mapping complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
