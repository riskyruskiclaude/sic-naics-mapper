"use client";

import { useState, useRef, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type Outcome = "unchanged" | "deepened" | "refined" | "sector_shift" | "less_specific";

interface Row {
  entity_id: string;
  size: number;
  nb: string; // NAICS before
  indBefore: string;
  na: string; // NAICS after
  indAfter: string;
  outcome: Outcome;
  sizeBandChanged: boolean;
  reviewFlag: boolean;
  reviewReason: string;
}

interface Stats {
  total: number;
  unchanged: number;
  deepened: number;
  refined: number;
  sectorShift: number;
  lessSpecific: number;
  sizeBandSame: number;
  sizeBandChanged: number;
  reviewFlagged: number;
  lenBefore: Record<number, number>;
  lenAfter: Record<number, number>;
  topSectorMoves: [string, number][];
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const lines = text.split("\n").filter(l => l.trim());
  // Detect delimiter: if first data row has tabs, use tab; otherwise comma
  const firstData = lines[1] ?? lines[0] ?? "";
  const delim = firstData.includes("\t") ? "\t" : ",";

  const rows: string[][] = [];
  for (const line of lines) {
    const fields: string[] = [];
    let inQuote = false, cur = "";
    for (const c of line) {
      if (c === '"') inQuote = !inQuote;
      else if (c === delim && !inQuote) { fields.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    fields.push(cur.trim().replace(/\r$/, ""));
    rows.push(fields);
  }
  return rows;
}

const SECTOR_NAMES: Record<string, string> = {
  "11": "Agriculture", "21": "Mining", "22": "Utilities", "23": "Construction",
  "31": "Manufacturing", "32": "Manufacturing", "33": "Manufacturing",
  "42": "Wholesale Trade", "44": "Retail Trade", "45": "Retail Trade",
  "48": "Transportation", "49": "Transportation", "51": "Information",
  "52": "Finance", "53": "Real Estate", "54": "Prof/Scientific/Tech",
  "55": "Management", "56": "Admin & Support", "61": "Education",
  "62": "Health Care", "71": "Arts & Recreation", "72": "Accommodation/Food",
  "81": "Other Services", "92": "Government",
};

function getSizeBand(desc: string): string {
  return desc.match(/^[\d\+\-\s]+/)?.[0]?.trim() ?? "";
}

function analyze(rows: string[][], equivalents: Record<string, string> = {}): Row[] {
  return rows.map((f) => {
    const nb = f[2]?.trim() ?? "";
    // Normalize "after" code: if it's a 6-digit whose 5-digit parent is identical, collapse to 5-digit
    const naRaw = f[4]?.trim() ?? "";
    const na = equivalents[naRaw] ?? naRaw;
    const indBefore = f[3]?.trim() ?? "";
    const indAfter = f[5]?.trim() ?? "";

    let outcome: Outcome;
    if (nb === na) outcome = "unchanged";
    else if (na.startsWith(nb)) outcome = "deepened";
    else if (nb.slice(0, 2) === na.slice(0, 2)) outcome = "refined";
    else if (na.length < nb.length) outcome = "less_specific";
    else outcome = "sector_shift";

    const sizeBandChanged = getSizeBand(indBefore) !== getSizeBand(indAfter);

    const reasons: string[] = [];
    if (outcome === "sector_shift") reasons.push(`moved from sector ${nb.slice(0,2)} (${SECTOR_NAMES[nb.slice(0,2)] ?? ""}) to ${na.slice(0,2)} (${SECTOR_NAMES[na.slice(0,2)] ?? ""})`);
    if (outcome === "less_specific") reasons.push("code became less specific");
    if (sizeBandChanged) reasons.push("size band changed");

    // Flag specific suspicious sector moves
    const move = `${nb.slice(0,2)}→${na.slice(0,2)}`;
    const suspiciousMoves = new Set(["62→33","62→32","62→31","54→56","71→51","81→33"]);
    if (suspiciousMoves.has(move)) reasons.push(`unusual sector move (${move})`);

    const reviewFlag = outcome === "sector_shift" || outcome === "less_specific";

    return {
      entity_id: f[0], size: Number(f[1]),
      nb, indBefore, na, indAfter,
      outcome, sizeBandChanged,
      reviewFlag, reviewReason: reasons.join("; "),
    };
  });
}

function computeStats(rows: Row[]): Stats {
  const total = rows.length;
  let unchanged = 0, deepened = 0, refined = 0, sectorShift = 0, lessSpecific = 0;
  let sizeBandSame = 0, sizeBandChanged = 0, reviewFlagged = 0;
  const lenBefore: Record<number, number> = {};
  const lenAfter: Record<number, number> = {};
  const sectorMoves: Record<string, number> = {};

  for (const r of rows) {
    if (r.outcome === "unchanged") unchanged++;
    else if (r.outcome === "deepened") deepened++;
    else if (r.outcome === "refined") refined++;
    else if (r.outcome === "sector_shift") sectorShift++;
    else if (r.outcome === "less_specific") lessSpecific++;
    r.sizeBandChanged ? sizeBandChanged++ : sizeBandSame++;
    if (r.reviewFlag) reviewFlagged++;
    lenBefore[r.nb.length] = (lenBefore[r.nb.length] ?? 0) + 1;
    lenAfter[r.na.length] = (lenAfter[r.na.length] ?? 0) + 1;
    if (r.outcome === "sector_shift") {
      const k = `${r.nb.slice(0,2)} → ${r.na.slice(0,2)}`;
      sectorMoves[k] = (sectorMoves[k] ?? 0) + 1;
    }
  }

  const topSectorMoves = Object.entries(sectorMoves).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { total, unchanged, deepened, refined, sectorShift, lessSpecific, sizeBandSame, sizeBandChanged, reviewFlagged, lenBefore, lenAfter, topSectorMoves };
}

// ── CSV export ──────────────────────────────────────────────────────────────

function downloadAnnotated(rows: Row[], filename: string) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = "Entity_ID,EntitySize,NAICS_before,Industry_before,NAICS_after,Industry_After,outcome,size_band_changed,review_flag,review_reason\n";
  const body = rows.map(r => [
    r.entity_id, r.size,
    r.nb, q(r.indBefore),
    r.na, q(r.indAfter),
    r.outcome,
    r.sizeBandChanged ? "yes" : "no",
    r.reviewFlag ? "yes" : "no",
    q(r.reviewReason),
  ].join(",")).join("\n");

  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename.replace(/\.csv$/i, "") + "_annotated.csv";
  a.click(); URL.revokeObjectURL(url);
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function pct(n: number, d: number) { return d ? Math.round(n / d * 100) : 0; }

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{pct(value, total)}%</span>
    </div>
  );
}

const OUTCOME_META: Record<Outcome, { label: string; color: string; bar: string; desc: string }> = {
  deepened:      { label: "Deepened",      color: "text-green-700",  bar: "bg-green-500",  desc: "Got a more specific code within the same hierarchy — primary goal achieved" },
  unchanged:     { label: "Unchanged",     color: "text-gray-600",   bar: "bg-gray-400",   desc: "Same industry — 5-digit and equivalent 6-digit codes with the same title are treated as identical" },
  refined:       { label: "Refined",       color: "text-blue-700",   bar: "bg-blue-400",   desc: "Different code within the same 2-digit sector — minor reclassification" },
  sector_shift:  { label: "Sector shift",  color: "text-orange-700", bar: "bg-orange-400", desc: "Moved to a different 2-digit sector — review recommended" },
  less_specific: { label: "Less specific", color: "text-red-700",    bar: "bg-red-500",    desc: "Code became shorter/broader — regression, review required" },
};

// ── Main component ──────────────────────────────────────────────────────────

export default function AnalysisDashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filename, setFilename] = useState("IndustryBeforeAfter.csv");
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-load bundled dataset + NAICS equivalents on mount
  useEffect(() => {
    Promise.all([
      fetch("/analysis-data.csv").then(r => r.text()),
      fetch("/naics-equivalents.json").then(r => r.json()),
    ]).then(([text, equivalents]) => {
      const [, ...data] = parseCSV(text);
      const analyzed = analyze(data, equivalents);
      setRows(analyzed);
      setStats(computeStats(analyzed));
    }).finally(() => setLoading(false));
  }, []);

  function processText(text: string, name: string) {
    try {
      const [, ...data] = parseCSV(text);
      if (data.length === 0) { setError("No data rows found."); return; }
      fetch("/naics-equivalents.json").then(r => r.json()).then(equivalents => {
        const analyzed = analyze(data, equivalents);
        setRows(analyzed);
        setStats(computeStats(analyzed));
        setFilename(name);
        setShowUpload(false);
        setError("");
      });
    } catch {
      setError("Failed to parse CSV. Make sure it matches the expected format.");
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) { setError("Please upload a CSV file."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => processText(ev.target?.result as string, file.name);
    reader.readAsText(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => processText(ev.target?.result as string, file.name);
    reader.readAsText(file);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Loading analysis…</div>;
  }

  if (!rows || !stats) {
    return <div className="flex items-center justify-center py-32 text-gray-400 text-sm">No data.</div>;
  }

  const outcomes: Outcome[] = ["deepened", "unchanged", "refined", "sector_shift", "less_specific"];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Industry Reclassification Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filename} · {stats.total.toLocaleString()} entities</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowUpload(v => !v); setError(""); }}
            className="text-sm border border-gray-300 text-gray-600 px-4 py-1.5 rounded hover:bg-gray-50"
          >
            {showUpload ? "Cancel" : "Load new file"}
          </button>
          <button
            onClick={() => rows && downloadAnnotated(rows, filename)}
            className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 font-medium"
          >
            Download annotated CSV
          </button>
        </div>
      </div>

      {/* Inline upload panel */}
      {showUpload && (
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer mb-6 transition-colors ${dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50"}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="text-gray-700 font-medium">Drop a new CSV here or click to browse</p>
          <p className="text-gray-400 text-sm mt-1">Must have columns: Entity_ID, EntitySize, NAICS_before, Industry_before, NAICS_after, Industry_After</p>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
          <div className="text-3xl font-bold text-gray-900">{stats.total.toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-0.5">Total entities</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-4">
          <div className="text-3xl font-bold text-green-700">{pct(stats.deepened, stats.total)}%</div>
          <div className="text-sm text-green-600 mt-0.5">Successfully deepened</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-5 py-4">
          <div className="text-3xl font-bold text-orange-700">{stats.reviewFlagged.toLocaleString()}</div>
          <div className="text-sm text-orange-600 mt-0.5">Flagged for review</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
          <div className="text-3xl font-bold text-gray-900">{pct(stats.sizeBandSame, stats.total)}%</div>
          <div className="text-sm text-gray-500 mt-0.5">Size band preserved</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Outcome breakdown */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Outcome Breakdown</h2>
          <div className="space-y-4">
            {outcomes.map((o) => {
              const count = stats[o === "deepened" ? "deepened" : o === "unchanged" ? "unchanged" : o === "refined" ? "refined" : o === "sector_shift" ? "sectorShift" : "lessSpecific"] as number;
              const m = OUTCOME_META[o];
              return (
                <div key={o}>
                  <div className="flex justify-between items-baseline">
                    <span className={`text-sm font-semibold ${m.color}`}>{m.label}</span>
                    <span className="text-sm text-gray-700 font-medium">{count.toLocaleString()}</span>
                  </div>
                  <Bar value={count} total={stats.total} color={m.bar} />
                  <p className="text-xs text-gray-400 mt-1">{m.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Code specificity */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Code Specificity Shift</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase">
                <th className="text-left pb-2">Digits</th>
                <th className="text-right pb-2">Before</th>
                <th className="text-right pb-2">After</th>
                <th className="text-right pb-2">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[2,3,4,5,6].map(d => {
                const b = stats.lenBefore[d] ?? 0;
                const a = stats.lenAfter[d] ?? 0;
                const diff = a - b;
                return (
                  <tr key={d} className="hover:bg-gray-50">
                    <td className="py-2 text-gray-700 font-medium">{d}-digit</td>
                    <td className="py-2 text-right text-gray-600">{b.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-600">{a.toLocaleString()}</td>
                    <td className={`py-2 text-right font-semibold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "text-gray-400"}`}>
                      {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-6 mb-3">Size Band Preservation</h2>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-sm"><span className="text-gray-700">Same size band</span><span className="font-medium">{stats.sizeBandSame.toLocaleString()}</span></div>
              <Bar value={stats.sizeBandSame} total={stats.total} color="bg-blue-400" />
            </div>
            <div>
              <div className="flex justify-between text-sm"><span className="text-gray-700">Changed size band</span><span className="font-medium">{stats.sizeBandChanged.toLocaleString()}</span></div>
              <Bar value={stats.sizeBandChanged} total={stats.total} color="bg-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Sector shifts */}
      {stats.topSectorMoves.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Top Sector-to-Sector Shifts ({stats.sectorShift.toLocaleString()} entities moved to a different 2-digit sector)
          </h2>
          <div className="grid grid-cols-2 gap-x-8">
            {stats.topSectorMoves.map(([move, count]) => {
              const [from, to] = move.split(" → ");
              const suspicious = ["62→33","62→32","62→31","54→56","81→33"].includes(move.replace(" → ","→"));
              return (
                <div key={move} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{from}</span>
                    <span className="text-gray-400 mx-1.5 text-xs">→</span>
                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{to}</span>
                    <span className="text-xs text-gray-400 ml-2 truncate">{SECTOR_NAMES[from] ?? from} → {SECTOR_NAMES[to] ?? to}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-semibold text-gray-700">{count}</span>
                    {suspicious && <span className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-1.5 py-0.5 rounded font-medium">review</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations summary */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-amber-800 mb-3">Recommended Review Queue</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="font-bold text-red-700 text-xl">{stats.lessSpecific}</div>
            <div className="text-red-600">Got less specific</div>
            <div className="text-gray-500 text-xs mt-0.5">Code became shorter — clear regression</div>
          </div>
          <div>
            <div className="font-bold text-orange-700 text-xl">{stats.sectorShift}</div>
            <div className="text-orange-600">Sector shifts</div>
            <div className="text-gray-500 text-xs mt-0.5">Moved to different 2-digit sector</div>
          </div>
          <div>
            <div className="font-bold text-amber-700 text-xl">{stats.sizeBandChanged}</div>
            <div className="text-amber-600">Size band changed</div>
            <div className="text-gray-500 text-xs mt-0.5">Lower priority but worth noting</div>
          </div>
        </div>
        <p className="text-xs text-amber-700 mt-4">
          The annotated CSV flags all sector-shifted and less-specific entities with <code className="bg-amber-100 px-1 rounded">review_flag=yes</code> and a <code className="bg-amber-100 px-1 rounded">review_reason</code> column explaining why.
        </p>
      </div>
    </div>
  );
}
