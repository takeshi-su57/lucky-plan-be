export const bestFilters: ExpertFilterParams[] = [
  {
    window: 6,
    n: 2,
    m: 1,
    minScore: 10,
    minAvgSize: 2500,
    maxAvgSize: 50000,
    minCount: 10,
    maxCount: 109,
    ratio: 0.02,
    maxSize: 250,
  },
  {
    window: 6,
    n: 2,
    m: 1,
    minScore: 10,
    minAvgSize: 2500,
    maxAvgSize: 50000,
    minCount: 160,
    maxCount: 190,
    ratio: 0.02,
    maxSize: 250,
  },
  {
    window: 6,
    n: 2,
    m: 1,
    minScore: 10,
    minAvgSize: 2500,
    maxAvgSize: 50000,
    minCount: 240,
    maxCount: 280,
    ratio: 0.02,
    maxSize: 250,
  },
  {
    window: 6,
    n: 2,
    m: 1,
    minScore: 10,
    minAvgSize: 2500,
    maxAvgSize: 50000,
    minCount: 320,
    maxCount: 730,
    ratio: 0.02,
    maxSize: 250,
  },
  {
    window: 6,
    n: 2,
    m: 1,
    minScore: 10,
    minAvgSize: 2500,
    maxAvgSize: 50000,
    minCount: 810,
    maxCount: 1000_000_000,
    ratio: 0.02,
    maxSize: 250,
  },
];

export type ExpertFilterParams = {
  window: number;
  n: number;
  m: number;
  minScore: number;
  minAvgSize: number;
  maxAvgSize: number;
  minCount: number;
  maxCount: number;
  minR2?: number;
  ratio: number;
  maxSize: number;
  lastCount?: number;
  ignoreMinPnlLimit?: boolean;
  ignoreMinDurationLimit?: boolean;
};
