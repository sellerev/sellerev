import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Sellerev - Designed for thinking",
  description: "Sellerev is an analytics platform for Amazon sellers that helps them understand markets, ask better questions, and make confident decisions using structured marketplace data.",
};

import AppShell from "./components/AppShell";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" data-theme="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full`}
      >
        <div className="h-full flex flex-col">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
