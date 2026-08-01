import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, isOnboarded } from "@/lib/auth";

import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · TV Tracker" };

export default async function PasswordLoginPage() {
  const session = await getSession();
  if (session) redirect(isOnboarded(session.user) ? "/" : "/welcome");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>

      <PasswordForm />

      <Link
        href="/login/code"
        className="mt-6 block text-center text-xs text-neutral-500 underline"
      >
        Forgotten your password? Use your code
      </Link>
    </div>
  );
}
