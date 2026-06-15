/**
 * Pass 1: Import mappings from the NAICS Association 2022 NAICS→SIC crosswalk.
 *
 * The crosswalk maps NAICS→SIC; we invert it to SIC→[NAICS options].
 *   - Single NAICS option  → confidence 95, method census_xwalk
 *   - Multiple options     → confidence 60, method census_xwalk_disambiguated (placeholder for Pass 2)
 *
 * SIC codes not in the crosswalk are left unmapped (handled by Pass 3 gap-fill).
 *
 * Usage: npx tsx scripts/import-2022-xwalk.ts [path/to/2022-naics-to-sic.xlsx]
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { mappings, sicCodes, naicsCodes } from "../db/schema";

// @ts-ignore
import * as XLSX from "xlsx";

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { mappings, sicCodes, naicsCodes } });

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
  console.log(`2022 crosswalk: ${xwalkBySic.size} unique SIC codes\n`);

  // Load valid 2022 NAICS codes
  const allNaics = await db.select().from(naicsCodes);
  const naicsMap = new Map(allNaics.map((n) => [n.code, n]));

  // Load all SIC codes
  const allSic = await db.select().from(sicCodes);
  const sicSet = new Set(allSic.map((s) => s.code));

  let direct = 0, placeholder = 0, skipped = 0;

  for (const [sic, options] of xwalkBySic) {
    if (!sicSet.has(sic)) { skipped++; continue; }

    // Filter to valid 2022 NAICS codes only
    const validOptions = [...options].filter((c) => naicsMap.has(c));
    if (validOptions.length === 0) { skipped++; continue; }

    if (validOptions.length === 1) {
      const code = validOptions[0];
      const naics = naicsMap.get(code)!;
      await db.insert(mappings).values({
        sicCode: sic,
        naicsCode: code,
        naicsLevel: naics.level,
        confidence: 95,
        method: "census_xwalk",
        rationale: "Direct 1-to-1 match from NAICS Association 2022 crosswalk.",
      }).onConflictDoNothing();
      direct++;
    } else {
      // Pick the first alphabetically as placeholder; Pass 2 will replace it
      const code = validOptions.sort()[0];
      const naics = naicsMap.get(code)!;
      const candidates = validOptions.map((c) => `${c} (${naicsMap.get(c)?.title})`).join("; ");
      await db.insert(mappings).values({
        sicCode: sic,
        naicsCode: code,
        naicsLevel: naics.level,
        confidence: 60,
        method: "census_xwalk_disambiguated",
        rationale: `Multiple 2022 crosswalk candidates — needs disambiguation: ${candidates}`,
      }).onConflictDoNothing();
      placeholder++;
    }
  }

  await client.end();
  console.log(`Done.`);
  console.log(`  Direct (1 option):          ${direct}`);
  console.log(`  Placeholders (2+ options):  ${placeholder}`);
  console.log(`  Skipped (SIC not found):    ${skipped}`);
  console.log(`  Total inserted:             ${direct + placeholder}`);
  console.log(`  SIC codes not in xwalk:     ${allSic.length - (direct + placeholder)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
