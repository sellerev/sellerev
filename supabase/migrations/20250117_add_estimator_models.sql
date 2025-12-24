-- Estimator Models Table
-- Stores trained model coefficients for self-improving estimators

CREATE TABLE IF NOT EXISTS estimator_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  marketplace TEXT NOT NULL,
  model_version TEXT NOT NULL, -- e.g., "v2.0.20250117"
  model_type TEXT NOT NULL, -- "search_volume" | "revenue_estimate"
  coefficients_json JSONB NOT NULL, -- Learned coefficients
  trained_at TIMESTAMPTZ NOT NULL,
  training_rows INT NOT NULL, -- Number of observations used for training
  training_metadata JSONB, -- R², MAE, feature importance, etc
  is_active BOOLEAN DEFAULT true, -- Only one active model per marketplace+type
  UNIQUE(marketplace, model_type, is_active) WHERE is_active = true
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_estimator_models_marketplace_type 
  ON estimator_models(marketplace, model_type, is_active);
CREATE INDEX IF NOT EXISTS idx_estimator_models_version 
  ON estimator_models(model_version);

-- Enable RLS
ALTER TABLE estimator_models ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can read/write
CREATE POLICY "Allow service read"
  ON estimator_models
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service write"
  ON estimator_models
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update"
  ON estimator_models
  FOR UPDATE
  USING (true);
