import { db } from "@/db";
import { validationRuns, validationResults, sicCodes, naicsCodes } from "@/db/schema";
import { eq, desc, asc, and } from "drizzle-orm";
import Link from "next/link";

export const revalidate = 0;

interface Props {
  searchParams: Promise<{ run?: string; verdict?: string }>;
}

const VERDICT_COLORS = {
  agree: "bg-green-100 text-green-800 border-green-200",
  family: "bg-amber-100 text-amber-800 border-amber-200",
  disagree: "bg-red-100 text-red-800 border-red-200",
};

const VERDICT_LABELS = {
  agree: "Agree",
  family: "Same family",
  disagree: "Disagree",
};

export default async function ValidationPage({ searchParams }: Props) {
  const params = await searchParams;

  const runs = await db.select().from(validationRuns).orderBy(desc(validationRuns.createdAt));

  const selectedRunId = params.run ? parseInt(params.run) : runs[0]?.id;
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  const conditions = selectedRunId ? [eq(validationResults.runId, selectedRunId)] : [];
  if (params.verdict) conditions.push(eq(validationResults.verdict, params.verdict));

  const results = selectedRunId
    ? await db
        .select({
          result: validationResults,
          sic: sicCodes,
          suggestedNaics: naicsCodes,
        })
        .from(validationResults)
        .leftJoin(sicCodes, eq(validationResults.sicCode, sicCodes.code))
        .leftJoin(naicsCodes, eq(validationResults.suggestedNaicsCode, naicsCodes.code))
        .where(and(...conditions))
        .orderBy(asc(validationResults.sicCode))
        .limit(300)
    : [];

  // Get official NAICS titles separately
  const officialCodes = [...new Set(results.map((r) => r.result.officialNaicsCode))];
  const officialNaicsRows = officialCodes.length
    ? await db.select({ code: naicsCodes.code, title: naicsCodes.title }).from(naicsCodes)
        .then((rows) => rows.filter((r) => officialCodes.includes(r.code)))
    : [];
  const officialTitleMap = new Map(officialNaicsRows.map((n) => [n.code, n.title]));

  if (runs.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Validation</h1>
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
          No validation runs yet. Run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">npm run validate</code> to start.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Validation</h1>
        <code className="text-xs bg-gray-100 border border-gray-200 px-2 py-1 rounded text-gray-600">npm run validate</code>
      </div>

      {/* Run selector */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {runs.map((run) => (
          <Link
            key={run.id}
            href={`/validation?run=${run.id}`}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              run.id === selectedRunId
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-200 hover:border-blue-300"
            }`}
          >
            #{run.id} — {run.label}
          </Link>
        ))}
      </div>

      {selectedRun && (
        <>
          {/* Run summary */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">{selectedRun.label}</h2>
              <span className="text-xs text-gray-400">{selectedRun.model} · {new Date(selectedRun.createdAt).toLocaleString()}</span>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{selectedRun.totalCodes}</div>
                <div className="text-xs text-gray-500 mt-0.5">Total validated</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-700">{selectedRun.agreedCount}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Agree ({selectedRun.totalCodes ? Math.round(selectedRun.agreedCount / selectedRun.totalCodes * 100) : 0}%)
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-700">{selectedRun.familyCount}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Same family ({selectedRun.totalCodes ? Math.round(selectedRun.familyCount / selectedRun.totalCodes * 100) : 0}%)
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{selectedRun.disagreedCount}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Disagree ({selectedRun.totalCodes ? Math.round(selectedRun.disagreedCount / selectedRun.totalCodes * 100) : 0}%)
                </div>
              </div>
            </div>

            {/* Bar */}
            <div className="flex h-3 rounded-full overflow-hidden gap-px">
              <div className="bg-green-500" style={{ width: `${selectedRun.totalCodes ? selectedRun.agreedCount / selectedRun.totalCodes * 100 : 0}%` }} />
              <div className="bg-amber-400" style={{ width: `${selectedRun.totalCodes ? selectedRun.familyCount / selectedRun.totalCodes * 100 : 0}%` }} />
              <div className="bg-red-400" style={{ width: `${selectedRun.totalCodes ? selectedRun.disagreedCount / selectedRun.totalCodes * 100 : 0}%` }} />
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Agree</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Same family</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Disagree</span>
            </div>
          </div>

          {/* Filter by verdict */}
          <div className="flex gap-2 mb-4">
            {(["", "agree", "family", "disagree"] as const).map((v) => (
              <Link
                key={v}
                href={`/validation?run=${selectedRunId}${v ? `&verdict=${v}` : ""}`}
                className={`px-3 py-1.5 rounded border text-sm font-medium transition-colors ${
                  (params.verdict ?? "") === v
                    ? "bg-gray-800 text-white border-gray-800"
                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                }`}
              >
                {v === "" ? "All" : VERDICT_LABELS[v]}
              </Link>
            ))}
          </div>

          {/* Results table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700 w-20">SIC</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Description</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Official NAICS</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Blind Suggestion</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700 w-28">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map(({ result: r, sic, suggestedNaics }) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-bold text-blue-700">{r.sicCode}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 font-medium">{sic?.description ?? r.sicCode}</div>
                      <div className="text-xs text-gray-400">{sic?.majorGroupTitle}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-gray-800 font-semibold">{r.officialNaicsCode}</div>
                      <div className="text-xs text-gray-500">{officialTitleMap.get(r.officialNaicsCode) ?? ""}</div>
                      <div className="text-xs text-gray-400">confidence {r.officialConfidence}%</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-gray-800 font-semibold">{r.suggestedNaicsCode}</div>
                      <div className="text-xs text-gray-500">{suggestedNaics?.title ?? ""}</div>
                      <div className="text-xs text-gray-400">confidence {r.suggestedConfidence}%</div>
                      {r.suggestedRationale && (
                        <div className="text-xs text-gray-400 italic mt-0.5">{r.suggestedRationale}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded border font-semibold ${VERDICT_COLORS[r.verdict as keyof typeof VERDICT_COLORS]}`}>
                        {VERDICT_LABELS[r.verdict as keyof typeof VERDICT_LABELS]}
                      </span>
                      {r.verdict !== "agree" && (
                        <Link
                          href={`/mappings?sic=${r.sicCode}`}
                          className="block text-xs text-blue-600 hover:underline mt-1"
                        >
                          review →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length === 0 && (
              <p className="text-center text-gray-500 py-12">No results for this filter.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
