import Image from "next/image";
import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 border border-neutral-300 p-8">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.jpg"
            alt="MicroAGI"
            width={40}
            height={40}
            className="rounded"
            priority
          />
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              MicroAGI · Internal
            </div>
            <div className="text-lg font-medium tracking-tight">
              Lead generation
            </div>
          </div>
        </div>
        <p className="text-sm text-neutral-600 leading-relaxed">
          Sign in with your{" "}
          <span className="font-mono text-neutral-900">@micro-agi.com</span>{" "}
          Google account.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full bg-neutral-900 hover:bg-black text-white text-sm font-medium py-2.5 tracking-wide"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
