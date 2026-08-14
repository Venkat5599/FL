import type { Metadata } from "next";
import { Bricolage_Grotesque, Spline_Sans_Mono, Pixelify_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { DitherArt } from "@/components/DitherArt";

// Display grotesque (headings), pixel accent (wordmark), and the terminal mono
// that carries all data. See DESIGN.md.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});
const mono = Spline_Sans_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const pixel = Pixelify_Sans({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TAPE — the market remembers",
  description: "Forensic accountability for crypto influencers. Backtest their calls, catch their wallets, fade the noise.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} ${pixel.variable} h-full antialiased`}
    >
      {/*
        suppressHydrationWarning is on <body> specifically because browser extensions
        inject attributes onto it before React hydrates — we saw data-__-e-c-m_injected
        added by one. Verified this is not ours: the server sends `<body class="min-h-full">`
        with nothing else, and the attribute appears nowhere in this codebase.

        This is the case React provides the prop for, and it is deliberately narrow: it
        silences mismatches on THIS element only, one level deep. Any genuine hydration
        mismatch inside the app still reports normally, so this hides an environment
        artifact rather than a class of bugs.
      */}
      <body className="min-h-full" suppressHydrationWarning>
        {/* ambient dither behind everything: living paper grain */}
        <div aria-hidden className="app-dither">
          <DitherArt shape="field" gap={5} className="h-full w-full" />
        </div>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
