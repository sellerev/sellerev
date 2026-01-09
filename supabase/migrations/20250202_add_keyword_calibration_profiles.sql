-- Keyword Calibration Profiles
-- Stores deterministic calibration multipliers for keyword intent archetypes and categories
-- Used to adjust canonical Page-1 revenue estimates based on keyword intent and Amazon category

CREATE TABLE IF NOT EXISTS keyword_calibration_profiles (
  keyword TEXT PRIMARY KEY,
  intent_type TEXT NOT NULL CHECK (intent_type IN ('generic', 'brand', 'accessory', 'replacement', 'appliance', 'consumable')),
  category TEXT NOT NULL,
  revenue_multiplier NUMERIC(5,3) NOT NULL DEFAULT 1.0,
  units_multiplier NUMERIC(5,3) NOT NULL DEFAULT 1.0,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')) DEFAULT 'low',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for category-based lookups
CREATE INDEX IF NOT EXISTS idx_keyword_calibration_profiles_category 
  ON keyword_calibration_profiles(category);

-- Index for intent_type lookups
CREATE INDEX IF NOT EXISTS idx_keyword_calibration_profiles_intent 
  ON keyword_calibration_profiles(intent_type);

-- Composite index for category + intent lookups
CREATE INDEX IF NOT EXISTS idx_keyword_calibration_profiles_category_intent 
  ON keyword_calibration_profiles(category, intent_type);

