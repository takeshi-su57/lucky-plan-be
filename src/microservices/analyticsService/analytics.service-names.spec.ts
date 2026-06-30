import { describe, expect, it } from '@jest/globals';

import { SERVICE_NAMES } from 'src/utils/constants';
import { isAnalyticsServiceName } from './analytics.service-names';

describe('analytics service names', () => {
  it('accepts the new analytics service name', () => {
    expect(isAnalyticsServiceName(SERVICE_NAMES.ANALYTICS_SERVICE)).toBe(true);
  });

  it('rejects non-analytics service names', () => {
    expect(isAnalyticsServiceName(SERVICE_NAMES.API_SERVICE)).toBe(false);
    expect(isAnalyticsServiceName(SERVICE_NAMES.COPY_TRADING_SERVICE)).toBe(
      false,
    );
    expect(isAnalyticsServiceName('UNKNOWN_SERVICE')).toBe(false);
  });
});
