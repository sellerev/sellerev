/**
 * Search result types for keyword market analysis
 */

export interface Appearance {
  asin: string;
  position: number;
  isSponsored: boolean;
  source: 'organic' | 'sponsored';
}

