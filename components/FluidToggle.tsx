import React from 'react';

interface FluidToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  isLight?: boolean;
  ariaLabel: string;
  offLabel?: string;
  onLabel?: string;
}

const FluidToggle: React.FC<FluidToggleProps> = ({
  checked,
  onChange,
  isLight = false,
  ariaLabel,
  offLabel = 'Off',
  onLabel = 'On',
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onChange(!checked)}
    className={`fluid-toggle group ${checked ? 'fluid-toggle--on' : 'fluid-toggle--off'} ${
      isLight ? 'fluid-toggle--light' : 'fluid-toggle--dark'
    }`}
  >
    <span className="fluid-toggle-track" aria-hidden>
      <span className="fluid-toggle-thumb" />
    </span>
    <span className="fluid-toggle-label" aria-hidden>
      {checked ? onLabel : offLabel}
    </span>
  </button>
);

export default FluidToggle;