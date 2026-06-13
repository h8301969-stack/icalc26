import React, { useState, useEffect } from 'react';

// Import local images using the @ alias defined in your config
import pos1 from '@/assets/autoswipe/pos1.png';
import pos2 from '@/assets/autoswipe/pos2.png';
import pos3 from '@/assets/autoswipe/pos3.png';
import pos4 from '@/assets/autoswipe/pos4.png';
import pos5 from '@/assets/autoswipe/pos5.png';
import pos6 from '@/assets/autoswipe/pos6.png';

const swipeImages = [pos1, pos2, pos3, pos4, pos5, pos6];

export const AutoSwipe: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    // Set up the interval for 3 seconds (3000ms)
    const timer = setInterval(() => {
      setCurrentIndex((prevIndex) => 
        prevIndex === swipeImages.length - 1 ? 0 : prevIndex + 1
      );
    }, 3000);

    // Clean up the interval on component unmount
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full max-w-lg mx-auto overflow-hidden rounded-2xl shadow-xl bg-gray-900">
      {/* Slider Container */}
      <div 
        className="flex transition-transform duration-700 ease-in-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {swipeImages.map((image, index) => (
          <div key={index} className="w-full flex-shrink-0">
            <img 
              src={image} 
              alt={`Slide ${index + 1}`} 
              className="w-full h-auto object-contain"
            />
          </div>
        ))}
      </div>

      {/* Pagination Indicators */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 space-x-2">
        {swipeImages.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-2 w-2 rounded-full transition-all ${
              index === currentIndex ? 'bg-white w-4' : 'bg-white/50'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
};