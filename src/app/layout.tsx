import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flower Quotes",
  description: "Interne aanbiedingsapp voor de internationale bloemenhandel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
