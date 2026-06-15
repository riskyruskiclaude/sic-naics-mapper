/**
 * Upgrades same-family mappings using the NAICS Association 2022 crosswalk.
 *
 * For each SIC code where our mapping and the 2022 crosswalk share the same
 * 4-digit parent but differ at the 6-digit level:
 *   - If crosswalk has exactly one 6-digit option → upgrade directly
 *   - If crosswalk has multiple options → use AI to pick the best one
 *   - If our code is already more specific than crosswalk → keep ours
 *
 * Skipped SIC codes: 5735 (Record Stores), 2517 (Wood TV Cabinets) — user decision.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { mappings, sicCodes, naicsCodes, mappingRevisions } from "../db/schema";

// @ts-ignore
import * as XLSX from "xlsx";

const SKIP_SICS = new Set(["5735", "2517"]);

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { mappings, sicCodes, naicsCodes, mappingRevisions } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function pickBestNaics(
  sic: string, sicDesc: string, sicContext: string,
  options: { code: string; title: string }[]
): Promise<{ code: string; rationale: string }> {
  const optionList = options.map((o) => `${o.code}: ${o.title}`).join("\n");
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Pick the single best NAICS 2022 code for this SIC industry.

SIC ${sic}: ${sicDesc}
Context: ${sicContext}

NAICS options (all from official 2022 crosswalk):
${optionList}

Respond with JSON only: { "code": "XXXXXX", "rationale": "one sentence" }`
    }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON: ${text}`);
  return JSON.parse(match[0]);
}

async function main() {
  const xlsxPath = process.argv[2] ?? "/tmp/2022-naics-to-sic.xlsx";
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws);

  // Build SIC→[NAICS 6-digit options] from 2022 crosswalk
  const xwalkBySic = new Map<string, Set<string>>();
  for (const row of rows) {
    let sic = String(row["Related SIC Code"] ?? "").replace(/\.0$/, "").trim();
    if (sic.length === 3) sic = "0" + sic;
    if (sic.length !== 4) continue;
    const naics = String(row["2022 NAICS Code"] ?? "").replace(/\.0$/, "").trim();
    if (naics.length !== 6) continue;
    if (!xwalkBySic.has(sic)) xwalkBySic.set(sic, new Set());
    xwalkBySic.get(sic)!.add(naics);
  }

  // Load our current mappings + SIC info
  const currentMappings = await db
    .select({ mapping: mappings, sic: sicCodes })
    .from(mappings)
    .leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code));

  const allNaics = await db.select().from(naicsCodes);
  const naicsMap = new Map(allNaics.map((n) => [n.code, n]));

  // Find same-family cases
  const toUpgrade: {
    mapping: typeof mappings.$inferSelect;
    sic: typeof sicCodes.$inferSelect | null;
    xwalkOptions: string[];
  }[] = [];

  for (const { mapping: m, sic: s } of currentMappings) {
    if (SKIP_SICS.has(m.sicCode)) continue;
    const xwalkOptions = xwalkBySic.get(m.sicCode);
    if (!xwalkOptions) continue;
    if (xwalkOptions.has(m.naicsCode)) continue; // already exact match

    const inFamily = [...xwalkOptions].some((c) => c.slice(0, 4) === m.naicsCode.slice(0, 4));
    if (!inFamily) continue; // true disagreement — skip

    // Only upgrade if crosswalk options are more specific than what we have
    const ourLevel = naicsMap.get(m.naicsCode)?.level ?? 6;
    const xwalkLevels = [...xwalkOptions].map((c) => naicsMap.get(c)?.level ?? 6);
    const maxXwalkLevel = Math.max(...xwalkLevels);
    if (maxXwalkLevel <= ourLevel && ourLevel === 6) continue; // already at 6-digit, crosswalk not better

    toUpgrade.push({ mapping: m, sic: s, xwalkOptions: [...xwalkOptions] });
  }

  console.log(`${toUpgrade.length} mappings to upgrade\n`);

  let direct = 0, aiPicked = 0, kept = 0, errors = 0;

  for (const { mapping: m, sic: s, xwalkOptions } of toUpgrade) {
    // Filter to valid 2022 NAICS codes
    const validOptions = xwalkOptions
      .map((c) => naicsMap.get(c))
      .filter(Boolean) as typeof allNaics;

    if (validOptions.length === 0) { kept++; continue; }

    // If only one option → use it directly
    let chosenCode: string;
    let rationale: string;
    let method: "census_xwalk" | "census_xwalk_disambiguated" = "census_xwalk";

    if (validOptions.length === 1) {
      chosenCode = validOptions[0].code;
      rationale = `Upgraded to 6-digit per NAICS Association 2022 crosswalk (single option).`;
      method = "census_xwalk";
      direct++;
    } else {
      // Multiple options — use AI
      try {
        const context = `${s?.divisionTitle ?? ""} > ${s?.majorGroupTitle ?? ""} > ${s?.industryGroupTitle ?? ""}`;
        const result = await pickBestNaics(
          m.sicCode, s?.description ?? m.sicCode, context,
          validOptions.map((n) => ({ code: n.code, title: n.title }))
        );
        if (!naicsMap.has(result.code)) { kept++; continue; }
        chosenCode = result.code;
        rationale = `Upgraded via 2022 crosswalk + AI disambiguation: ${result.rationale}`;
        method = "census_xwalk_disambiguated";
        aiPicked++;
      } catch (e) {
        console.error(`  Error on ${m.sicCode}:`, e);
        errors++;
        continue;
      }
    }

    // Save current to history
    await db.insert(mappingRevisions).values({
      mappingId: m.id,
      sicCode: m.sicCode,
      naicsCode: m.naicsCode,
      naicsLevel: m.naicsLevel,
      confidence: m.confidence,
      method: m.method,
      rationale: m.rationale,
      changedBy: "system:2022_xwalk_upgrade",
    });

    const chosenNaics = naicsMap.get(chosenCode)!;

    await db.update(mappings).set({
      naicsCode: chosenCode,
      naicsLevel: chosenNaics.level,
      confidence: 90,
      method,
      rationale,
      updatedAt: new Date(),
    }).where(eq(mappings.id, m.id));

    console.log(`${m.sicCode}: ${m.naicsCode} → ${chosenCode} (${chosenNaics.title})`);
  }

  await client.end();
  console.log(`\nDone.`);
  console.log(`  Direct upgrades (single xwalk option): ${direct}`);
  console.log(`  AI-disambiguated (multiple options):   ${aiPicked}`);
  console.log(`  Kept (no better option found):         ${kept}`);
  console.log(`  Errors:                                ${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
