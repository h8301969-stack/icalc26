import React, { useState, useEffect, useRef } from 'react';

interface BlurredBackgroundProps {
  isLight: boolean;
  wallpapers: { image: string }[];
  isUnlocked?: boolean;
  result?: string;
  isLandscape?: boolean;
}

const BlurredBackground: React.FC<BlurredBackgroundProps> = ({
  isLight,
  wallpapers,
  isUnlocked = true,
  result,
  isLandscape = false,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [springKey, setSpringKey] = useState(0);
  const prevResultRef = useRef(result);

  useEffect(() => {
    if (wallpapers.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % wallpapers.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [wallpapers]);

  useEffect(() => {
    if (result && result !== prevResultRef.current && result !== '0' && result !== '0.00') {
      setSpringKey((k) => k + 1);
    }
    prevResultRef.current = result;
  }, [result]);

  const showResult = result && result !== '0.00' && result !== '0';

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {wallpapers.map((slide, index) => (
        <div
          key={index}
          className={`absolute inset-0 transition-opacity duration-[2000ms] ease-in-out ${
            index === currentSlide ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <img
            src={slide.image}
            alt=""
            className={`w-full h-full object-cover scale-110 transition-all duration-1000 ${isUnlocked ? 'blur-[80px]' : 'blur-0'} brightness-[0.7] saturate-[1.2]`}
          />
        </div>
      ))}

      <div
        className={`absolute inset-0 transition-colors duration-700 ${
          isLight ? 'bg-white/30' : 'bg-black/40'
        }`}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />

      {showResult && (
        <div
          className={`absolute z-[1] flex justify-center pointer-events-none select-none ${
            isLandscape
              ? 'top-[12%] bottom-[8%] right-[4%] w-[42%] items-center'
              : 'inset-x-0 bottom-[6%] items-end'
          }`}
        >
          <div className="animate-live-breathe">
            <div
              key={springKey}
              className={`
                text-[clamp(72px,22vw,160px)] font-black tracking-[-0.04em] leading-none
                ${isLight ? 'text-black animate-live-breathe-opacity' : 'text-white live-result-dark animate-live-breathe-opacity'}
                animate-live-spring
              `}
              aria-hidden="true"
            >
              {result}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlurredBackground;