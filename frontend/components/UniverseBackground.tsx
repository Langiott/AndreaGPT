/// <reference types="vite/client" />
import { useEffect, useState } from "react";

const FIVE_MINUTES = 5 * 60 * 1000;

export function UniverseBackground({ images, pinnedId }: { images: { id: string; url: string }[]; pinnedId?: string }) {
  const pinnedIndex = pinnedId ? images.findIndex(image => image.id === pinnedId) : -1;
  const [slides, setSlides] = useState(() => ({ current: pinnedIndex >= 0 ? pinnedIndex : Math.floor(Math.random() * images.length), previous: -1 }));
  useEffect(() => { if (pinnedIndex >= 0 && slides.current !== pinnedIndex) setSlides({ current: pinnedIndex, previous: -1 }); }, [pinnedIndex, slides.current]);
  useEffect(() => {
    if (pinnedIndex >= 0 || images.length < 2) return;
    let active = true;
    const next = (slides.current + 1) % images.length;
    const preload = new Image();
    preload.src = images[next].url;
    const timer = window.setTimeout(async () => {
      try {
        await preload.decode();
        if (active) setSlides({ current: next, previous: slides.current });
      } catch {
        if (active) setSlides({ current: (next + 1) % images.length, previous: slides.current });
      }
    }, FIVE_MINUTES);
    return () => { active = false; window.clearTimeout(timer); };
  }, [slides.current, pinnedIndex, images.length]);

  if (!images.length) return null;
  return <div className="universe-background" aria-hidden="true">
    {slides.previous >= 0 && <img className="universe-previous" src={images[slides.previous].url} alt="" />}
    <img key={slides.current} className="universe-current" src={images[slides.current].url} alt="" />
    <div className="universe-veil" />
  </div>;
}
