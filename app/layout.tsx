import type { Metadata } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono, Noto_Color_Emoji } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

const notoColorEmoji = Noto_Color_Emoji({
  subsets: ["emoji"],
  weight: "400",
  variable: "--font-noto-emoji",
});

export const metadata: Metadata = {
  title: "OntoBuild - Ontology Editor",
  description:
    "A local workbench for OWL ontology curation with structured editing and Git-backed version history.",
  keywords: ["ontology", "OWL", "RDF", "semantic web", "knowledge graph", "collaboration"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{for(var S of [localStorage,sessionStorage])for(var i=S.length-1;i>=0;i--){var k=S.key(i);if(k&&k.indexOf("ontokit")===0){var n="ontobuild"+k.slice(7);if(S.getItem(n)===null)S.setItem(n,S.getItem(k));S.removeItem(k)}}}catch(e){}try{var s=JSON.parse(localStorage.getItem("ontobuild-editor-preferences")||"{}");var t=(s.state&&s.state.theme)||"system";if(t==="dark")document.documentElement.classList.add("dark");else if(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark")}catch(e){}})()`}
        </Script>
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${notoColorEmoji.variable} font-sans antialiased`}>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
