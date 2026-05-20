import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

const inter = Inter({ subsets: ["latin"] });
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "CookieJar",
  description: "Family finance dashboard",
  icons: {
    icon: [
      { url: "/brand/favicon-light.svg", media: "(prefers-color-scheme: light)", type: "image/svg+xml" },
      { url: "/brand/favicon-dark.svg",  media: "(prefers-color-scheme: dark)",  type: "image/svg+xml" },
    ],
    apple: [
      { url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${manrope.variable} bg-cj-bg text-cj-text`}>
        <ThemeProvider>
          <AuthSessionProvider>
            <AppShell>{children}</AppShell>
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
