/**
 * Parse the NAICS Association 2017-2022 SIC→NAICS crosswalk PDF text
 * and compare against our current mappings.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { mappings, sicCodes, naicsCodes } from "../db/schema";

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { mappings, sicCodes, naicsCodes } });

function parsePdfText(text: string): { sic: string; naics: string }[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Collect all 4-digit SIC entries and 6-digit NAICS entries in order
  const sicEntries: string[] = [];
  const naicsEntries: string[] = [];

  for (const line of lines) {
    if (/^\d{4} /.test(line)) sicEntries.push(line.slice(0, 4));
    if (/^\d{6} /.test(line)) naicsEntries.push(line.slice(0, 6));
  }

  // They should be parallel — pair by index
  const pairs: { sic: string; naics: string }[] = [];
  const len = Math.min(sicEntries.length, naicsEntries.length);
  for (let i = 0; i < len; i++) {
    pairs.push({ sic: sicEntries[i], naics: naicsEntries[i] });
  }

  return pairs;
}

// Group by SIC: which NAICS codes does each SIC map to?
function groupBySic(pairs: { sic: string; naics: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const { sic, naics } of pairs) {
    if (!map.has(sic)) map.set(sic, new Set());
    map.get(sic)!.add(naics);
  }
  return map;
}

async function main() {
  const textPath = process.argv[2] ?? "/tmp/sic-naics-xwalk.txt";
  const text = fs.readFileSync(textPath, "utf-8");
  const pairs = parsePdfText(text);

  console.log(`Parsed ${pairs.length} SIC→NAICS pairs from crosswalk`);

  const bySic = groupBySic(pairs);
  console.log(`${bySic.size} unique SIC codes in crosswalk\n`);

  // Load our current mappings and NAICS codes
  const currentMappings = await db.select({ mapping: mappings, sic: sicCodes })
    .from(mappings).leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code));
  const currentMap = new Map(currentMappings.map((r) => [r.mapping.sicCode, r.mapping]));

  const allNaics = await db.select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level }).from(naicsCodes);
  const naicsMap = new Map(allNaics.map((n) => [n.code, n]));

  // Compare
  let agree = 0, disagree = 0, family = 0, newXwalkOnly = 0, notInXwalk = 0;

  const disagreements: {
    sic: string; sicDesc: string;
    ours: string; oursTitle: string;
    xwalkOptions: string[];
  }[] = [];

  for (const [sic, xwalkOptions] of bySic) {
    const current = currentMap.get(sic);
    if (!current) { newXwalkOnly++; continue; }

    if (xwalkOptions.has(current.naicsCode)) {
      agree++;
    } else {
      // Check if any xwalk option is in the same 4-digit family
      const inFamily = [...xwalkOptions].some(
        (n) => n.slice(0, 4) === current.naicsCode.slice(0, 4)
      );
      if (inFamily) {
        family++;
      } else {
        disagree++;
        const sicInfo = currentMappings.find((r) => r.mapping.sicCode === sic);
        disagreements.push({
          sic,
          sicDesc: sicInfo?.sic?.description ?? "",
          ours: current.naicsCode,
          oursTitle: naicsMap.get(current.naicsCode)?.title ?? "",
          xwalkOptions: [...xwalkOptions].map((n) => `${n} ${naicsMap.get(n)?.title ?? "(not in 2022 NAICS)"}`),
        });
      }
    }
  }

  for (const sic of currentMap.keys()) {
    if (!bySic.has(sic)) notInXwalk++;
  }

  console.log(`=== Comparison: Our mappings vs NAICS Assoc 2017-2022 crosswalk ===\n`);
  console.log(`Agree (our mapping is one of the xwalk options): ${agree}`);
  console.log(`Same family (different 6-digit, same 4-digit parent):  ${family}`);
  console.log(`Disagree (different family entirely):                   ${disagree}`);
  console.log(`In new xwalk but not in our data:                       ${newXwalkOnly}`);
  console.log(`In our data but not in new xwalk:                       ${notInXwalk}`);

  console.log(`\n=== ${disagree} Disagreements ===\n`);
  for (const d of disagreements) {
    console.log(`SIC ${d.sic}: ${d.sicDesc}`);
    console.log(`  Ours:   ${d.ours} — ${d.oursTitle}`);
    console.log(`  Xwalk:  ${d.xwalkOptions.join(" | ")}`);
    console.log();
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
