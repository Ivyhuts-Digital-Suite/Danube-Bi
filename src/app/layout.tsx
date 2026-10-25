import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { DbStatusBanner } from "@/components/db-status";
import { SearchBox } from "@/components/search-box";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Danube BI", template: "%s · Danube BI" },
  description: "Independent, source-backed research on Danube Properties and the Dubai market.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <div className="flex min-h-screen">
          <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-line bg-surface md:block" />}>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:px-8">
              <Suspense fallback={<div className="h-9 w-full max-w-md rounded-md bg-surface-2" />}>
                <SearchBox />
              </Suspense>
              <span className="ml-auto hidden text-xs text-muted lg:block">Independent research · public sources and supplied documents only</span>
            </header>
            <Suspense fallback={null}>
              <DbStatusBanner />
            </Suspense>
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
