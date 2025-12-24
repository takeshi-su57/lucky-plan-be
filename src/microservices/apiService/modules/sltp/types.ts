export type SLTPCondition = {
  type: 'price' | 'percentage';
  isLong: boolean;
  pair: string;
  params: PercentageCondition | PriceConditionParams;
  updatedAt: string;
};

export type PercentageCondition = {
  percentage: number;
  initialPrice: number;
  highestPrice: number;
  exceptionPrice: number;
};

export type PriceConditionParams = {
  kind: 'tp' | 'sl';
  trigger: number;
};
