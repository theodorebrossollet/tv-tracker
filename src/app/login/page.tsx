import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, isOnboarded } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · TV Tracker" };

export default async function LoginPage() {
  const session = await getSession();

  // Already signed in — send them where they were going anyway, rather than
  // offering a form that would replace a perfectly good session.
  if (session) redirect(isOnboarded(session.user) ? "/" : "/welcome");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">Welcome</h1>
      <p className="mt-2 text-sm text-neutral-500">
        How would you like to sign in?
      </p>

      <div className="mt-6 space-y-3">
        <Link
          href="/login/password"
          className="block rounded-md bg-neutral-900 px-3 py-2 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          I have an account
        </Link>

        <Link
          href="/login/code"
          className="block rounded-md border border-neutral-300 px-3 py-2 text-center text-sm font-medium dark:border-neutral-700"
        >
          First time — I have a code
        </Link>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Accounts are created by invitation. Your code sets one up the first time
        you use it, and is also the way back in if you forget your password.
      </p>
    </div>
  );
}
