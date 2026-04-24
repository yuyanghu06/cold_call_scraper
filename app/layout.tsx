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
      <body className="flex min-h-screen">
        <aside className="w-52 shrink-0 flex flex-col border-r border-neutral-200 px-4 py-6 gap-6">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.jpg"
              alt="MicroAGI"
              width={28}
              height={28}
              className="rounded shrink-0"
              priority
            />
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-[0.18em] text-neutral-400 leading-none mb-0.5">
                MicroAGI
              </div>
              <div className="text-[12px] font-medium tracking-tight leading-tight truncate">
                Lead Gen/Tracking
              </div>
            </div>
          </div>

          <NavTabs />

          <div className="mt-auto flex flex-col gap-2">
            <Link
              href="/settings"
              className="text-[12px] tracking-tight text-neutral-500 hover:text-neutral-900"
            >
              Settings
            </Link>
            {session && (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/signin" });
                }}
              >
                <button
                  type="submit"
                  className="text-[12px] tracking-tight text-neutral-500 hover:text-neutral-900"
                >
                  Sign out
                </button>
              </form>
            )}
            {email && (
              <span
                className="text-[11px] tracking-tight text-neutral-400 truncate"
                title={email}
              >
                {email}
              </span>
            )}
          </div>
        </aside>
        <div className="flex-1 min-w-0">{children}</div>
      </body>
    </html>
  );
}
