import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SIC ↔ NAICS Mapper",
  description: "Browse and map SIC codes to NAICS 2022 equivalents",
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-gray-100 min-h-screen`}>
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <nav className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <Image src="/logo.png" alt="Industry Mapping Logo" width={40} height={40} className="rounded-full" />
              <span className="font-bold text-gray-900 text-lg leading-tight">
                SIC ↔ NAICS
              </span>
            </Link>
            <div className="h-6 w-px bg-gray-200" />
            <Link href="/sic" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
              SIC Codes
            </Link>
            <Link href="/naics" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
              NAICS Codes
            </Link>
            <Link href="/mappings" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
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
