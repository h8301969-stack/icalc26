import React from 'react';
import { formInputClass } from '../utils/formFields';

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
  const hasPhone = businessPhone.trim().length > 0;
  const hasAddress = businessAddress.trim().length > 0;

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
        {editable ? (
          <input
            type="text"
            value={businessName}
            onChange={(e) => onBusinessNameChange?.(e.target.value)}
            placeholder="Business name"
            className="business-receipt-card__title-input invoice-receipt-line"
            aria-label="Business name"
          />
        ) : (
          <div className="invoice-switcher-card__title invoice-receipt-line truncate" title={businessName}>
            {businessName}
          </div>
        )}
      </header>

      <div className="business-receipt-card__body invoice-switcher-card__body invoice-receipt-line">
        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <div className="business-receipt-card__lines">
          {editable ? (
            <>
              <label className="business-receipt-card__field">
                <span className="business-receipt-card__label">Number</span>
                <input
                  type="tel"
                  value={businessPhone}
                  onChange={(e) => onBusinessPhoneChange?.(e.target.value)}
                  placeholder="+233 …"
                  className={formInputClass(isLight, { className: 'business-receipt-card__input' })}
                />
              </label>
              <label className="business-receipt-card__field business-receipt-card__field--stacked">
                <span className="business-receipt-card__label">Location</span>
                <input
                  type="text"
                  value={businessAddress}
                  onChange={(e) => onBusinessAddressChange?.(e.target.value)}
                  placeholder="Street, city"
                  className={formInputClass(isLight, { className: 'business-receipt-card__input' })}
                />
              </label>
            </>
          ) : (
            <>
              {hasPhone && (
                <div className="business-receipt-card__line">
                  <span className="business-receipt-card__label">Number</span>
                  <span className="business-receipt-card__value tabular-nums">{businessPhone}</span>
                </div>
              )}
              {hasAddress && (
                <div className="business-receipt-card__line business-receipt-card__line--stacked">
                  <span className="business-receipt-card__label">Location</span>
                  <span className="business-receipt-card__value">{businessAddress}</span>
                </div>
              )}
              {!hasPhone && !hasAddress && (
                <p className="business-receipt-card__empty">No contact details yet</p>
              )}
            </>
          )}
        </div>
        <div className="invoice-switcher-card__rule" aria-hidden="true" />
      </div>
    </div>
  );
};

export default BusinessInfoReceiptCard;