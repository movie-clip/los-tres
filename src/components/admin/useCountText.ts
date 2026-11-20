import { useLocale } from 'next-intl';
import { useMemo } from 'react';

/**
 * Formats a count for a message. CLDR drops the separator on four digits; the design wants 1.234 productos,
 * so the number goes in as text and the message keeps the plural choice on the number itself.
 */
export function useCountText(): (count: number) => string {
  const locale = useLocale();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale, { useGrouping: 'always' });
    return (count: number) => format.format(count);
  }, [locale]);
}
