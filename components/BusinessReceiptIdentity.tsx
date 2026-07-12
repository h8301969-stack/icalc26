import React from 'react';

export interface BusinessReceiptIdentityProps {
  businessName: string;
  businessPhone?: string;
  businessAddress?: string;
  editable?: boolean;
  isLight?: boolean;
  onBusinessNameChange?: (value: string) => void;
  onBusinessPhoneChange?: (value: string) => void;
  onBusinessAddressChange?: (value: string) => void;
  className?: string;
}

const BusinessReceiptIdentity: React.FC<BusinessReceiptIdentityProps> = ({
  businessName,
  businessPhone = '',
  businessAddress = '',
  editable = false,
  isLight = true,
  onBusinessNameChange,
  onBusinessPhoneChange,
  onBusinessAddressChange,
  className = '',
}) => {
  const hasPhone = businessPhone.trim().length > 0;
  const hasAddress = businessAddress.trim().length > 0;
  const hasName = businessName.trim().length > 0;

  if (editable) {
    return (
      <div className={`business-receipt-identity business-receipt-identity--editable ${className}`.trim()}>
        <input
          type="text"
          value={businessName}
          onChange={(e) => onBusinessNameChange?.(e.target.value)}
          placeholder="Business name"
          className="business-receipt-identity__name-input invoice-receipt-line"
          aria-label="Business name"
        />
        <input
          type="text"
          value={businessAddress}
          onChange={(e) => onBusinessAddressChange?.(e.target.value)}
          placeholder="Location"
          className="business-receipt-identity__location-input invoice-receipt-line"
          aria-label="Location"
        />
        <input
          type="tel"
          value={businessPhone}
          onChange={(e) => onBusinessPhoneChange?.(e.target.value)}
          placeholder="Number"
          className="business-receipt-identity__phone-input invoice-receipt-line tabular-nums"
          aria-label="Number"
        />
      </div>
    );
  }

  if (!hasName && !hasPhone && !hasAddress) return null;

  return (
    <div className={`business-receipt-identity ${className}`.trim()}>
      {hasName && (
        <p className="business-receipt-identity__name invoice-receipt-line" title={businessName}>
          {businessName}
        </p>
      )}
      {hasAddress && (
        <p className="business-receipt-identity__location invoice-receipt-line" title={businessAddress}>
          {businessAddress}
        </p>
      )}
      {hasPhone && (
        <p className="business-receipt-identity__phone invoice-receipt-line tabular-nums" title={businessPhone}>
          {businessPhone}
        </p>
      )}
    </div>
  );
};

export default BusinessReceiptIdentity;