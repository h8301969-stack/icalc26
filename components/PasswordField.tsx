import React, { useState } from 'react';
import { Icons } from '../constants';
import { formInputClass } from '../utils/formFields';

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  isLight: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  maxLength?: number;
  mono?: boolean;
  spellCheck?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  'aria-label'?: string;
}

const PasswordField: React.FC<PasswordFieldProps> = ({
  value,
  onChange,
  placeholder,
  autoComplete,
  isLight,
  className = '',
  inputClassName = '',
  id,
  maxLength,
  mono = false,
  spellCheck = false,
  autoFocus = false,
  disabled = false,
  onKeyDown,
  'aria-label': ariaLabel,
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`password-field ${className}`.trim()}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        spellCheck={spellCheck}
        autoFocus={autoFocus}
        disabled={disabled}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel ?? placeholder}
        className={`${formInputClass(isLight, { mono, className: inputClassName })} password-field__input`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className={`password-field__toggle ${isLight ? 'text-black/45 hover:text-black/70' : 'text-white/45 hover:text-white/75'}`}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
      </button>
    </div>
  );
};

export default PasswordField;