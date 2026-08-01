import { redirect } from "next/navigation";

import { isOnboarded, requireSession } from "@/lib/auth";

import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set up your account · TV Tracker" };

export default async function WelcomePage() {
  // Redirects to /login when there's no session. This page is reachable with a
  // half-configured account — it is the only route that is, which is why it
  // calls requireSession rather than requireOnboardedSession.
  const session = await requireSession();

  if (isOnboarded(session.user)) redirect("/");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">
        Set up your account
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        {session.user.nickname
          ? "Choose a password. You'll sign in with these from now on."
          : "Choose a nickname and password. You'll sign in with these from now on."}
      </p>

      {/* An account that already has a nickname keeps it — the field is shown
          as settled rather than editable, because nicknames are permanent. */}
      <OnboardingForm existingNickname={session.user.nickname} />
    </div>
  );
}
