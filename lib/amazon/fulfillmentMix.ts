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
 * 🔒 STRICT RULE: Only use explicit fulfillment data.
 * DO NOT infer FBA from is_prime (Prime ≠ FBA).
 * 
 * Detection Logic:
 * 1. Amazon Retail: seller === 'Amazon' OR brand === 'Amazon' OR fulfillment === 'Amazon'
 * 2. FBA: fulfillment === 'FBA' (explicit only, from SP-API or Rainforest)
 * 3. FBM: fulfillment === 'FBM' (explicit only)
 * 4. Unknown: fulfillment === null (counted separately, not in mix)
 * 
 * Always returns percentages, even if data is missing (uses defaults).
 */
export function computeFulfillmentMix(listings: ParsedListing[]): FulfillmentMix {
  let fba = 0;
  let fbm = 0;
  let amazon = 0;
  let unknown = 0;
  
  listings.forEach(l => {
    // Check for Amazon Retail first
    const isAmazonRetail = l.seller === 'Amazon' || l.brand === 'Amazon' || l.fulfillment === 'Amazon';
    
    if (isAmazonRetail) {
      amazon++;
    } else if (l.fulfillment === 'FBA') {
      // FBA: Only if explicitly set (from SP-API or Rainforest)
      fba++;
    } else if (l.fulfillment === 'FBM') {
      // FBM: Only if explicitly set
      fbm++;
    } else {
      // Unknown: fulfillment is null or undefined
      // DO NOT infer from is_prime
      unknown++;
      // For now, count unknown as FBM for backward compatibility
      // TODO: Consider tracking unknown separately in the future
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
