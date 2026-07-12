import React from 'react';
import BusinessReceiptIdentity from './BusinessReceiptIdentity';

export interface BusinessInfoReceiptCardProps {
  businessName: string;
  businessPhone?: string;
  businessAddress?: string;
  brandLabel?: string;
  badgeLabel?: string;
  variant?: 'modal' | 'settings' | 'compact';
  className?: string;
  editable?: boolean;
  isLight?: boolean;
  onBusinessNameChange?: (value: string) => void;
  onBusinessPhoneChange?: (value: string) => void;
  onBusinessAddressChange?: (value: string) => void;
}

const BusinessInfoReceiptCard: React.FC<BusinessInfoReceiptCardProps> = ({
  businessName,
  businessPhone = '',
  businessAddress = '',
  brandLabel = 'iCalc POS',
  badgeLabel = 'Business',
  variant = 'modal',
  className = '',
  editable = false,
  isLight = true,
  onBusinessNameChange,
  onBusinessPhoneChange,
  onBusinessAddressChange,
}) => {
  return (
    <div
      className={`business-receipt-card business-receipt-card--${variant} ${editable ? 'business-receipt-card--editable' : ''} ${className}`.trim()}
    >
      <header className="business-receipt-card__header invoice-switcher-card__header">
        <div className="invoice-switcher-card__brand-row">
          <span className="invoice-switcher-card__brand" title={brandLabel}>
            {brandLabel}
          </span>
          <span className="invoice-switcher-card__badge">{badgeLabel}</span>
        </div>
        <BusinessReceiptIdentity
          businessName={businessName}
          businessPhone={businessPhone}
          businessAddress={businessAddress}
          editable={editable}
          isLight={isLight}
          onBusinessNameChange={onBusinessNameChange}
          onBusinessPhoneChange={onBusinessPhoneChange}
          onBusinessAddressChange={onBusinessAddressChange}
        />
      </header>

      <div className="business-receipt-card__body invoice-switcher-card__body invoice-receipt-line">
        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <div className="invoice-switcher-card__rule" aria-hidden="true" />
      </div>
    </div>
  );
};

export default BusinessInfoReceiptCard;