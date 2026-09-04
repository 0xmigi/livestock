import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { WalletProviders } from "@/components/WalletProviders";

export const metadata: Metadata = {
  title: "Season",
  description:
    "Buy the story. When the season ends, redeem the stock or roll into the next one.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-paper antialiased">
        <WalletProviders>
          <Header />
          {children}
        </WalletProviders>
      </body>
    </html>
  );
}
