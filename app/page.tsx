import Link from "next/link";

export default function Home() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-gray-900 mb-3">SIC ↔ NAICS Mapper</h1>
      <p className="text-gray-600 mb-8 text-lg">
        Browse Standard Industrial Classification (SIC) and North American Industry Classification System (NAICS 2022) codes, and explore AI-generated mappings between them.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/sic" className="block p-5 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all">
          <div className="text-2xl mb-2">📋</div>
          <h2 className="font-semibold text-gray-900 mb-1">SIC Codes</h2>
          <p className="text-sm text-gray-500">Browse ~1,000 SIC 4-digit industry codes organized by division and major group.</p>
        </Link>
        <Link href="/naics" className="block p-5 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all">
          <div className="text-2xl mb-2">🏭</div>
          <h2 className="font-semibold text-gray-900 mb-1">NAICS Codes</h2>
          <p className="text-sm text-gray-500">Explore the NAICS 2022 hierarchy from 2-digit sectors down to 6-digit national industries.</p>
        </Link>
        <Link href="/mappings" className="block p-5 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all">
          <div className="text-2xl mb-2">🔗</div>
          <h2 className="font-semibold text-gray-900 mb-1">Mappings</h2>
          <p className="text-sm text-gray-500">Review AI-generated SIC→NAICS mappings and submit corrections.</p>
        </Link>
      </div>
    </div>
  );
}
