import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Nav } from "@/components/nav";
import { SearchProvider } from "@/components/search-provider";
import { ServiceWorker } from "@/components/service-worker";
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
          <Nav />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
            {children}
          </main>
        </SearchProvider>
      </body>
    </html>
  );
}
