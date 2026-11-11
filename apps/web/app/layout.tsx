import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Azeret_Mono, Hanken_Grotesk, Rethink_Sans } from "next/font/google";
import { Navbar } from "@/components/nav/Navbar";
import { getCurrentUser } from "@/lib/auth/session";
import "./globals.css";

const rethink = Rethink_Sans({
  subsets: ["latin"],
  variable: "--font-rethink",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

const azeret = Azeret_Mono({
  subsets: ["latin"],
  variable: "--font-azeret",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SomaCue · 3D demonstration feasibility",
  description:
    "Stage 4 prototype: inspect one lumbar vertebra and one rigged exercise clip on a single lit 3D stage.",
};

const themeScript = `(function(){try{var stored=localStorage.getItem("somacue.theme");var dark=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=stored==="light"||stored==="dark"?stored:dark?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${rethink.variable} ${hanken.variable} ${azeret.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Navbar user={user} />
        {children}
      </body>
    </html>
  );
}
