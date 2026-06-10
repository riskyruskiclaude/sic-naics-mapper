/**
 * Pass 1: Import Census Bureau 2002 NAICS↔SIC crosswalk.
 *
 * - SIC codes with exactly one NAICS match → method: census_xwalk, confidence: 95
 * - SIC codes with multiple NAICS matches → method: census_xwalk_disambiguated, stored as
 *   candidates for Pass 2 (AI picks best). Confidence: 0 until disambiguated.
 *
 * Safe to re-run — skips already-mapped SIC codes.
 * Usage: npx tsx scripts/import-crosswalk.ts <path-to-xwalk.xls>
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { sicCodes, naicsCodes, mappings, mappingRevisions } from "../db/schema";

// xlrd is a Python tool; we'll parse via the pre-exported CSV instead
import * as fs from "fs";
import * as readline from "readline";

const client = postgres((process.env.DATABASE_URL || process.env.POSTGRES_URL)!, { prepare: false });
const db = drizzle(client, { schema: { sicCodes, naicsCodes, mappings, mappingRevisions } });

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

async function parseCSV(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  let headers: string[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!headers.length) { headers = parseCSVLine(line); continue; }
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] ?? ""));
    rows.push(row);
  }
  return rows;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/import-crosswalk.ts <naics2002_sic_xwalk.csv>");
    process.exit(1);
  }

  console.log("Loading crosswalk CSV...");
  const rows = await parseCSV(csvPath);
  console.log(`${rows.length} crosswalk rows`);

  // Load valid NAICS codes from DB (our 2022 data)
  const allNaics = await db.select({ code: naicsCodes.code, level: naicsCodes.level }).from(naicsCodes);
  const naicsMap = new Map(allNaics.map((n) => [n.code, n.level]));

  // Load valid SIC codes from DB
  const allSic = await db.select({ code: sicCodes.code }).from(sicCodes);
  const sicSet = new Set(allSic.map((s) => s.code));

  // Load already-mapped SIC codes
  const existing = await db.select({ sicCode: mappings.sicCode }).from(mappings);
  const mappedSet = new Set(existing.map((m) => m.sicCode));

  // Group crosswalk by SIC code → list of NAICS 2002 codes
  // We then try to find the matching NAICS 2022 code (same code often still valid)
  const xwalkBySic = new Map<string, { naicsCode: string; naicsTitle: string; sicTitle: string }[]>();

  for (const row of rows) {
    let sic = row.sic?.replace(/\.0$/, "").trim();
    const naics2002 = row.naics_2002?.replace(/\.0$/, "").trim();
    const naicsTitle = row.naics_title?.trim();
    const sicTitle = row.sic_title?.trim();

    if (!sic || !naics2002) continue;

    // Pad 3-digit agriculture SIC codes
    if (sic.length === 3) sic = "0" + sic;
    if (sic.length !== 4) continue;
    if (!sicSet.has(sic)) continue; // not in our SIC dataset

    // Find best matching NAICS 2022 code: try exact match first, then 5-digit parent, then 4-digit
    let matchedCode: string | null = null;
    for (const len of [6, 5, 4]) {
      const candidate = naics2002.slice(0, len).padEnd(len, "0");
      // For shorter lookups just try the prefix directly
      const prefix = naics2002.slice(0, len);
      if (naicsMap.has(prefix)) { matchedCode = prefix; break; }
    }
    if (!matchedCode) continue;

    if (!xwalkBySic.has(sic)) xwalkBySic.set(sic, []);
    const existing_entries = xwalkBySic.get(sic)!;
    if (!existing_entries.find((e) => e.naicsCode === matchedCode)) {
      existing_entries.push({ naicsCode: matchedCode, naicsTitle, sicTitle });
    }
  }

  console.log(`${xwalkBySic.size} SIC codes found in crosswalk`);

  let direct = 0;
  let ambiguous = 0;
  let skipped = 0;

  for (const [sic, candidates] of xwalkBySic) {
    if (mappedSet.has(sic)) { skipped++; continue; }

    if (candidates.length === 1) {
      // Clean 1:1 match
      const { naicsCode } = candidates[0];
      const naicsLevel = naicsMap.get(naicsCode)!;
      const [inserted] = await db.insert(mappings).values({
        sicCode: sic,
        naicsCode,
        naicsLevel,
        confidence: 95,
        method: "census_xwalk",
        rationale: `Direct match from Census Bureau NAICS 2002↔SIC crosswalk.`,
      }).onConflictDoNothing().returning();

      if (inserted) {
        await db.insert(mappingRevisions).values({
          mappingId: inserted.id,
          sicCode: inserted.sicCode,
          naicsCode: inserted.naicsCode,
          naicsLevel: inserted.naicsLevel,
          confidence: inserted.confidence,
          method: inserted.method,
          rationale: inserted.rationale,
          changedBy: "system:census_xwalk",
        });
        direct++;
      }
    } else {
      // Multiple candidates — pick the most specific (longest code) as a placeholder
      // Pass 2 (AI disambiguation) will refine this
      const best = candidates.sort((a, b) => b.naicsCode.length - a.naicsCode.length)[0];
      const naicsLevel = naicsMap.get(best.naicsCode)!;
      const candidateList = candidates.map((c) => `${c.naicsCode} (${c.naicsTitle})`).join("; ");

      const [inserted] = await db.insert(mappings).values({
        sicCode: sic,
        naicsCode: best.naicsCode,
        naicsLevel,
        confidence: 60,
        method: "census_xwalk_disambiguated",
        rationale: `${candidates.length} crosswalk candidates: ${candidateList}. Longest code selected as placeholder — needs AI disambiguation.`,
      }).onConflictDoNothing().returning();

      if (inserted) {
        await db.insert(mappingRevisions).values({
          mappingId: inserted.id,
          sicCode: inserted.sicCode,
          naicsCode: inserted.naicsCode,
          naicsLevel: inserted.naicsLevel,
          confidence: inserted.confidence,
          method: inserted.method,
          rationale: inserted.rationale,
          changedBy: "system:census_xwalk",
        });
        ambiguous++;
      }
    }
  }

  await client.end();
  console.log(`\nResults:`);
  console.log(`  Direct 1:1 matches (confidence 95): ${direct}`);
  console.log(`  Ambiguous / needs AI pass (confidence 60): ${ambiguous}`);
  console.log(`  Skipped (already mapped): ${skipped}`);
  console.log(`  SIC codes not in crosswalk: ${sicSet.size - xwalkBySic.size} → will need AI gap-fill`);
}

main().catch((e) => { console.error(e); process.exit(1); });
