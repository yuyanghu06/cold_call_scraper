import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import NavTabs from "@/components/NavTabs";
import "./globals.css";

export const metadata: Metadata = {
  title: "B2B Lead Gen/Tracking",
  description: "Internal lead generation tool for the MicroAGI sales team",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const email = session?.user?.email ?? null;

  return (
    <html lang="en">
      <body className="flex flex-col h-screen overflow-hidden">
        {/* Top navbar */}
        <header className="shrink-0 h-12 border-b border-neutral-200 bg-white flex items-center px-6 gap-6 fixed top-0 left-0 right-0 z-20">
          {/* Logo + brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Image src="/logo.jpg" alt="MicroAGI" width={22} height={22} className="rounded shrink-0" priority />
            <span className="text-[12px] font-medium tracking-tight text-neutral-700">MicroAGI</span>
          </div>

          <div className="w-px h-4 bg-neutral-200 shrink-0" />

          {/* Nav tabs */}
          <NavTabs />

          {/* Right side */}
          <div className="ml-auto flex items-center gap-4">
            <Link href="/settings" className="text-[12px] text-neutral-500 hover:text-neutral-900">Settings</Link>
            {session && (
              <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
                <button type="submit" className="text-[12px] text-neutral-500 hover:text-neutral-900">Sign out</button>
              </form>
            )}
            {email && <span className="text-[11px] text-neutral-400 truncate max-w-[180px]" title={email}>{email}</span>}
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto mt-12">{children}</div>
      </body>
    </html>
  );
}
