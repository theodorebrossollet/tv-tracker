import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, isOnboarded } from "@/lib/auth";

import { CodeForm } from "./code-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in with a code · TV Tracker" };

export default async function CodeLoginPage() {
  const session = await getSession();
  if (session) redirect(isOnboarded(session.user) ? "/" : "/welcome");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">Enter your code</h1>
      <p className="mt-2 text-sm text-neutral-500">
        The code you were given. Use this the first time, or if you&rsquo;ve
        forgotten your password.
      </p>

      <CodeForm />

      <Link
        href="/login"
        className="mt-6 block text-center text-xs text-neutral-500 underline"
      >
        Back
      </Link>
    </div>
  );
}
