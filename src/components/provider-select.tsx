"use client";

import Image from "next/image";

import { posterUrl } from "@/lib/images";
import type { WatchProvider } from "@/lib/tmdb";

interface ProviderSelectProps {
  /** Every provider TMDB lists for the user's country, for the picker. */
  options: WatchProvider[];
  /** Ids of the providers currently picked. */
  selected: number[];
  onToggle: (id: number) => void;
  /**
   * Set while a save is in flight. Locks the whole group, not just the chip
   * being saved: each toggle sends the entire list, so a second click before
   * the first lands races two full writes and the loser silently wins.
   */
  disabled: boolean;
}

/**
 * A grid of toggleable service chips, visually based on `ProviderBadge` in
 * `availability.tsx` but interactive. Native checkboxes (visually hidden)
 * rather than plain buttons, so the group reads as a set of toggles to
 * assistive tech without extra ARIA bookkeeping.
 *
 * Hiding the input means the label has to carry the focus ring itself —
 * without it, keyboard users tab through the group with nothing on screen
 * saying where they are.
 */
export function ProviderSelect({
  options,
  selected,
  onToggle,
  disabled,
}: ProviderSelectProps) {
  const selectedIds = new Set(selected);

  return (
    <div
      role="group"
      aria-label="Streaming services"
      className="flex flex-wrap gap-2"
    >
      {options.map((provider) => {
        const active = selectedIds.has(provider.id);
        const logo = posterUrl(provider.logoPath, "w185");

        return (
          <label
            key={provider.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
              active
                ? "border-accent bg-accent/10"
                : "border-border hover:bg-surface"
            } ${disabled ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              checked={active}
              disabled={disabled}
              onChange={() => onToggle(provider.id)}
              className="sr-only"
            />
            {logo ? (
              <Image
                src={logo}
                alt=""
                width={20}
                height={20}
                className="size-5 rounded-full object-cover"
              />
            ) : null}
            <span className="text-xs">{provider.name}</span>
          </label>
        );
      })}
    </div>
  );
}
