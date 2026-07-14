import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { mappings, sicCodes } from "../db/schema";

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { mappings, sicCodes } });

async function main() {
  const rows = await db
    .select({ mapping: mappings, sic: sicCodes })
    .from(mappings)
    .leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code))
    .where(and(eq(mappings.method, "census_xwalk_disambiguated"), eq(mappings.confidence, 60)));

  console.log(`${rows.length} codes still at placeholder (confidence 60):\n`);
  rows.forEach((r) => {
    console.log(`${r.mapping.sicCode}: ${r.sic?.description}`);
    console.log(`  → NAICS ${r.mapping.naicsCode}`);
    console.log(`  Rationale: ${r.mapping.rationale}`);
    console.log();
  });
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
