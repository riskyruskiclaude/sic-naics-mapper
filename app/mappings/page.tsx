import { db } from "@/db";
import { mappings, sicCodes, naicsCodes } from "@/db/schema";
import { asc, desc, eq, like, sql, and, lte, gte } from "drizzle-orm";
import MappingRow from "./MappingRow";
import Link from "next/link";

export const revalidate = 0;

const METHOD_LABELS: Record<string, string> = {
  census_xwalk: "Census Crosswalk",
  census_xwalk_disambiguated: "Crosswalk (AI)",
  ai_generated: "AI Generated",
  user_override: "User Override",
};

interface Props {
  searchParams: Promise<{
    q?: string;
    sic?: string;
    method?: string;
    minConf?: string;
    maxConf?: string;
    sort?: string;
  }>;
}

export default async function MappingsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { q, sic, method, minConf, maxConf, sort } = params;

  const conditions = [];
  if (sic) conditions.push(eq(mappings.sicCode, sic));
  if (q) conditions.push(like(sicCodes.description, `%${q}%`));
  if (method) conditions.push(eq(mappings.method, method as any));
  if (minConf) conditions.push(gte(mappings.confidence, parseInt(minConf)));
  if (maxConf) conditions.push(lte(mappings.confidence, parseInt(maxConf)));

  const orderBy = sort === "conf_asc" ? asc(mappings.confidence)
    : sort === "conf_desc" ? desc(mappings.confidence)
    : sort === "sic" ? asc(mappings.sicCode)
    : asc(mappings.sicCode);

  const rows = await db
    .select({ mapping: mappings, sic: sicCodes, naics: naicsCodes })
    .from(mappings)
    .leftJoin(sicCodes, eq(mappings.sicCode, sicCodes.code))
    .leftJoin(naicsCodes, eq(mappings.naicsCode, naicsCodes.code))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderBy)
    .limit(200);

  // Stats
  const stats = await db
    .select({
      total: sql<number>`count(*)`,
      avgConf: sql<number>`round(avg(${mappings.confidence}))`,
      lowConf: sql<number>`count(*) filter (where ${mappings.confidence} < 50)`,
      overrides: sql<number>`count(*) filter (where ${mappings.method} = 'user_override')`,
    })
    .from(mappings);

  const s = stats[0];

  const allNaics = await db
    .select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level })
    .from(naicsCodes)
    .where(sql`${naicsCodes.level} >= 4`)
    .orderBy(asc(naicsCodes.code));

  return (
    <div>
      {/* Stats bar */}
      {s.total > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Mapped", value: s.total },
            { label: "Avg Confidence", value: `${s.avgConf}%` },
            { label: "Low Confidence (<50%)", value: s.lowConf, highlight: true },
            { label: "User Overrides", value: s.overrides },
          ].map((stat) => (
            <div key={stat.label} className={`bg-white border rounded-lg px-4 py-3 ${stat.highlight && Number(stat.value) > 0 ? "border-amber-300" : "border-gray-200"}`}>
              <div className={`text-2xl font-bold ${stat.highlight && Number(stat.value) > 0 ? "text-amber-600" : "text-gray-900"}`}>
                {stat.value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <form className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search SIC description</label>
          <input name="q" defaultValue={q} placeholder="e.g. farming, software..." className="border border-gray-300 rounded px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">SIC Code</label>
          <input name="sic" defaultValue={sic} placeholder="e.g. 0111" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Method</label>
          <select name="method" defaultValue={method} className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All methods</option>
            {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Confidence</label>
          <div className="flex items-center gap-1">
            <input name="minConf" defaultValue={minConf} placeholder="0" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-gray-400 text-sm">–</span>
            <input name="maxConf" defaultValue={maxConf} placeholder="100" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sort</label>
          <select name="sort" defaultValue={sort} className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="sic">SIC Code</option>
            <option value="conf_asc">Confidence ↑</option>
            <option value="conf_desc">Confidence ↓</option>
          </select>
        </div>
        <button type="submit" className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700">
          Filter
        </button>
        {(q || sic || method || minConf || maxConf) && (
          <Link href="/mappings" className="text-sm text-gray-500 hover:text-gray-700 py-1.5">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="text-center text-gray-400 py-20 bg-white border border-gray-200 rounded-lg">
          {s.total === 0
            ? "No mappings yet. Run a mapping pass first."
            : "No mappings match your filters."}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ mapping, sic: s, naics: n }) => (
            <MappingRow
              key={mapping.id}
              mapping={mapping}
              sicDescription={s?.description ?? mapping.sicCode}
              sicMajorGroup={s?.majorGroupTitle ?? ""}
              sicDivision={s?.divisionTitle ?? ""}
              currentNaicsTitle={n?.title ?? mapping.naicsCode}
              allNaics={allNaics}
            />
          ))}
        </div>
      )}

      {rows.length === 200 && (
        <p className="text-center text-gray-400 mt-4 text-sm">Showing first 200. Use filters to narrow down.</p>
      )}
    </div>
  );
}
