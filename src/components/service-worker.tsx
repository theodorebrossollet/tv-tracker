"use client";

import { useEffect } from "react";

/**
 * Registers the shell cache in public/sw.js.
 *
 * Registration is deliberately not awaited or surfaced: a browser without
 * service worker support, or a user who has blocked them, should get the app
 * exactly as before rather than an error. Nothing in the app depends on the
 * worker being there — it only makes a second visit faster.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration competes with the first render for bandwidth, and the
    // worker is only useful on the *next* visit, so it waits for load.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Blocked, unsupported, or served over plain http — all fine.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
