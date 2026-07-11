/** Line sums use cedis (¢); green totals use ghs suffix when currency is GHS. */
export const formatSwitcherLineSum = (amount: string, currency: string): string => {
  if (currency === 'GHS') return `¢${amount}`;
  return `${currency}${amount}`;
};

export const formatSwitcherTotal = (total: string, currency: string): string => {
  if (currency === 'GHS') return `${total}ghs`;
  return `${currency}${total}`;
};