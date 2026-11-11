import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { getSession, isOnboarded } from "@/lib/auth";

import { CodeForm } from "./code-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Use your account code · TV Tracker" };

export default async function CodeLoginPage() {
  const session = await getSession();
  if (session) redirect(isOnboarded(session.user) ? "/" : "/welcome");

  return (
    <AuthScreen
      title="Use your account code"
      // Says what it costs before it is used: `loginWithCode` clears the
      // password and every session the moment a valid code arrives.
      lede="This signs you in and has you choose a new password. Every other device is signed out."
    >
      <CodeForm />

      <Link
        href="/login"
        className="mt-5 flex min-h-11 items-center justify-center text-[13.5px] text-muted transition-colors hover:text-foreground"
      >
        Back to sign in
      </Link>
    </AuthScreen>
  );
}
