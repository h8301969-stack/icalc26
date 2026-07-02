import pos1 from '../assets/autoswipe/pos1.png';
import pos2 from '../assets/autoswipe/pos2.png';
import pos3 from '../assets/autoswipe/pos3.png';
import pos4 from '../assets/autoswipe/pos4.png';
import pos5 from '../assets/autoswipe/pos5.png';
import pos6 from '../assets/autoswipe/pos6.png';

export const WALLPAPER_IMAGE_URLS = [pos1, pos2, pos3, pos4, pos5, pos6] as const;

const LEGACY_WALLPAPER_MAP: Record<string, string> = {
  '/assets/autoswipe/pos1.png': pos1,
  '/assets/autoswipe/pos2.png': pos2,
  '/assets/autoswipe/pos3.png': pos3,
  '/assets/autoswipe/pos4.png': pos4,
  '/assets/autoswipe/pos5.png': pos5,
  '/assets/autoswipe/pos6.png': pos6,
};

export type WallpaperSlide = {
  image: string;
  header: string;
  subHeader: string;
};

export const WALLPAPER_SLIDES: WallpaperSlide[] = [
  {
    image: pos1,
    header: 'iCalc Vision',
    subHeader: 'Precision engineered for the next generation of spatial computing.',
  },
  {
    image: pos2,
    header: 'Spatial Identity',
    subHeader: 'Seamless integration with modern digital ecosystems.',
  },
  {
    image: pos3,
    header: 'Neural Flow',
    subHeader: 'Dynamic visual structures designed for immersive workflows.',
  },
];

export const resolveWallpaperImage = (image: string): string =>
  LEGACY_WALLPAPER_MAP[image] ?? image;

export const migrateWallpaperSlides = (
  slides: WallpaperSlide[] | undefined
): WallpaperSlide[] => {
  if (!slides?.length) return WALLPAPER_SLIDES;
  return slides.map((slide) => ({
    ...slide,
    image: resolveWallpaperImage(slide.image),
  }));
};