import { db } from "@/db";
import { naicsCodes } from "@/db/schema";
import { asc, eq, like, sql } from "drizzle-orm";
import Link from "next/link";

export const revalidate = 3600;

interface Props {
  searchParams: Promise<{ q?: string; sector?: string }>;
}

export default async function NAICSPage({ searchParams }: Props) {
  const params = await searchParams;
  const { q, sector } = params;

  const rows = await db
    .select()
    .from(naicsCodes)
    .where(
      q
        ? like(sql`lower(${naicsCodes.title})`, `%${q.toLowerCase()}%`)
        : sector
        ? like(naicsCodes.code, `${sector}%`)
        : eq(naicsCodes.level, 2) // default: show sectors only
    )
    .orderBy(asc(naicsCodes.code))
    .limit(300);

  const sectors = await db
    .select()
    .from(naicsCodes)
    .where(eq(naicsCodes.level, 2))
    .orderBy(asc(naicsCodes.code));

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Sectors</h2>
        <ul className="space-y-1">
          <li>
            <Link href="/naics" className={`text-sm px-2 py-1 rounded block hover:bg-gray-100 ${!sector && !q ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}>
              All Sectors
            </Link>
          </li>
          {sectors.map((s) => (
            <li key={s.code}>
              <Link
                href={`/naics?sector=${s.code}`}
                className={`text-sm px-2 py-1 rounded block hover:bg-gray-100 truncate ${sector === s.code ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}
                title={s.title}
              >
                <span className="font-mono text-xs text-gray-400 mr-1">{s.code}</span>
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">NAICS 2022 Codes</h1>
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search titles..."
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
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-24">Code</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Title</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-20">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <span
                      className="font-mono font-semibold"
                      style={{ paddingLeft: `${(row.level - 2) * 8}px` }}
                    >
                      <span className="text-blue-700">{row.code}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-900"
                    style={{ paddingLeft: `${4 + (row.level - 2) * 8}px` }}>
                    {row.title}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold border ${
                      row.level === 2 ? "bg-purple-100 text-purple-800 border-purple-200" :
                      row.level === 3 ? "bg-blue-100 text-blue-800 border-blue-200" :
                      row.level === 4 ? "bg-green-100 text-green-800 border-green-200" :
                      row.level === 5 ? "bg-amber-100 text-amber-800 border-amber-200" :
                      "bg-gray-100 text-gray-700 border-gray-200"
                    }`}>
                      {["", "", "sector", "subsector", "group", "industry", "national"][row.level]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-center text-gray-400 py-12">No results found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
