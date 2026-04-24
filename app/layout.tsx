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

// Single shared style for every label on the right side of the header so tabs,
// secondary actions, and the user email all read as one row.
const NAV_ITEM_CLASS =
  "text-[13px] tracking-tight text-neutral-500 hover:text-neutral-900 pb-3";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;

  return (
    <html lang="en">
      <body>
        {user && (
          <header className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6 border-b border-neutral-900">
              <div className="flex items-center gap-3 sm:gap-4 pb-3">
                <Image
                  src="/logo.jpg"
                  alt="MicroAGI"
                  width={36}
                  height={36}
                  className="rounded shrink-0"
                  priority
                />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    MicroAGI · Internal
                  </div>
                  <h1 className="text-base sm:text-lg font-medium tracking-tight leading-tight">
                    B2B Lead Gen/Tracking
                  </h1>
                </div>
              </div>
              <div className="flex items-baseline gap-4 sm:gap-5 overflow-x-auto md:overflow-visible whitespace-nowrap">
                <NavTabs />
                <Link href="/settings" className={NAV_ITEM_CLASS}>
                  Settings
                </Link>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/signin" });
                  }}
                  className="pb-3"
                >
                  <button
                    type="submit"
                    className="text-[13px] tracking-tight text-neutral-500 hover:text-neutral-900"
                  >
                    Sign out
                  </button>
                </form>
                <span
                  className="hidden lg:inline text-[13px] tracking-tight text-neutral-400 truncate max-w-[200px] pb-3"
                  title={user.email ?? ""}
                >
                  {user.email}
                </span>
              </div>
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
