export enum SimulationScoreFormular {
  RiskAdjustedCopyScore = 'RiskAdjustedCopyScore',
}

export enum SimulationSizingFormular {
  ScoreScaledCollateralSizing = 'ScoreScaledCollateralSizing',
}

export const DEFAULT_SCORE_FORMULAR =
  SimulationScoreFormular.RiskAdjustedCopyScore;

export const DEFAULT_SIZING_FORMULAR =
  SimulationSizingFormular.ScoreScaledCollateralSizing;
