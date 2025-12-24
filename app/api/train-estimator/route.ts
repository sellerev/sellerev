/**
 * Estimator Training Job
 * 
 * Task 4: Daily training job that retrains models if >= 200 new rows.
 * Keeps model extremely simple (linear/ridge) for interpretability and stability.
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Simple linear regression using least squares
 * Returns coefficients for: y = intercept + coef1*x1 + coef2*x2 + ...
 */
function trainLinearModel(
  X: number[][], // Features matrix [n_samples, n_features]
  y: number[]    // Target values [n_samples]
): {
  intercept: number;
  coefficients: number[];
  r_squared: number;
  mae: number;
} {
  const n = X.length;
  const nFeatures = X[0].length;
  
  if (n < 2) {
    throw new Error("Need at least 2 samples to train");
  }
  
  // Add intercept term (column of 1s)
  const XWithIntercept = X.map(row => [1, ...row]);
  
  // Simple least squares: (X'X)^(-1)X'y
  // For simplicity, use gradient descent approximation
  // Initialize coefficients
  let coefficients = new Array(nFeatures + 1).fill(0);
  const learningRate = 0.01;
  const iterations = 100;
  
  // Gradient descent
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      // Predict
      let prediction = 0;
      for (let j = 0; j < nFeatures + 1; j++) {
        prediction += coefficients[j] * XWithIntercept[i][j];
      }
      
      // Error
      const error = prediction - y[i];
      
      // Update coefficients
      for (let j = 0; j < nFeatures + 1; j++) {
        coefficients[j] -= learningRate * error * XWithIntercept[i][j] / n;
      }
    }
  }
  
  const intercept = coefficients[0];
  const coefs = coefficients.slice(1);
  
  // Calculate R² and MAE
  let ssRes = 0;
  let ssTot = 0;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  
  for (let i = 0; i < n; i++) {
    let prediction = intercept;
    for (let j = 0; j < nFeatures; j++) {
      prediction += coefs[j] * X[i][j];
    }
    ssRes += Math.pow(prediction - y[i], 2);
    ssTot += Math.pow(y[i] - yMean, 2);
  }
  
  const rSquared = 1 - (ssRes / ssTot);
  const mae = Math.sqrt(ssRes / n);
  
  return {
    intercept,
    coefficients: coefs,
    r_squared: rSquared,
    mae,
  };
}

/**
 * Train search volume model
 */
async function trainSearchVolumeModel(
  supabase: any,
  marketplace: string,
  observations: any[]
): Promise<void> {
  // Prepare features and targets
  // Features: page1_count, log(avg_reviews), sponsored_pct, avg_price
  // Target: estimated search volume (use midpoint of range if available)
  const X: number[][] = [];
  const y: number[] = [];
  
  for (const obs of observations) {
    const inputs = obs.estimator_inputs_json;
    const outputs = obs.estimator_outputs_json;
    
    if (!inputs || !outputs || !outputs.search_volume) {
      continue;
    }
    
    const page1Count = inputs.page1_count || 0;
    const avgReviews = inputs.avg_reviews || 0;
    const avgReviewsLog = avgReviews > 0 ? Math.log(avgReviews + 1) : 0;
    const sponsoredPct = inputs.page1_count > 0 && obs.summary_json.sponsored_pct
      ? obs.summary_json.sponsored_pct
      : 0;
    const avgPrice = inputs.avg_price || 0;
    
    // Target: midpoint of search volume range
    const target = (outputs.search_volume.min + outputs.search_volume.max) / 2;
    
    X.push([page1Count, avgReviewsLog, sponsoredPct, avgPrice]);
    y.push(target);
  }
  
  if (X.length < 200) {
    console.log("INSUFFICIENT_TRAINING_DATA", {
      marketplace,
      model_type: "search_volume",
      samples: X.length,
      required: 200,
    });
    return;
  }
  
  // Train model
  const model = trainLinearModel(X, y);
  
  // Create model version
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const modelVersion = `v2.0.${today}`;
  
  // Save model
  await supabase
    .from("estimator_models")
    .update({ is_active: false })
    .eq("marketplace", marketplace)
    .eq("model_type", "search_volume")
    .eq("is_active", true);
  
  await supabase
    .from("estimator_models")
    .insert({
      marketplace,
      model_version: modelVersion,
      model_type: "search_volume",
      coefficients_json: {
        intercept: model.intercept,
        page1_count_coef: model.coefficients[0],
        avg_reviews_log_coef: model.coefficients[1],
        sponsored_pct_coef: model.coefficients[2],
        avg_price_coef: model.coefficients[3],
      },
      trained_at: new Date().toISOString(),
      training_rows: X.length,
      training_metadata: {
        r_squared: model.r_squared,
        mae: model.mae,
      },
      is_active: true,
    });
  
  console.log("SEARCH_VOLUME_MODEL_TRAINED", {
    marketplace,
    model_version: modelVersion,
    training_rows: X.length,
    r_squared: model.r_squared,
    mae: model.mae,
  });
}

