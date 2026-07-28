import Image from "next/image";

import { posterUrl } from "@/lib/images";

interface PosterProps {
  path: string | null;
  name: string;
  /** Rendered width in px; height follows TMDB's 2:3 poster ratio. */
  width?: number;
  className?: string;
}

export function Poster({
  path,
  name,
  width = 92,
  className = "",
}: PosterProps) {
  const height = Math.round((width * 3) / 2);
  const url = posterUrl(path, width > 200 ? "w342" : "w185");

  if (!url) {
    return (
      <div
        style={{ width, height }}
        className={`flex shrink-0 items-center justify-center rounded-md border border-border bg-surface text-center text-[10px] leading-tight text-muted ${className}`}
      >
        No poster
      </div>
    );
  }

  return (
    <Image
      src={url}
      alt={`Poster for ${name}`}
      width={width}
      height={height}
      className={`shrink-0 rounded-md border border-border object-cover ${className}`}
    />
  );
}
