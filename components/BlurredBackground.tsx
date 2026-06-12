import React, { useState, useEffect } from 'react';

interface BlurredBackgroundProps {
  isLight: boolean;
  wallpapers: { image: string; header: string; subHeader: string }[];
}

const BlurredBackground: React.FC<BlurredBackgroundProps> = ({ isLight, wallpapers }) => {
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
            className="w-full h-full object-cover scale-110 blur-[80px] brightness-[0.7] saturate-[1.2]"
          />
        </div>
      ))}
      
      <div className={`absolute inset-0 transition-colors duration-700 ${
        isLight ? 'bg-white/30' : 'bg-black/40'
      }`} />
      
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
    </div>
  );
};

export default BlurredBackground;