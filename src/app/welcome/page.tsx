import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth";

import { NicknameForm } from "./nickname-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Choose a nickname · TV Tracker" };

export default async function WelcomePage() {
  // Redirects to /login when there's no session. This page is reachable with a
  // session whose nickname is still null — it is the one route that is, which
  // is why it calls requireSession rather than requireOnboardedSession.
  const session = await requireSession();

  // Already onboarded. Sending them home rather than showing a form that would
  // only ever be rejected keeps "permanent" honest in the UI as well as the
  // action.
  if (session.user.nickname !== null) redirect("/");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">
        Choose your nickname
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        This is how you&rsquo;ll be known in the app.
      </p>

      <NicknameForm />
    </div>
  );
}
