import Link from "next/link";
import ManualCompanyForm from "@/components/ManualCompanyForm";

export const metadata = {
  title: "Ingest existing · B2B Lead Gen/Tracking",
};

export default function IngestPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-8 pt-6 sm:pt-8 space-y-5 sm:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            Ingest existing
          </div>
          <h2 className="text-lg sm:text-xl font-medium tracking-tight mt-1">
            Add a company to Attio manually
          </h2>
        </div>
        <Link
          href="/"
          className="text-[11px] uppercase tracking-[0.12em] text-neutral-500 hover:text-neutral-900 shrink-0"
        >
          ← Back to leads
        </Link>
      </div>

      <p className="text-sm text-neutral-600 leading-relaxed">
        For companies you already know about — referrals, walk-ins, anything
        that didn&apos;t come from a Google Places search. Same upsert
        semantics as the main pipeline: submitting an existing Business Name
        fills empty fields but never overwrites your edits.
      </p>

      <ManualCompanyForm />
    </main>
  );
}
