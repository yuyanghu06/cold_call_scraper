import type { Metadata } from "next";
import Image from "next/image";
import { auth, signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "MicroAGI Lead Gen",
  description: "Internal lead generation tool for the MicroAGI sales team",
};

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
          <header className="max-w-7xl mx-auto px-6 pt-8">
            <div className="flex items-center justify-between pb-5 border-b border-neutral-900">
              <div className="flex items-center gap-4">
                <Image
                  src="/logo.jpg"
                  alt="MicroAGI"
                  width={44}
                  height={44}
                  className="rounded"
                  priority
                />
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    MicroAGI · Internal
                  </div>
                  <h1 className="text-2xl font-medium tracking-tight mt-1">
                    Lead generation
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-neutral-500 font-mono">
                  {user.email}
                </span>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/signin" });
                  }}
                >
                  <button
                    type="submit"
                    className="uppercase tracking-[0.12em] text-neutral-500 hover:text-neutral-900"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
