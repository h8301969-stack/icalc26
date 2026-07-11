/** Shared form typography — matches admin portal field uniformity. */

export const FORM_FIELD_LABEL =
  'app-subtext text-[10px] font-black uppercase tracking-widest opacity-60 block mb-1.5';

export const FORM_SECTION_TITLE = 'text-sm font-black uppercase tracking-[0.2em]';

export const formFieldTheme = (isLight: boolean): string =>
  isLight
    ? 'bg-white/90 border-black/10 text-black placeholder:text-black/35'
    : 'bg-white/8 border-white/12 text-white placeholder:text-white/35';

export const formInputClass = (
  isLight: boolean,
  options?: { mono?: boolean; size?: 'md' | 'lg'; className?: string }
): string => {
  const size = options?.size ?? 'md';
  const padding = size === 'lg' ? 'px-5 py-4 text-base' : 'px-4 py-3 text-sm';
  const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl';
  const weight = options?.mono ? 'font-mono font-black tracking-widest' : 'font-bold';
  const extra = options?.className?.trim() ?? '';
  const themeClass = isLight ? 'app-input app-input--light' : 'app-input app-input--dark';
  return [
    'w-full border outline-none font-text disabled:opacity-50',
    themeClass,
    radius,
    padding,
    weight,
    formFieldTheme(isLight),
    extra,
  ]
    .filter(Boolean)
    .join(' ');
};

export const formTextareaClass = (isLight: boolean, className?: string): string => {
  const themeClass = isLight ? 'app-textarea app-textarea--light' : 'app-textarea app-textarea--dark';
  return [
    'w-full px-3 py-2 rounded-xl border outline-none text-sm font-bold resize-none font-text disabled:opacity-50',
    themeClass,
    formFieldTheme(isLight),
    className?.trim(),
  ]
    .filter(Boolean)
    .join(' ');
};