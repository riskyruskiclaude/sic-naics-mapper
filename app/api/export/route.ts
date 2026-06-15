import { db } from "@/db";
import { mappings, sicCodes, naicsCodes } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select({
      sicCode: mappings.sicCode,
      sicDescription: sicCodes.description,
      naicsCode: mappings.naicsCode,
      naicsDescription: naicsCodes.title,
    })
    .from(mappings)
    .leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code))
    .leftJoin(naicsCodes, eq(mappings.naicsCode, naicsCodes.code))
    .orderBy(asc(mappings.sicCode));

  const header = "SIC Code,SIC Description,NAICS Code,NAICS Description\n";
  const csv = rows.map((r) => [
    r.sicCode,
    `"${(r.sicDescription ?? "").replace(/"/g, '""')}"`,
    r.naicsCode,
    `"${(r.naicsDescription ?? "").replace(/"/g, '""')}"`,
  ].join(",")).join("\n");

  return new Response(header + csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="sic-naics-mappings.csv"`,
    },
  });
}
