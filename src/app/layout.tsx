import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { Suspense } from "react";
import { DbStatusBanner } from "@/components/db-status";
import { SearchBox } from "@/components/search-box";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { THEME_BOOT_SCRIPT, ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: { default: "Danube BI", template: "%s · Danube BI" },
  description: "Independent, source-backed real-estate intelligence on Danube Properties and the Dubai market.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [{ color: "#0a1120" }],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans text-[14px]">
        <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to content
        </a>
        <div className="flex min-h-screen">
          <Suspense fallback={<div className="hidden w-64 shrink-0 border-r border-line bg-surface lg:block" />}>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-md md:px-8">
              <Suspense fallback={<div className="size-9 lg:hidden" />}>
                <MobileNav />
              </Suspense>
              <Suspense fallback={<div className="h-9 w-full max-w-lg rounded-md bg-surface-2" />}>
                <SearchBox />
              </Suspense>
              <span className="ml-auto hidden text-[11px] text-muted xl:block">Supplied documents &amp; public sources only</span>
              <ThemeToggle />
            </header>
            <Suspense fallback={null}>
              <DbStatusBanner />
            </Suspense>
            <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 md:px-8 md:py-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
