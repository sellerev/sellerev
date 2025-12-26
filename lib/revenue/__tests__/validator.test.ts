/**
 * Validation Test for BSR-to-Revenue Calculator
 * 
 * Tests against known Helium 10 data to validate accuracy.
 */

import { estimateMonthlySalesFromBSR } from '../bsr-calculator';

interface ValidationProduct {
  asin: string;
  category: string;
  bsr: number;
  price: number;
  actualMonthlySales: number;
}

const validationProducts: ValidationProduct[] = [
  {
    asin: 'B0973DGD8P',
    category: 'Home & Kitchen',
    bsr: 2,
    price: 24.99,
    actualMonthlySales: 107588, // From H10
  },
  // Add more validation products as needed
];

/**
 * Run validation tests against known Helium 10 data
 */
export function runValidationTests(): void {
  console.log('BSR-to-Revenue Calculator Validation Tests');
  console.log('=' .repeat(60));
  
  validationProducts.forEach(product => {
    const estimated = estimateMonthlySalesFromBSR(product.bsr, product.category);
    const error = Math.abs((estimated - product.actualMonthlySales) / product.actualMonthlySales) * 100;
    
    console.log(`\nASIN: ${product.asin}`);
    console.log(`  Category: ${product.category}`);
    console.log(`  BSR: ${product.bsr}`);
    console.log(`  Estimated: ${estimated.toLocaleString()}`);
    console.log(`  Actual (H10): ${product.actualMonthlySales.toLocaleString()}`);
    console.log(`  Error: ${error.toFixed(1)}%`);
    
    // Check if error is within acceptable range (15-20%)
    if (error <= 20) {
      console.log(`  ✓ Within acceptable range`);
    } else {
      console.log(`  ✗ Outside acceptable range (>20%)`);
    }
  });
  
  console.log('\n' + '='.repeat(60));
}

// Export for use in other test files or manual execution
export { runValidationTests };
export type { ValidationProduct };

