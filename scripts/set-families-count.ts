/**
 * Populates xwalk_families_count on every mapping by counting how many distinct
 * 4-digit NAICS families the 2022 crosswalk offers for that SIC code.
 *
 *   1  → all crosswalk options share the same 4-digit parent (unambiguous at group level)
 *   2+ → candidates span multiple families (genuinely ambiguous, needs review)
 *   null → SIC code not in 2022 crosswalk (gap-fill or user override)
 *
 * Usage: npx tsx scripts/set-families-count.ts [path/to/2022-naics-to-sic.xlsx]
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { mappings, naicsCodes } from "../db/schema";

// @ts-ignore
import * as XLSX from "xlsx";

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { mappings, naicsCodes } });

async function main() {
  const xlsxPath = process.argv[2] ?? "/tmp/2022-naics-to-sic.xlsx";
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws);

  // Build SIC→set of 4-digit NAICS families from 2022 crosswalk
  const familiesBySic = new Map<string, Set<string>>();
  const allNaics = await db.select({ code: naicsCodes.code }).from(naicsCodes);
  const validNaics = new Set(allNaics.map((n) => n.code));

  for (const row of rows) {
    let sic = String(row["Related SIC Code"] ?? "").replace(/\.0$/, "").trim();
    if (sic.length === 3) sic = "0" + sic;
    if (sic.length !== 4) continue;
    const naics = String(row["2022 NAICS Code"] ?? "").replace(/\.0$/, "").trim();
    if (naics.length !== 6 || !validNaics.has(naics)) continue;
    if (!familiesBySic.has(sic)) familiesBySic.set(sic, new Set());
    familiesBySic.get(sic)!.add(naics.slice(0, 4)); // track 4-digit family
  }

  const allMappings = await db.select({ id: mappings.id, sicCode: mappings.sicCode }).from(mappings);

  let updated = 0;
  for (const m of allMappings) {
    const families = familiesBySic.get(m.sicCode);
    const count = families ? families.size : null;
    await db.update(mappings).set({ xwalkFamiliesCount: count }).where(eq(mappings.id, m.id));
    updated++;
  }

  await client.end();

  // Summary
  const counts: Record<string, number> = {};
  for (const [, families] of familiesBySic) {
    const k = String(families.size);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log(`Updated ${updated} mappings.\n`);
  console.log("Distinct 4-digit family counts across crosswalk SIC codes:");
  Object.keys(counts).sort((a, b) => Number(a) - Number(b)).forEach((k) =>
    console.log(`  ${k} famil${k === "1" ? "y" : "ies"}: ${counts[k]} SIC codes`)
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
