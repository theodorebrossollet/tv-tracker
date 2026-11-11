import Image from "next/image";

interface AuthScreenProps {
  title: string;
  /** One or two sentences under the title. */
  lede?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The frame the three screens outside the app share: sign in, recover with a
 * code, and choose a password. The mark, a large title, then the form.
 *
 * The mark is the screen's one decorative element, and it is the app's own
 * icon rather than an effect: these screens are seen for a few seconds a few
 * times a year, by one person.
 */
export function AuthScreen({ title, lede, children }: AuthScreenProps) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center py-10">
      <Image
        src="/icon-192.png"
        alt=""
        width={56}
        height={56}
        priority
        className="size-14 rounded-[14px]"
      />

      <h1 className="mt-6 text-[32px] font-bold leading-[1.05] tracking-[-0.03em]">
        {title}
      </h1>
      {lede ? (
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{lede}</p>
      ) : null}

      {children}
    </div>
  );
}
