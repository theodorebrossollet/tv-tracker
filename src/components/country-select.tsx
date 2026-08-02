"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Select } from "@/components/select";

interface CountrySelectProps {
  value: string;
  /** Codes and display names for the countries this show is available in. */
  options: Array<{ code: string; name: string }>;
}

/**
 * The country picker for the availability panel.
 *
 * The only client component in that panel, and it carries only the codes and
 * names it needs for the dropdown — not the provider lists. Switching country
 * is a navigation, so the server sends back just the chosen country's
 * providers instead of every country's arriving with the page on the chance
 * someone opens this menu.
 *
 * That costs a round trip on change, which is the right trade here: the picker
 * is the rarely-touched part of a page that always carried the cost of it.
 */
export function CountrySelect({ value, options }: CountrySelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  function select(code: string) {
    const next = new URLSearchParams(searchParams);
    next.set("country", code);

    // `scroll: false` keeps the reader where they are — the panel sits well
    // down the page, and jumping to the top on every change would be worse
    // than the wait.
    start(() => router.push(`?${next.toString()}`, { scroll: false }));
  }

  return (
    <Select
      value={value}
      disabled={pending}
      onChange={(event) => select(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
        </option>
      ))}
    </Select>
  );
}
