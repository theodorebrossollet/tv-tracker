import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SearchProvider } from "@/components/search-provider";
import { ServiceWorker } from "@/components/service-worker";
import { TabBar } from "@/components/tab-bar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TV Tracker",
  description: "Track the shows you're watching and what's airing next.",
  // Accounts are handed out by invitation and there is no public surface worth
  // finding, so there is nothing for a crawler to do here but index the sign-in
  // page. Not a security control — every route has its own gate, and a crawler
  // that ignores this reaches exactly what an anonymous visitor reaches — just
  // the correct posture for an app nobody can sign up for.
  robots: { index: false, follow: false },
  // iOS ignores the web manifest's icons for the home screen entirely and uses
  // this link instead. Without it the installed icon is a screenshot of the
  // page — verified by its absence from the rendered head, not assumed.
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "TV Tracker",
    // "default" keeps the status bar legible against the app's own background
    // in both colour schemes; "black-translucent" would let content run under
    // the clock.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Matches the manifest's theme_color, so the browser chrome and the
  // installed splash agree.
  themeColor: "#4f46e5",
  // Load-bearing for the tab bar: without it iOS reports every
  // `env(safe-area-inset-*)` as 0, and the bar renders under the home
  // indicator. The cost is that content now runs edge to edge, so anything
  // pinned to a screen edge has to add the inset back itself.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Next emits the standardised `mobile-web-app-capable`. Older iOS
            only understands Apple's original spelling, and the design doc
            flags iOS PWA behaviour as the historically divergent one, so both
            are sent. React hoists this into <head>. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />

        <SearchProvider>
          <ServiceWorker />
          {/* Clearance for the fixed tab bar: its own height plus whatever the
              device reserves below it. Padding on the scrolling document rather
              than a margin on the bar, so the last row of a list can still be
              scrolled clear of it. */}
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-10">
            {children}
          </main>
          <TabBar />
        </SearchProvider>
      </body>
    </html>
  );
}
