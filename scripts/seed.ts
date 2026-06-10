import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { naicsCodes, sicCodes } from "../db/schema";

const client = postgres((process.env.DATABASE_URL || process.env.POSTGRES_URL)!, { prepare: false });
const db = drizzle(client);

async function parseCSV(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  let headers: string[] = [];
  for await (const line of rl) {
    if (!headers.length) {
      headers = parseCSVLine(line);
      continue;
    }
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i]?.trim() ?? ""));
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function seedNAICS(filePath: string) {
  console.log("Seeding NAICS codes...");
  const rows = await parseCSV(filePath);
  const records = rows
    .filter((r) => r.NAICSCode && r.Title)
    .map((r) => {
      const code = r.NAICSCode.trim();
      const level = code.length;
      const parentCode = level > 2 ? code.slice(0, level - 1) : null;
      // For 6-digit codes whose 5-digit parent may not exist, try shorter
      return {
        code,
        title: r.Title.trim(),
        level,
        parentCode,
      };
    });

  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    await db.insert(naicsCodes).values(records.slice(i, i + BATCH)).onConflictDoNothing();
  }
  console.log(`Inserted ${records.length} NAICS codes`);
}

async function seedSIC(filePath: string) {
  console.log("Seeding SIC codes...");
  const rows = await parseCSV(filePath);
  const records = rows
    .filter((r) => r.SIC_4_Digit_Code && r.SIC_4_Digit_Description)
    .map((r) => ({
      code: r.SIC_4_Digit_Code.trim(),
      description: r.SIC_4_Digit_Description.trim(),
      divisionCode: r.Division_Code.trim(),
      divisionTitle: r.Division_Title.trim(),
      majorGroupCode: r.Major_Group_Code.trim(),
      majorGroupTitle: r.Major_Group_Title.trim(),
      industryGroupCode: r.Industry_Group_Code.trim(),
      industryGroupTitle: r.Industry_Group_Title.trim(),
    }));

  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    await db.insert(sicCodes).values(records.slice(i, i + BATCH)).onConflictDoNothing();
  }
  console.log(`Inserted ${records.length} SIC codes`);
}

async function main() {
  const naicsPath = process.argv[2];
  const sicPath = process.argv[3];
  if (!naicsPath || !sicPath) {
    console.error("Usage: npx tsx scripts/seed.ts <naics.csv> <sic.csv>");
    process.exit(1);
  }
  await seedNAICS(naicsPath);
  await seedSIC(sicPath);
  await client.end();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
