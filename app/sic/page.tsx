import { db } from "@/db";
import { sicCodes } from "@/db/schema";
import { asc, eq, like, sql } from "drizzle-orm";
import Link from "next/link";

export const revalidate = 3600;

interface Props {
  searchParams: Promise<{ q?: string; division?: string; group?: string }>;
}

export default async function SICPage({ searchParams }: Props) {
  const params = await searchParams;
  const { q, division, group } = params;

  const rows = await db
    .select()
    .from(sicCodes)
    .where(
      q
        ? like(sql`lower(${sicCodes.description})`, `%${q.toLowerCase()}%`)
        : group
        ? eq(sicCodes.majorGroupCode, group)
        : division
        ? eq(sicCodes.divisionCode, division)
        : undefined
    )
    .orderBy(asc(sicCodes.code))
    .limit(200);

  // Get divisions with their major groups for hierarchical sidebar
  const divisions = await db
    .selectDistinct({ code: sicCodes.divisionCode, title: sicCodes.divisionTitle })
    .from(sicCodes)
    .orderBy(asc(sicCodes.divisionCode));

  const majorGroups = await db
    .selectDistinct({
      divisionCode: sicCodes.divisionCode,
      code: sicCodes.majorGroupCode,
      title: sicCodes.majorGroupTitle,
    })
    .from(sicCodes)
    .orderBy(asc(sicCodes.majorGroupCode));

  // Group major groups by division
  const groupsByDivision = new Map<string, { code: string; title: string }[]>();
  for (const mg of majorGroups) {
    if (!groupsByDivision.has(mg.divisionCode)) groupsByDivision.set(mg.divisionCode, []);
    groupsByDivision.get(mg.divisionCode)!.push({ code: mg.code, title: mg.title });
  }

  // Which divisions to expand: current division, or the division of the current group
  const activeDivision = division ?? (group ? majorGroups.find((m) => m.code === group)?.divisionCode : undefined);

  return (
    <div className="flex gap-6">
      <aside className="w-64 shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Divisions</h2>
        <ul className="space-y-0.5">
          <li>
            <Link
              href="/sic"
              className={`text-sm px-2 py-1.5 rounded block hover:bg-gray-200 font-medium ${!division && !group && !q ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
            >
              All Divisions
            </Link>
          </li>
          {divisions.map((d) => {
            const isActive = activeDivision === d.code;
            const groups = groupsByDivision.get(d.code) ?? [];
            return (
              <li key={d.code}>
                <Link
                  href={`/sic?division=${d.code}`}
                  className={`text-sm px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-gray-200 ${division === d.code && !group ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-800 font-medium"}`}
                >
                  <span className="font-mono text-xs text-gray-400 w-4 shrink-0">{d.code}</span>
                  <span className="truncate">{d.title}</span>
                </Link>

                {/* Major groups — shown when this division is active */}
                {isActive && (
                  <ul className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l-2 border-blue-100 pl-2">
                    {groups.map((mg) => (
                      <li key={mg.code}>
                        <Link
                          href={`/sic?group=${mg.code}`}
                          className={`text-xs px-2 py-1 rounded block hover:bg-gray-200 truncate ${group === mg.code ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-600"}`}
                          title={mg.title}
                        >
                          <span className="font-mono text-gray-400 mr-1">{mg.code}</span>
                          {mg.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">SIC Codes</h1>
            {group && rows[0] && (
              <p className="text-sm text-gray-500 mt-0.5">
                Major Group {group} — {rows[0].majorGroupTitle}
              </p>
            )}
            {division && !group && rows[0] && (
              <p className="text-sm text-gray-500 mt-0.5">
                Division {division} — {rows[0].divisionTitle}
              </p>
            )}
          </div>
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search descriptions..."
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 font-medium">
              Search
            </button>
          </form>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 w-20">Code</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Description</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 hidden md:table-cell">Major Group</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-bold text-blue-700">{row.code}</td>
                  <td className="px-4 py-2.5 text-gray-900">{row.description}</td>
                  <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell text-xs">
                    <span className="font-mono mr-1 text-gray-400">{row.majorGroupCode}</span>
                    {row.majorGroupTitle}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/mappings?sic=${row.code}`} className="text-xs text-blue-600 hover:underline font-medium">
                      mapping →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-center text-gray-500 py-12">No results found.</p>
          )}
          {rows.length === 200 && (
            <p className="text-center text-gray-500 py-3 text-xs border-t border-gray-100">
              Showing first 200 results. Use search to narrow down.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
