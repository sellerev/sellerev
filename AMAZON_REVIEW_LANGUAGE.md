# Amazon Developer Profile / Roles Justification

## Application Overview

**Sellerev** is a market analysis and feasibility tool designed specifically for Amazon sellers. Our application helps sellers evaluate product opportunities by analyzing keyword markets, estimating demand, calculating margins, and providing AI-powered insights.

## What Sellerev Does

Sellerev provides sellers with:

1. **Keyword Market Analysis**: Analyze Amazon search results for specific keywords to understand market dynamics, competition, and opportunity
2. **Revenue Estimation**: Estimate monthly revenue potential for products based on market data
3. **Margin Calculations**: Calculate net margins by combining cost assumptions with Amazon fee estimates
4. **Feasibility Analysis**: Evaluate whether a product opportunity meets seller-specific financial constraints and goals
5. **AI-Powered Insights**: Get personalized recommendations based on seller profile, experience, and preferences

## Data Access (Seller's Own Account Only)

Sellerev accesses the following data from the seller's own Amazon account via SP-API:

### Pricing API (`/pricing/v0/items/{asin}/offers`)
- **Buy Box Owner**: Whether Amazon or a merchant owns the buy box
- **Offer Count**: Number of offers for a product
- **Fulfillment Channel**: Whether listings are FBA or FBM
- **Lowest Price**: Lowest price available
- **Buy Box Price**: Current buy box price

**Purpose**: Enrich market analysis with accurate pricing data to help sellers understand competitive positioning.

### Fees API (`/products/fees/v0/items/{asin}/feesEstimate`)
- **FBA Fulfillment Fee**: Amazon's fulfillment fee for the product
- **Referral Fee**: Amazon's referral fee percentage/amount
- **Total Fees**: Combined Amazon fees

**Purpose**: Provide accurate fee calculations for margin analysis. This enables sellers to make informed decisions about product profitability.

## What We Do NOT Access

Sellerev explicitly does NOT access:

- **Buyer Data**: No customer information, purchase history, or personal data
- **Competitor Private Data**: No access to other sellers' private sales data, inventory levels, or account information
- **Order Management**: No ability to create, modify, or cancel orders
- **Inventory Management**: No ability to modify inventory levels or listings
- **Financial Data**: No access to payment information, bank accounts, or tax data
- **Account Settings**: No ability to modify seller account settings or preferences

## Data Usage

All data accessed through SP-API is used exclusively for:

1. **Display to the seller**: Show pricing and fee information in the seller's dashboard
2. **Analysis calculations**: Compute margins, feasibility, and opportunity metrics
3. **Caching**: Store fee data temporarily (30 days) to reduce API calls and improve performance

Data is never:
- Sold to third parties
- Shared with other sellers
- Used for competitive intelligence
- Stored beyond the caching period (30 days for fees, real-time for pricing)

## Security & Privacy

### Encryption
- **At Rest**: All refresh tokens are encrypted using AES-256-GCM encryption before storage in our database
- **In Transit**: All API communications use HTTPS/TLS 1.2+

### Token Handling
- Refresh tokens are stored encrypted in our database
- Only the last 4 characters of tokens are displayed in the UI for identification
- Tokens can be revoked by the seller at any time
- Tokens are automatically invalidated if the seller disconnects their account

### Access Control
- Each seller can only access their own data
- Row-level security (RLS) policies ensure data isolation
- Service role credentials are never exposed to client-side code

## Least Privilege Roles for v1

For the initial version, Sellerev requests the following SP-API scope:

- **`sellingpartnerapi::api`**: Standard scope for seller authorization

This scope provides access to:
- Pricing API (read-only)
- Fees API (read-only)
- Catalog API (read-only, for product dimensions when needed for fee calculations)

We do NOT request:
- Notifications API (not needed for v1)
- Orders API (not needed - we don't manage orders)
- Inventory API (not needed - we don't manage inventory)
- Reports API (not needed for v1)

## Token Revocation

Sellers can revoke access at any time through:
1. The Sellerev settings page ("Disconnect" button)
2. Amazon Seller Central (if they prefer)

When access is revoked:
- The refresh token is immediately invalidated
- Connection status is marked as "revoked" in our database
- No further API calls are made using that token
- Historical cached data remains available but no new data is fetched

## Compliance

- **GDPR**: We comply with GDPR requirements for data processing and user rights
- **CCPA**: We comply with CCPA requirements for California residents
- **Amazon Policies**: We strictly adhere to Amazon's SP-API usage policies and terms of service

## Contact

For questions about our use of SP-API or data handling practices, please contact:
- Email: [Your support email]
- Website: [Your website]

---

**Last Updated**: January 2025

