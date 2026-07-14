/**
 * Compares our current mappings against the NAICS Association 2022 NAICS→SIC crosswalk.
 * The 2022 file maps NAICS→SIC (reverse direction), so we invert it to get SIC→[NAICS options].
 *
 * Usage: npx tsx scripts/compare-xwalk-2022.ts <path-to-2022-naics-to-sic.xlsx>
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { mappings, sicCodes, naicsCodes } from "../db/schema";

// @ts-ignore — no types for xlsx
import * as XLSX from "xlsx";

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { mappings, sicCodes, naicsCodes } });

async function main() {
  const xlsxPath = process.argv[2] ?? "/tmp/2022-naics-to-sic.xlsx";
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws);

  // Build SIC→[NAICS] map from the 2022 crosswalk (inverting NAICS→SIC)
  const xwalkBySic = new Map<string, Set<string>>();
  for (const row of rows) {
    const sicRaw = row["Related SIC Code"];
    const naicsRaw = row["2022 NAICS Code"];
    if (!sicRaw || !naicsRaw) continue;

    // SIC codes in this file are stored as numbers (e.g. 116, 111 for ag codes)
    let sic = String(sicRaw).replace(/\.0$/, "").trim();
    if (sic.length === 3) sic = "0" + sic; // pad agriculture codes
    if (sic.length !== 4) continue;

    const naics = String(naicsRaw).replace(/\.0$/, "").trim();
    if (naics.length < 4) continue;

    if (!xwalkBySic.has(sic)) xwalkBySic.set(sic, new Set());
    xwalkBySic.get(sic)!.add(naics);
  }

  console.log(`2022 crosswalk: ${xwalkBySic.size} unique SIC codes\n`);

  // Load our current mappings
  const currentMappings = await db
    .select({ mapping: mappings, sic: sicCodes, naics: naicsCodes })
    .from(mappings)
    .leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code))
    .leftJoin(naicsCodes, eq(mappings.naicsCode, naicsCodes.code));

  const allNaics = await db.select({ code: naicsCodes.code, title: naicsCodes.title }).from(naicsCodes);
  const naicsMap = new Map(allNaics.map((n) => [n.code, n.title]));

  let agree = 0, family = 0, disagree = 0, notInXwalk = 0;

  const disagreements: {
    sic: string; sicDesc: string;
    ours: string; oursTitle: string; oursConf: number; oursMethod: string;
    xwalkOptions: string[];
  }[] = [];

  const familyCases: typeof disagreements = [];

  for (const { mapping: m, sic: s, naics: n } of currentMappings) {
    const xwalkOptions = xwalkBySic.get(m.sicCode);
    if (!xwalkOptions) { notInXwalk++; continue; }

    if (xwalkOptions.has(m.naicsCode)) {
      agree++;
    } else {
      const inFamily = [...xwalkOptions].some(
        (code) => code.slice(0, 4) === m.naicsCode.slice(0, 4)
      );

      const entry = {
        sic: m.sicCode,
        sicDesc: s?.description ?? "",
        ours: m.naicsCode,
        oursTitle: n?.title ?? "",
        oursConf: m.confidence,
        oursMethod: m.method,
        xwalkOptions: [...xwalkOptions].map(
          (code) => `${code}: ${naicsMap.get(code) ?? "(not in 2022 NAICS)"}`
        ),
      };

      if (inFamily) {
        family++;
        familyCases.push(entry);
      } else {
        disagree++;
        disagreements.push(entry);
      }
    }
  }

  console.log(`=== Our mappings vs NAICS Association 2022 crosswalk ===\n`);
  console.log(`Agree (exact match):        ${agree}`);
  console.log(`Same family (4-digit):      ${family}`);
  console.log(`Disagree (different family): ${disagree}`);
  console.log(`Not in 2022 crosswalk:      ${notInXwalk}`);
  console.log(`Total:                      ${agree + family + disagree + notInXwalk}\n`);

  console.log(`\n=== ${disagree} Disagreements (different 4-digit family) ===\n`);
  for (const d of disagreements.sort((a, b) => b.oursConf - a.oursConf)) {
    console.log(`SIC ${d.sic}: ${d.sicDesc} [${d.oursMethod}, ${d.oursConf}%]`);
    console.log(`  Ours:   ${d.ours} — ${d.oursTitle}`);
    console.log(`  Xwalk:  ${d.xwalkOptions.join(" | ")}`);
    console.log();
  }

  console.log(`\n=== ${family} Same-family cases (4-digit match, different 6-digit) ===\n`);
  for (const d of familyCases.sort((a, b) => b.oursConf - a.oursConf)) {
    console.log(`SIC ${d.sic}: ${d.sicDesc} [${d.oursConf}%]`);
    console.log(`  Ours:   ${d.ours} — ${d.oursTitle}`);
    console.log(`  Xwalk:  ${d.xwalkOptions.join(" | ")}`);
    console.log();
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
