import React, { useState, useEffect } from 'react';

interface BlurredBackgroundProps {
  isLight: boolean;
  wallpapers: { image: string }[];
  isUnlocked?: boolean;
  result?: string;
}

const BlurredBackground: React.FC<BlurredBackgroundProps> = ({ isLight, wallpapers, isUnlocked = true, result }) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (wallpapers.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % wallpapers.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [wallpapers]);

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
      
      <div className={`absolute inset-0 transition-colors duration-700 ${
        isLight ? 'bg-white/30' : 'bg-black/40'
      }`} />
      
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />

      {/* Familiar live result rendered on the blurred background (bottom portion) */}
      {result && result !== '0.00' && result !== '0' && (
        <div className="absolute inset-x-0 bottom-[6%] z-[1] flex justify-center pointer-events-none select-none">
          <div
            className={`text-[clamp(72px,22vw,160px)] font-black tracking-[-0.04em] leading-none opacity-[0.055] ${isLight ? 'text-black' : 'text-white'}`}
            aria-hidden="true"
          >
            {result}
          </div>
        </div>
      )}
    </div>
  );
};

export default BlurredBackground;