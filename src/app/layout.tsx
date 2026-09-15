import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "FairPrint — Know what you're actually paying",
  description: "A pre-trade fair-value measurement layer for tokenized stocks on Solana.",
  applicationName: "FairPrint",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDEFEE" },
    { media: "(prefers-color-scheme: dark)", color: "#1B2320" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
