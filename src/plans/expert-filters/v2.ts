export const oldFilter = {
  minR2: 0.9,
  window: 6,
  minScore: 10,
  n: 2,
  m: 1,
};

const size_0_300 = {
  ratio: 0.5,
  maxSize: 150,
  subFilters: [
    {
      window: 12,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 0,
      maxAvgSize: 300,
      minCount: 16,
      maxCount: 32,
      minR2: 0.95,
    },
    {
      window: 38,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 0,
      maxAvgSize: 300,
      minCount: 256,
      maxCount: 512,
      minR2: 0.85,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 0,
      maxAvgSize: 300,
      minCount: 512,
      maxCount: 1000_000_000,
      minR2: 0.85,
    },
  ],
};

const size_300_2000 = {
  ratio: 0.25,
  maxSize: 300,
  subFilters: [
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 300,
      maxAvgSize: 2000,
      minCount: 0,
      maxCount: 16,
      minR2: 0.95,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 300,
      maxAvgSize: 2000,
      minCount: 16,
      maxCount: 32,
      minR2: 0.95,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 300,
      maxAvgSize: 2000,
      minCount: 32,
      maxCount: 64,
      minR2: 0.95,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 300,
      maxAvgSize: 2000,
      minCount: 64,
      maxCount: 128,
      minR2: 0.9,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 300,
      maxAvgSize: 2000,
      minCount: 256,
      maxCount: 1000_000_000,
      minR2: 0.95,
    },
  ],
};

const size_2000_5000 = {
  ratio: 0.1,
  maxSize: 500,
  subFilters: [
    {
      window: 12,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 2000,
      maxAvgSize: 5000,
      minCount: 0,
      maxCount: 16,
      minR2: 0.95,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 2000,
      maxAvgSize: 5000,
      minCount: 16,
      maxCount: 32,
      minR2: 0.85,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 2000,
      maxAvgSize: 5000,
      minCount: 32,
      maxCount: 64,
      minR2: 0.9,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 2000,
      maxAvgSize: 5000,
      minCount: 64,
      maxCount: 128,
      minR2: 0.85,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 2000,
      maxAvgSize: 5000,
      minCount: 256,
      maxCount: 1000_000_000,
      minR2: 0.9,
    },
  ],
};

const size_5000_10000 = {
  ratio: 0.05,
  maxSize: 500,
  subFilters: [
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 5000,
      maxAvgSize: 10000,
      minCount: 16,
      maxCount: 32,
      minR2: 0.95,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 5000,
      maxAvgSize: 10000,
      minCount: 32,
      maxCount: 64,
      minR2: 0.95,
    },
    {
      window: 12,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 5000,
      maxAvgSize: 10000,
      minCount: 128,
      maxCount: 256,
      minR2: 0.9,
    },
    {
      window: 12,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 5000,
      maxAvgSize: 10000,
      minCount: 256,
      maxCount: 512,
      minR2: 0.9,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 5000,
      maxAvgSize: 10000,
      minCount: 512,
      maxCount: 1000_000_000,
      minR2: 0.85,
    },
  ],
};

const size_10000_50000 = {
  ratio: 0.01,
  maxSize: 500,
  subFilters: [
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 10000,
      maxAvgSize: 50000,
      minCount: 0,
      maxCount: 16,
      minR2: 0.9,
    },
    {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 10000,
      maxAvgSize: 50000,
      minCount: 16,
      maxCount: 32,
      minR2: 0.95,
    },
    {
      window: 12,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 10000,
      maxAvgSize: 50000,
      minCount: 32,
      maxCount: 64,
      minR2: 0.9,
    },
  ],
};

export type ExpertFilterParams = {
  window: number;
  n: number;
  m: number;
  minScore: number;
  minAvgSize: number;
  maxAvgSize: number;
  minCount: number;
  maxCount: number;
  minR2: number;
};

export const bestFilters = [
  // size_0_300,
  // size_300_2000,
  size_2000_5000,
  size_5000_10000,
  size_10000_50000,
].flatMap((item) =>
  item.subFilters.map((subFilter) => ({
    ratio: item.ratio,
    maxSize: item.maxSize,
    ...subFilter,
  })),
);
