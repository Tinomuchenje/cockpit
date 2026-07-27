import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cockpit",
  description: "Run Claude Code across several projects from one board",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Applies the stored theme before first paint. Server-rendered HTML
          cannot know the preference, so without this the page renders dark
          and then snaps to light, which is more jarring than having no light
          mode at all. It has to be inline and synchronous to beat the paint.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/*
        suppressHydrationWarning: browser extensions inject attributes onto
        <body> before React hydrates (an "ap-style" attribute was the culprit
        here), which React reports as a mismatch even though the app is fine.
      */}
      <body className="h-full overflow-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
