import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { getSession, isOnboarded } from "@/lib/auth";

import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · TV Tracker" };

/**
 * Sign in: nickname and password, with the account code one link away.
 *
 * This used to be a chooser ("I have an account" / "First time, I have a
 * code") in front of two forms, from when codes were handed out as invites.
 * There is one account now, so the everyday form is the page and the code is
 * what it always also was: the way back in after a forgotten password.
 */
export default async function LoginPage() {
  const session = await getSession();

  // Already signed in — send them where they were going anyway, rather than
  // offering a form that would replace a perfectly good session.
  if (session) redirect(isOnboarded(session.user) ? "/" : "/welcome");

  return (
    <AuthScreen title="Sign in">
      <PasswordForm />

      <Link
        href="/login/code"
        className="mt-5 flex min-h-11 items-center justify-center text-[13.5px] text-muted transition-colors hover:text-foreground"
      >
        Forgot your password? Use your account code
      </Link>
    </AuthScreen>
  );
}
