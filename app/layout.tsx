import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SIC ↔ NAICS Mapper",
  description: "Browse and map SIC codes to NAICS 2022 equivalents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-gray-50 min-h-screen`}>
        <header className="bg-white border-b border-gray-200">
          <nav className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
            <Link href="/" className="font-semibold text-gray-900 text-lg">
              SIC ↔ NAICS
            </Link>
            <Link href="/sic" className="text-sm text-gray-600 hover:text-gray-900">
              SIC Codes
            </Link>
            <Link href="/naics" className="text-sm text-gray-600 hover:text-gray-900">
              NAICS Codes
            </Link>
            <Link href="/mappings" className="text-sm text-gray-600 hover:text-gray-900">
              Mappings
            </Link>
          </nav>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
