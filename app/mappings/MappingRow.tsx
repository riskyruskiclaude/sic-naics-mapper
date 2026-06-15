"use client";

import { useState, useEffect } from "react";

type Method = "census_xwalk" | "census_xwalk_disambiguated" | "ai_generated" | "user_override";

const METHOD_LABELS: Record<Method, string> = {
  census_xwalk: "Census Crosswalk",
  census_xwalk_disambiguated: "Crosswalk + AI",
  ai_generated: "AI Generated",
  user_override: "User Override",
};

const METHOD_COLORS: Record<Method, string> = {
  census_xwalk: "bg-green-100 text-green-800 border border-green-200",
  census_xwalk_disambiguated: "bg-teal-100 text-teal-800 border border-teal-200",
  ai_generated: "bg-purple-100 text-purple-800 border border-purple-200",
  user_override: "bg-blue-100 text-blue-800 border border-blue-200",
};

const NAICS_LEVEL_LABELS: Record<number, string> = {
  4: "4-digit group",
  5: "5-digit industry",
  6: "6-digit national",
};

interface NaicsOption {
  code: string;
  title: string;
  level: number;
}

interface Mapping {
  id: number;
  sicCode: string;
  naicsCode: string;
  naicsLevel: number;
  confidence: number;
  method: Method;
  rationale: string | null;
}

interface Revision {
  revision: {
    id: number;
    naicsCode: string;
    naicsLevel: number;
    confidence: number;
    method: Method;
    rationale: string | null;
    changedBy: string;
    createdAt: string;
  };
  naicsTitle: string | null;
}

interface Props {
  mapping: Mapping;
  sicDescription: string;
  sicMajorGroup: string;
  sicDivision: string;
  currentNaicsTitle: string;
  allNaics: NaicsOption[];
  defaultShowHistory?: boolean;
}

export default function MappingRow({
  mapping,
  sicDescription,
  sicMajorGroup,
  sicDivision,
  currentNaicsTitle,
  allNaics,
  defaultShowHistory = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(defaultShowHistory);
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [selectedNaics, setSelectedNaics] = useState(mapping.naicsCode);
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [current, setCurrent] = useState({
    naicsCode: mapping.naicsCode,
    naicsTitle: currentNaicsTitle,
    naicsLevel: mapping.naicsLevel,
    confidence: mapping.confidence,
    method: mapping.method,
    rationale: mapping.rationale,
  });

  useEffect(() => {
    if (defaultShowHistory) loadHistory();
  }, []);

  const confidenceColor =
    current.confidence >= 80 ? "text-green-700 font-bold" :
    current.confidence >= 50 ? "text-amber-700 font-bold" :
    "text-red-600 font-bold";

  async function loadHistory() {
    if (history) return;
    setHistoryLoading(true);
    const res = await fetch(`/api/mappings/${mapping.id}/history`);
    const data = await res.json();
    setHistory(data);
    setHistoryLoading(false);
  }

  async function toggleHistory() {
    if (!showHistory) await loadHistory();
    setShowHistory((v) => !v);
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/mappings/${mapping.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ naicsCode: selectedNaics, rationale }),
    });
    if (res.ok) {
      const naics = allNaics.find((n) => n.code === selectedNaics);
      setCurrent({
        naicsCode: selectedNaics,
        naicsTitle: naics?.title ?? selectedNaics,
        naicsLevel: naics?.level ?? 6,
        confidence: 100,
        method: "user_override",
        rationale,
      });
      setHistory(null); // reset so it reloads next time
      setSaved(true);
      setEditing(false);
      setRationale("");
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  const selectedNaicsInfo = allNaics.find((n) => n.code === selectedNaics);

  return (
    <div className={`bg-white border rounded-lg ${current.method === "user_override" ? "border-blue-200" : "border-gray-200"}`}>
      {/* Main row */}
      <div className="flex items-start gap-4 p-4">
        {/* SIC info */}
        <div className="w-56 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-blue-700 text-sm">{mapping.sicCode}</span>
            {saved && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">saved ✓</span>}
          </div>
          <div className="text-sm text-gray-900 font-medium leading-tight mt-0.5">{sicDescription}</div>
          <div className="text-xs text-gray-400 mt-0.5 truncate">{sicMajorGroup}</div>
        </div>

        {/* Arrow + NAICS */}
        <div className="flex-1 min-w-0">
          {!editing ? (
            <div className="flex items-start gap-2">
              <span className="text-gray-300 mt-0.5">→</span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-semibold text-sm text-gray-800">{current.naicsCode}</span>
                  <span className="text-sm text-gray-700">{current.naicsTitle}</span>
                  <span className="text-xs text-gray-400">({NAICS_LEVEL_LABELS[current.naicsLevel] ?? `${current.naicsLevel}-digit`})</span>
                </div>
                {current.rationale && (
                  <p className="text-xs text-gray-400 mt-1 italic leading-snug">{current.rationale}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={selectedNaics}
                onChange={(e) => setSelectedNaics(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {allNaics.map((n) => (
                  <option key={n.code} value={n.code}>
                    {"  ".repeat(n.level - 4)}{n.code} — {n.title} ({n.level}-digit)
                  </option>
                ))}
              </select>
              {selectedNaicsInfo && (
                <p className="text-xs text-blue-600">
                  Level: {NAICS_LEVEL_LABELS[selectedNaicsInfo.level] ?? `${selectedNaicsInfo.level}-digit`}
                </p>
              )}
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why are you changing this mapping? (optional but recommended)"
                rows={2}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          )}
        </div>

        {/* Badges + actions */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${confidenceColor}`}>{current.confidence}%</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${METHOD_COLORS[current.method]}`}>
              {METHOD_LABELS[current.method]}
            </span>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={toggleHistory}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300"
            >
              History
            </button>
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-gray-600 hover:text-blue-600 px-2 py-1 rounded border border-gray-200 hover:border-blue-300"
              >
                Override
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setEditing(false); setSelectedNaics(current.naicsCode); setRationale(""); }}
                  className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
          <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">Revision History</h4>
          {historyLoading && <p className="text-xs text-gray-500">Loading…</p>}
          {history && history.length === 0 && (
            <p className="text-xs text-gray-500">No revision history yet.</p>
          )}
          {history && history.length > 0 && (
            <div className="space-y-2">
              {history.map(({ revision: r, naicsTitle }) => (
                <div key={r.id} className="flex items-start gap-3 text-xs bg-white border border-gray-200 rounded px-3 py-2">
                  <span className="text-gray-500 w-36 shrink-0 font-medium">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${METHOD_COLORS[r.method]}`}>
                    {METHOD_LABELS[r.method]}
                  </span>
                  <span className="font-mono text-gray-800 font-semibold">{r.naicsCode}</span>
                  <span className="text-gray-700">{naicsTitle ?? ""}</span>
                  <span className={`shrink-0 ${
                    r.confidence >= 80 ? "text-green-700 font-bold" :
                    r.confidence >= 50 ? "text-amber-700 font-bold" : "text-red-600 font-bold"
                  }`}>{r.confidence}%</span>
                  {r.rationale && <span className="text-gray-500 italic">{r.rationale}</span>}
                  <span className="text-gray-400 ml-auto shrink-0">by {r.changedBy}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
