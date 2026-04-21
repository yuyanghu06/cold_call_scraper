import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Lead Gen",
  description: "Internal lead generation tool for the Shift sales team",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
