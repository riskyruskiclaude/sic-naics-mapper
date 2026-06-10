import { db } from "@/db";
import { sicCodes } from "@/db/schema";
import { asc, like, sql } from "drizzle-orm";
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
        : division
        ? like(sicCodes.divisionCode, division)
        : group
        ? like(sicCodes.majorGroupCode, group)
        : undefined
    )
    .orderBy(asc(sicCodes.code))
    .limit(200);

  // Get division list for sidebar
  const divisions = await db
    .selectDistinct({ code: sicCodes.divisionCode, title: sicCodes.divisionTitle })
    .from(sicCodes)
    .orderBy(asc(sicCodes.divisionCode));

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Divisions</h2>
        <ul className="space-y-1">
          <li>
            <Link href="/sic" className={`text-sm px-2 py-1 rounded block hover:bg-gray-100 ${!division ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}>
              All Divisions
            </Link>
          </li>
          {divisions.map((d) => (
            <li key={d.code}>
              <Link
                href={`/sic?division=${d.code}`}
                className={`text-sm px-2 py-1 rounded block hover:bg-gray-100 truncate ${division === d.code ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}
                title={d.title ?? ""}
              >
                <span className="font-mono text-xs text-gray-400 mr-1">{d.code}</span>
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">SIC Codes</h1>
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search descriptions..."
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
              Search
            </button>
          </form>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-20">Code</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Description</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">Major Group</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">{row.code}</td>
                  <td className="px-4 py-2.5 text-gray-900">{row.description}</td>
                  <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell text-xs">{row.majorGroupTitle}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/mappings?sic=${row.code}`} className="text-xs text-blue-600 hover:underline">
                      mapping →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-center text-gray-400 py-12">No results found.</p>
          )}
          {rows.length === 200 && (
            <p className="text-center text-gray-400 py-3 text-xs border-t border-gray-100">
              Showing first 200 results. Use search to narrow down.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
