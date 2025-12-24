/**
 * Fulfillment Mix Calculator
 * 
 * Answers: "Who am I operationally competing against?"
 * 
 * Buckets:
 * - FBA: Fulfilled by Amazon (Prime-eligible)
 * - FBM: Fulfilled by Merchant
 * - Amazon: Amazon Retail (sold by Amazon)
 * 
 * Always returns percentages that sum to 100.
 */

import { ParsedListing } from "./keywordMarket";

export interface FulfillmentMix {
  fba: number; // % FBA
  fbm: number; // % FBM
  amazon: number; // % Amazon Retail
}

/**
 * Compute fulfillment mix from listings
 * 
 * Detection Logic (Rainforest-first, fallback safe):
 * 1. Amazon Retail: seller === 'Amazon' OR brand === 'Amazon'
 * 2. FBA: is_prime === true OR fulfillment === 'FBA'
 * 3. FBM: Everything else (default)
 * 
 * Always returns percentages, even if data is missing (uses defaults).
 */
export function computeFulfillmentMix(listings: ParsedListing[]): FulfillmentMix {
  let fba = 0;
  let fbm = 0;
  let amazon = 0;
  
  listings.forEach(l => {
    // Check for Amazon Retail first
    // Detection: seller === 'Amazon' OR brand === 'Amazon'
    const isAmazonRetail = l.seller === 'Amazon' || l.brand === 'Amazon' || l.fulfillment === 'Amazon';
    
    if (isAmazonRetail) {
      amazon++;
    } else if (l.is_prime === true || l.fulfillment === 'FBA') {
      // FBA: is_prime === true OR fulfillment === 'FBA' (Prime-eligible)
      fba++;
    } else {
      // FBM: Everything else (default)
      fbm++;
    }
  });
  
  const total = listings.length || 1;
  
  return {
    fba: Math.round((fba / total) * 100),
    fbm: Math.round((fbm / total) * 100),
    amazon: Math.round((amazon / total) * 100),
  };
}
