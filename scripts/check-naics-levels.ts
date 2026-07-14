import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { naicsCodes } from "../db/schema";

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client, { schema: { naicsCodes } });

async function main() {
  const fiveDigit = await db.select().from(naicsCodes).where(eq(naicsCodes.level, 5));
  const sixDigit = await db.select().from(naicsCodes).where(eq(naicsCodes.level, 6));

  const sixByParent = new Map<string, typeof sixDigit[0][]>();
  for (const n of sixDigit) {
    if (!n.parentCode) continue;
    if (!sixByParent.has(n.parentCode)) sixByParent.set(n.parentCode, []);
    sixByParent.get(n.parentCode)!.push(n);
  }

  let same = 0, different = 0, multipleChildren = 0;
  const diffs: { five: string; fiveTitle: string; six: string; sixTitle: string }[] = [];

  for (const five of fiveDigit) {
    const children = sixByParent.get(five.code) ?? [];
    if (children.length === 0) continue;
    if (children.length > 1) { multipleChildren++; continue; } // skip — genuinely split
    const six = children[0];
    if (five.title.trim() === six.title.trim()) {
      same++;
    } else {
      different++;
      diffs.push({ five: five.code, fiveTitle: five.title, six: six.code, sixTitle: six.title });
    }
  }

  console.log(`5-digit codes with a single 6-digit child:`);
  console.log(`  Same title:      ${same}`);
  console.log(`  Different title: ${different}`);
  console.log(`  Multiple 6-digit children (genuinely split): ${multipleChildren}`);
  console.log(`\nAll cases where 5-digit and 6-digit titles differ:\n`);
  diffs.forEach((d) => {
    console.log(`  5-digit ${d.five}: ${d.fiveTitle}`);
    console.log(`  6-digit ${d.six}: ${d.sixTitle}\n`);
  });
  await client.end();
}
main().catch(console.error);
