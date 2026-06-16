import { db } from "@/db";
import { mappings, sicCodes, naicsCodes } from "@/db/schema";
import { asc, desc, eq, like, sql, and, lte, gte, gt } from "drizzle-orm";
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
    multifamily?: string;
  }>;
}

export default async function MappingsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { q, sic, method, minConf, maxConf, sort, multifamily } = params;

  const conditions = [];
  if (sic) conditions.push(eq(mappings.sicCode, sic));
  if (q) conditions.push(like(sicCodes.description, `%${q}%`));
  if (method) conditions.push(eq(mappings.method, method as any));
  if (minConf) conditions.push(gte(mappings.confidence, parseInt(minConf)));
  if (maxConf) conditions.push(lte(mappings.confidence, parseInt(maxConf)));
  if (multifamily === "1") conditions.push(gt(mappings.xwalkFamiliesCount, 1));

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

  // Overall stats
  const [s] = await db.select({
    total:     sql<number>`count(*)`,
    unmapped:  sql<number>`(select count(*) from sic_codes) - count(*)`,
    high:      sql<number>`count(*) filter (where ${mappings.confidence} >= 80)`,
    mid:       sql<number>`count(*) filter (where ${mappings.confidence} >= 50 and ${mappings.confidence} < 80)`,
    low:       sql<number>`count(*) filter (where ${mappings.confidence} < 50)`,
    xwalk:     sql<number>`count(*) filter (where ${mappings.method} = 'census_xwalk')`,
    xwalkAi:   sql<number>`count(*) filter (where ${mappings.method} = 'census_xwalk_disambiguated')`,
    aiGen:     sql<number>`count(*) filter (where ${mappings.method} = 'ai_generated')`,
    overrides:     sql<number>`count(*) filter (where ${mappings.method} = 'user_override')`,
    multifamily:   sql<number>`count(*) filter (where ${mappings.xwalkFamiliesCount} > 1)`,
    singlefamily:  sql<number>`count(*) filter (where ${mappings.xwalkFamiliesCount} = 1)`,
  }).from(mappings);

  const allNaics = await db
    .select({ code: naicsCodes.code, title: naicsCodes.title, level: naicsCodes.level })
    .from(naicsCodes)
    .where(sql`${naicsCodes.level} >= 4`)
    .orderBy(asc(naicsCodes.code));

  const total = Number(s.total);

  return (
    <div>
      {/* Stats dashboard */}
      {total > 0 && (
        <div className="mb-6 space-y-3">
          {/* Top row — coverage */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
              <div className="text-3xl font-bold text-gray-900">{total}</div>
              <div className="text-sm text-gray-500 mt-0.5">SIC codes mapped</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
              <div className="text-3xl font-bold text-amber-600">{s.unmapped}</div>
              <div className="text-sm text-gray-500 mt-0.5">Not yet mapped</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
              <div className="text-3xl font-bold text-gray-900">{s.overrides}</div>
              <div className="text-sm text-gray-500 mt-0.5">User overrides</div>
            </div>
            <Link href="/mappings?multifamily=1" className="bg-orange-50 border border-orange-200 rounded-lg px-5 py-4 hover:bg-orange-100 transition-colors">
              <div className="text-3xl font-bold text-orange-700">{s.multifamily}</div>
              <div className="text-sm text-orange-600 mt-0.5">Multi-family — needs review</div>
            </Link>
          </div>

          {/* Confidence breakdown */}
          <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Confidence Breakdown</h3>
            <div className="grid grid-cols-3 gap-4 mb-3">
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-green-700">{s.high}</span>
                  <span className="text-sm text-green-600">({total ? Math.round(Number(s.high) / total * 100) : 0}%)</span>
                </div>
                <div className="text-sm text-gray-600 mt-0.5">High confidence <span className="text-gray-400">(80–100%)</span></div>
              </div>
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-amber-700">{s.mid}</span>
                  <span className="text-sm text-amber-600">({total ? Math.round(Number(s.mid) / total * 100) : 0}%)</span>
                </div>
                <div className="text-sm text-gray-600 mt-0.5">Medium confidence <span className="text-gray-400">(50–79%)</span></div>
              </div>
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-red-600">{s.low}</span>
                  <span className="text-sm text-red-500">({total ? Math.round(Number(s.low) / total * 100) : 0}%)</span>
                </div>
                <div className="text-sm text-gray-600 mt-0.5">Low confidence <span className="text-gray-400">(&lt;50%)</span></div>
              </div>
            </div>
            {/* Visual bar */}
            <div className="flex h-3 rounded-full overflow-hidden gap-px">
              <div className="bg-green-500 transition-all" style={{ width: `${total ? Number(s.high) / total * 100 : 0}%` }} title={`High: ${s.high}`} />
              <div className="bg-amber-400 transition-all" style={{ width: `${total ? Number(s.mid) / total * 100 : 0}%` }} title={`Mid: ${s.mid}`} />
              <div className="bg-red-400 transition-all" style={{ width: `${total ? Number(s.low) / total * 100 : 0}%` }} title={`Low: ${s.low}`} />
            </div>
          </div>

          {/* Method breakdown */}
          <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Mapping Method</h3>
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Census Crosswalk", value: s.xwalk, color: "text-green-700", bg: "bg-green-100 border-green-200" },
                { label: "Crosswalk + AI", value: s.xwalkAi, color: "text-teal-700", bg: "bg-teal-100 border-teal-200" },
                { label: "AI Generated", value: s.aiGen, color: "text-purple-700", bg: "bg-purple-100 border-purple-200" },
                { label: "User Override", value: s.overrides, color: "text-blue-700", bg: "bg-blue-100 border-blue-200" },
              ].map((m) => (
                <div key={m.label} className={`border rounded-lg px-3 py-2.5 ${m.bg}`}>
                  <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                  <div className={`text-xs font-medium mt-0.5 ${m.color}`}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Export */}
      <div className="flex justify-end mb-3">
        <a
          href="/api/export"
          download="sic-naics-mappings.csv"
          className="text-sm bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded hover:bg-gray-50 hover:border-gray-400 font-medium"
        >
          Export CSV
        </a>
      </div>

      {/* Filters */}
      <form className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">Search SIC description</label>
          <input name="q" defaultValue={q} placeholder="e.g. farming, software..." className="border border-gray-300 rounded px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">SIC Code</label>
          <input name="sic" defaultValue={sic} placeholder="e.g. 0111" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">Method</label>
          <select name="method" defaultValue={method} className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All methods</option>
            {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">Confidence range</label>
          <div className="flex items-center gap-1">
            <input name="minConf" defaultValue={minConf} placeholder="0" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-gray-500 text-sm">–</span>
            <input name="maxConf" defaultValue={maxConf} placeholder="100" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">Sort</label>
          <select name="sort" defaultValue={sort} className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="sic">SIC Code</option>
            <option value="conf_asc">Confidence ↑</option>
            <option value="conf_desc">Confidence ↓</option>
          </select>
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <input
            type="checkbox"
            name="multifamily"
            id="multifamily"
            value="1"
            defaultChecked={multifamily === "1"}
            className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
          />
          <label htmlFor="multifamily" className="text-sm text-orange-700 font-medium cursor-pointer">
            Multi-family only
          </label>
        </div>
        <button type="submit" className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 font-medium">
          Filter
        </button>
        {(q || sic || method || minConf || maxConf || multifamily) && (
          <Link href="/mappings" className="text-sm text-gray-600 hover:text-gray-800 py-1.5">
            Clear filters
          </Link>
        )}
      </form>

      {(q || sic || method || minConf || maxConf || multifamily) && rows.length > 0 && (
        <p className="text-sm text-gray-500 mb-2">
          {rows.length}{rows.length === 200 ? "+" : ""} result{rows.length !== 1 ? "s" : ""}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="text-center text-gray-500 py-20 bg-white border border-gray-200 rounded-lg">
          {total === 0
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
        <p className="text-center text-gray-500 mt-4 text-sm">Showing first 200. Use filters to narrow down.</p>
      )}
    </div>
  );
}
