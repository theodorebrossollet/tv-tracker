"use client";

import { Toaster as Sonner } from "sonner";

/**
 * The one place toasts are drawn (Sonner), mounted once in the root layout.
 * Raise them through `lib/notify.ts`, which also says where they don't belong.
 *
 * Bottom centre, lifted by `--tab-bar-room` so a toast clears the floating tab
 * bar the same way the last row of a list does. Both offsets are set because
 * Sonner switches to `mobileOffset` under 600px, which is every phone.
 *
 * Dressed in the palette through Sonner's own variables rather than `unstyled`:
 * its layout, stacking and swipe-to-dismiss are the reason to use it, and only
 * the colours were wrong. `theme="dark"` is fixed, since the app is dark only.
 */
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={{ bottom: "var(--tab-bar-room)" }}
      mobileOffset={{ bottom: "var(--tab-bar-room)" }}
      visibleToasts={2}
      className="font-sans"
      style={
        {
          "--normal-bg": "var(--surface-raised)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--foreground)",
          "--border-radius": "16px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "!font-sans !text-[14px] !shadow-[0_12px_30px_rgba(0,0,0,.45)]",
          error: "[&_[data-icon]]:text-danger",
          actionButton:
            "!h-8 !rounded-full !bg-accent !px-3.5 !text-[13px] !font-semibold !text-on-accent",
        },
      }}
    />
  );
}
