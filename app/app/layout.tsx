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
      <body className="min-h-full">
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
