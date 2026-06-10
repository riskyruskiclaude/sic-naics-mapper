/**
 * Pass 2: AI disambiguation of crosswalk codes with multiple candidates.
 * Re-evaluates all mappings with method=census_xwalk_disambiguated and confidence=60
 * (i.e. placeholder picks from Pass 1 that need AI to choose the best candidate).
 * Safe to re-run — only processes codes still at confidence 60 with that method.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { sicCodes, naicsCodes, mappings, mappingRevisions } from "../db/schema";

const client = postgres((process.env.DATABASE_URL || process.env.POSTGRES_URL)!, { prepare: false });
const db = drizzle(client, { schema: { sicCodes, naicsCodes, mappings, mappingRevisions } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const BATCH_SIZE = 20;

interface DisambiguationResult {
  sicCode: string;
  naicsCode: string;
  confidence: number;
  rationale: string;
}

async function disambiguateBatch(
  items: { sic: typeof sicCodes.$inferSelect; candidates: string; currentNaics: string }[],
  naicsMap: Map<string, { title: string; level: number }>
): Promise<DisambiguationResult[]> {
  const list = items.map((item) => {
    const sic = item.sic;
    return `SIC ${sic.code}: ${sic.description} (Division: ${sic.divisionTitle}, Major Group: ${sic.majorGroupTitle})
  Candidates: ${item.candidates}`;
  }).join("\n\n");

  const prompt = `You are resolving ambiguous SIC→NAICS mappings. Each SIC code below has multiple possible NAICS matches from the Census crosswalk. Pick the SINGLE best NAICS code for each.

${list}

For each SIC code, choose the NAICS code that best represents the PRIMARY activity of that industry. Consider:
- The core production process or service (not edge cases)
- The most specific code that truly fits (don't use a broader code just to be safe)
- Industry group context (division and major group)

Respond with JSON only:
[
  {
    "sicCode": "XXXX",
    "naicsCode": "XXXXXX",
    "confidence": 85,
    "rationale": "One sentence explaining the choice and why other candidates were rejected"
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
  // Load all NAICS codes for validation
  const allNaics = await db.select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level }).from(naicsCodes);
  const naicsMap = new Map(allNaics.map((n) => [n.code, { title: n.title, level: n.level }]));

  // Load ambiguous mappings (placeholder picks needing disambiguation)
  const ambiguous = await db
    .select({ mapping: mappings, sic: sicCodes })
    .from(mappings)
    .leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code))
    .where(and(eq(mappings.method, "census_xwalk_disambiguated"), eq(mappings.confidence, 60)));

  console.log(`${ambiguous.length} ambiguous mappings to disambiguate`);

  const items = ambiguous
    .filter((r) => r.sic !== null)
    .map((r) => ({
      sic: r.sic!,
      candidates: r.mapping.rationale ?? "",
      currentNaics: r.mapping.naicsCode,
      mappingId: r.mapping.id,
      current: r.mapping,
    }));

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)}: ${batch[0].sic.code}–${batch[batch.length - 1].sic.code}`);

    try {
      const results = await disambiguateBatch(batch, naicsMap);
      const valid = results.filter((r) => naicsMap.has(r.naicsCode));

      if (valid.length < results.length) {
        console.warn(`  Dropped ${results.length - valid.length} invalid NAICS codes`);
      }

      for (const r of valid) {
        const item = batch.find((b) => b.sic.code === r.sicCode);
        if (!item) continue;

        const naics = naicsMap.get(r.naicsCode)!;

        // Save current state to history
        await db.insert(mappingRevisions).values({
          mappingId: item.mappingId,
          sicCode: item.current.sicCode,
          naicsCode: item.current.naicsCode,
          naicsLevel: item.current.naicsLevel,
          confidence: item.current.confidence,
          method: item.current.method,
          rationale: item.current.rationale,
          changedBy: "system:disambiguate_pass",
        });

        // Update to AI-disambiguated result
        await db.update(mappings).set({
          naicsCode: r.naicsCode,
          naicsLevel: naics.level,
          confidence: r.confidence,
          method: "census_xwalk_disambiguated",
          rationale: r.rationale,
          updatedAt: new Date(),
        }).where(eq(mappings.id, item.mappingId));

        updated++;
      }

      console.log(`  Updated ${valid.length} mappings`);
    } catch (e) {
      console.error(`  Error in batch:`, e);
      errors++;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await client.end();
  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
