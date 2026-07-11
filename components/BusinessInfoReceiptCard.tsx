import React from 'react';

export interface BusinessInfoReceiptCardProps {
  businessName: string;
  businessPhone?: string;
  businessAddress?: string;
  brandLabel?: string;
  badgeLabel?: string;
  variant?: 'modal' | 'settings' | 'compact';
  className?: string;
}

const BusinessInfoReceiptCard: React.FC<BusinessInfoReceiptCardProps> = ({
  businessName,
  businessPhone = '',
  businessAddress = '',
  brandLabel = 'iCalc POS',
  badgeLabel = 'Business',
  variant = 'modal',
  className = '',
}) => {
  const hasPhone = businessPhone.trim().length > 0;
  const hasAddress = businessAddress.trim().length > 0;

  return (
    <div
      className={`business-receipt-card business-receipt-card--${variant} ${className}`.trim()}
    >
      <header className="business-receipt-card__header invoice-switcher-card__header">
        <div className="invoice-switcher-card__brand-row">
          <span className="invoice-switcher-card__brand" title={brandLabel}>
            {brandLabel}
          </span>
          <span className="invoice-switcher-card__badge">{badgeLabel}</span>
        </div>
        <div className="invoice-switcher-card__title invoice-receipt-line truncate" title={businessName}>
          {businessName}
        </div>
      </header>

      <div className="business-receipt-card__body invoice-switcher-card__body invoice-receipt-line">
        <div className="invoice-switcher-card__rule" aria-hidden="true" />
        <div className="business-receipt-card__lines">
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
        </div>
        <div className="invoice-switcher-card__rule" aria-hidden="true" />
      </div>
    </div>
  );
};

export default BusinessInfoReceiptCard;