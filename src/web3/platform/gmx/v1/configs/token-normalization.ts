const assetSymbolOverrides: Record<string, string> = {
  WETH: 'ETH',
  'WETH.E': 'ETH',
  WBTC: 'BTC',
  'WBTC.E': 'BTC',
  'BTC.B': 'BTC',
  WAVAX: 'AVAX',
};

export function toGmxV1AssetSymbol(tokenSymbol: string): string {
  const normalizedSymbol = tokenSymbol.trim().toUpperCase();

  return assetSymbolOverrides[normalizedSymbol] || normalizedSymbol;
}
