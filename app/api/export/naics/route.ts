import { db } from "@/db";
import { naicsCodes } from "@/db/schema";
import { asc } from "drizzle-orm";

// Level-2 sector codes that share a title — map duplicates to the canonical (lowest) code
const SECTOR_MERGE: Record<string, string> = {
  "32": "31", // Manufacturing
  "33": "31", // Manufacturing
  "45": "44", // Retail Trade
  "49": "48", // Transportation and Warehousing
};

export async function GET() {
  const rows = await db
    .select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level, parentCode: naicsCodes.parentCode })
    .from(naicsCodes)
    .orderBy(asc(naicsCodes.code));

  // Deduplicate: skip the non-canonical duplicate sector rows
  const skipCodes = new Set(Object.keys(SECTOR_MERGE));

  const csv = rows
    .filter((r) => !skipCodes.has(r.code))
    .map((r) => {
      // Remap parent code if it's a merged duplicate
      const parent = r.parentCode ? (SECTOR_MERGE[r.parentCode] ?? r.parentCode) : "";
      return [
        r.code,
        `"${r.title.replace(/"/g, '""')}"`,
        parent,
      ].join(",");
    });

  const header = "NAICS Code,Code Description,Parent Code\n";

  return new Response(header + csv.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="naics-2022-codes.csv"`,
    },
  });
}
