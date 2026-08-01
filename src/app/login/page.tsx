import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · TV Tracker" };

export default async function LoginPage() {
  const session = await getSession();

  // Already signed in — send them wherever they were headed anyway, rather
  // than offering a login form that would replace a perfectly good session.
  if (session) redirect(session.user.nickname === null ? "/welcome" : "/");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Enter the account code you were given.
      </p>

      <LoginForm />
    </div>
  );
}
