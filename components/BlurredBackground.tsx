import React, { useState, useEffect } from 'react';
import { resolveWallpaperUrl } from '../utils/accountMedia';
import { resolveWallpaperImage } from '../utils/wallpapers';

interface BlurredBackgroundProps {
  isLight: boolean;
  wallpapers: { image: string }[];
  isUnlocked?: boolean;
}

const BlurredBackground: React.FC<BlurredBackgroundProps> = ({
  isLight,
  wallpapers,
  isUnlocked = true,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [resolved, setResolved] = useState<string[]>([]);
  const slides = wallpapers.length > 0 ? wallpapers : [{ image: '' }];

  useEffect(() => {
    let cancelled = false;
    void Promise.all(slides.map((slide, index) => resolveWallpaperUrl(slide.image, index))).then(
      (urls) => {
        if (!cancelled) setResolved(urls);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [wallpapers]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none min-h-[100dvh] min-w-full"
      aria-hidden="true"
    >
      {slides.map((slide, index) => {
        const imageUrl = resolved[index] || resolveWallpaperImage(slide.image);
        if (!imageUrl) return null;

        return (
          <div
            key={`${imageUrl}-${index}`}
            className={`absolute inset-[-12%] transition-opacity duration-[2000ms] ease-in-out ${
              index === currentSlide ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div
              className={`wallpaper-layer absolute inset-0 bg-cover bg-center bg-no-repeat ${
                isUnlocked ? 'wallpaper-layer--blurred' : 'wallpaper-layer--sharp'
              }`}
              style={{ backgroundImage: `url("${imageUrl}")` }}
            />
          </div>
        );
      })}

      <div
        className={`absolute inset-0 transition-colors duration-700 ${
          isLight ? 'bg-white/30' : 'bg-black/40'
        }`}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
    </div>
  );
};

export default BlurredBackground;