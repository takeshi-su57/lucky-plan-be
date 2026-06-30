import { SERVICE_NAMES } from 'src/utils/constants';

export function isAnalyticsServiceName(serviceName: string | undefined) {
  return serviceName === SERVICE_NAMES.ANALYTICS_SERVICE;
}