/**
 * Train revenue estimate model
 */
async function trainRevenueModel(
  supabase: any,
  marketplace: string,
  observations: any[]
): Promise<void> {
  // Prepare features and targets
  const X: number[][] = [];
  const y: number[] = [];
  
  for (const obs of observations) {
    const inputs = obs.estimator_inputs_json;
    const outputs = obs.estimator_outputs_json;
    
    if (!inputs || !outputs || !outputs.revenue_estimates) {
      continue;
    }
    
    const page1Count = inputs.page1_count || 0;
    const avgReviews = inputs.avg_reviews || 0;
    const avgReviewsLog = avgReviews > 0 ? Math.log(avgReviews + 1) : 0;
    const sponsoredPct = obs.summary_json.sponsored_pct || 0;
    const avgPrice = inputs.avg_price || 0;
    
    // Target: midpoint of revenue range
    const target = (outputs.revenue_estimates.total_revenue_min + outputs.revenue_estimates.total_revenue_max) / 2;
    
    X.push([page1Count, avgReviewsLog, sponsoredPct, avgPrice]);
    y.push(target);
  }
  
  if (X.length < 200) {
    console.log("INSUFFICIENT_TRAINING_DATA", {
      marketplace,
      model_type: "revenue_estimate",
      samples: X.length,
      required: 200,
    });
    return;
  }
  
  // Train model
  const model = trainLinearModel(X, y);
  
  // Create model version
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const modelVersion = `v2.0.${today}`;
  
  // Save model
  await supabase
    .from("estimator_models")
    .update({ is_active: false })
    .eq("marketplace", marketplace)
    .eq("model_type", "revenue_estimate")
    .eq("is_active", true);
  
  await supabase
    .from("estimator_models")
    .insert({
      marketplace,
      model_version: modelVersion,
      model_type: "revenue_estimate",
      coefficients_json: {
        intercept: model.intercept,
        page1_count_coef: model.coefficients[0],
        avg_reviews_log_coef: model.coefficients[1],
        sponsored_pct_coef: model.coefficients[2],
        avg_price_coef: model.coefficients[3],
      },
      trained_at: new Date().toISOString(),
      training_rows: X.length,
      training_metadata: {
        r_squared: model.r_squared,
        mae: model.mae,
      },
      is_active: true,
    });
  
  console.log("REVENUE_MODEL_TRAINED", {
    marketplace,
    model_version: modelVersion,
    training_rows: X.length,
    r_squared: model.r_squared,
    mae: model.mae,
  });
}

export async function POST(req: NextRequest) {
  const res = new NextResponse();
  const supabase = createApiClient(req, res);
  
  try {
    // Authenticate (require service role or admin)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }
    
    // Task 4: Check if >= 200 new rows since last training
    const marketplace = "US"; // TODO: Support multiple marketplaces
    
    // Get last training date
    const { data: lastModel } = await supabase
      .from("estimator_models")
      .select("trained_at")
      .eq("marketplace", marketplace)
      .eq("is_active", true)
      .limit(1)
      .single();
    
    const lastTrainingDate = lastModel?.trained_at 
      ? new Date(lastModel.trained_at)
      : new Date(0);
    
    // Count new observations since last training
    const { data: newObservations, error: obsError } = await supabase
      .from("market_observations")
      .select("*")
      .eq("marketplace", marketplace)
      .gte("created_at", lastTrainingDate.toISOString())
      .order("created_at", { ascending: false });
    
    if (obsError) {
      console.error("Failed to fetch observations:", obsError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch observations" },
        { status: 500, headers: res.headers }
      );
    }
    
    const newRowCount = newObservations?.length || 0;
    
    if (newRowCount < 200) {
      return NextResponse.json({
        success: true,
        message: "Insufficient new data for training",
        new_rows: newRowCount,
        required: 200,
      });
    }
    
    // Get all observations for training (use last 1000 for stability)
    const { data: allObservations, error: allObsError } = await supabase
      .from("market_observations")
      .select("*")
      .eq("marketplace", marketplace)
      .order("created_at", { ascending: false })
      .limit(1000);
    
    if (allObsError || !allObservations || allObservations.length < 200) {
      return NextResponse.json({
        success: false,
        error: "Failed to fetch training data",
        details: allObsError?.message,
      });
    }
    
    // Train both models
    await trainSearchVolumeModel(supabase, marketplace, allObservations);
    await trainRevenueModel(supabase, marketplace, allObservations);
    
    return NextResponse.json({
      success: true,
      message: "Models trained successfully",
      training_rows: allObservations.length,
      new_rows_since_last_training: newRowCount,
    });
    
  } catch (error) {
    console.error("Training job error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Training job failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: res.headers }
    );
  }
}
