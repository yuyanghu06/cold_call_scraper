import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MicroAGI Lead Gen",
  description: "Internal lead generation tool for the MicroAGI sales team",
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
