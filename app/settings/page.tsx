import Link from "next/link";
import AttioSettings from "@/components/AttioSettings";

export const metadata = {
  title: "Settings · B2B Lead Gen/Tracking",
};

export default function SettingsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-8 pt-6 sm:pt-8 space-y-5 sm:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            Settings
          </div>
          <h2 className="text-lg sm:text-xl font-medium tracking-tight mt-1">
            Integrations &amp; preferences
          </h2>
        </div>
        <Link
          href="/"
          className="text-[11px] uppercase tracking-[0.12em] text-neutral-500 hover:text-neutral-900 shrink-0"
        >
          ← Back to leads
        </Link>
      </div>

      <AttioSettings />
    </main>
  );
}
