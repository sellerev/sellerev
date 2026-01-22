"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import PublicNavigation from "./components/PublicNavigation";
import PublicFooter from "./components/PublicFooter";
import TypewriterText from "./components/TypewriterText";

export default function HomePage() {
  const scrollToPricing = () => {
    const pricingSection = document.getElementById("pricing");
    pricingSection?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicNavigation />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-6 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-6">
              Designed for thinking.
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto leading-relaxed">
              Sellerev is a generative AI platform that helps Amazon sellers understand markets, ask better questions, and make confident decisions
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6">
              <Link
                href="/auth"
                className="bg-gradient-to-r from-primary to-primary-glow text-primary-foreground px-8 py-4 rounded-lg text-lg font-medium hover:opacity-90 transition-opacity"
              >
                Analyze a Market
              </Link>
              <button
                onClick={scrollToPricing}
                className="text-foreground px-8 py-4 rounded-lg text-lg font-medium hover:text-primary transition-colors"
              >
                View Pricing
              </button>
            </div>
            
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mb-6"
            >
              <TypewriterText />
            </motion.div>
          </motion.div>
        </section>

        {/* Value Proposition Section */}
        <section className="max-w-7xl mx-auto px-6 pt-12 pb-20 md:pt-16 md:pb-32">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
              Think clearly before you build.
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Most tools show you data.
              <br />
              Sellerev helps you understand what it actually means.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="glass-panel p-8"
            >
              <h3 className="text-xl font-semibold text-foreground mb-4">
                Understand Market Structure
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                See how brands, reviews, pricing, and ads interact — not just surface metrics.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="glass-panel p-8"
            >
              <h3 className="text-xl font-semibold text-foreground mb-4">
                Ask the Right Questions
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Sellerev answers the questions real sellers ask when deciding whether a market is worth entering.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="glass-panel p-8"
            >
              <h3 className="text-xl font-semibold text-foreground mb-4">
                Decide With Confidence
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Know when to move forward, when to walk away, and why — without guessing.
              </p>
            </motion.div>
          </div>
        </section>

        {/* How Sellerev Thinks Section */}
        <section className="max-w-7xl mx-auto px-6 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-12">
              How Sellerev reasons about markets
            </h2>
          </motion.div>

          <div className="max-w-4xl mx-auto space-y-8">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="glass-panel p-8"
            >
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-primary-glow flex items-center justify-center text-primary-foreground font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    Ingests the full Page 1 landscape
                  </h3>
                  <p className="text-muted-foreground">
                    Organic listings, sponsored placements, brands, reviews, and pricing.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="glass-panel p-8"
            >
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-primary-glow flex items-center justify-center text-primary-foreground font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    Interprets structure, not just numbers
                  </h3>
                  <p className="text-muted-foreground">
                    Identifies dominance, fragmentation, and competitive pressure.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="glass-panel p-8"
            >
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-primary-glow flex items-center justify-center text-primary-foreground font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    Explains outcomes in plain language
                  </h3>
                  <p className="text-muted-foreground">
                    Clear reasoning instead of overwhelming dashboards.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Why It's Different Section */}
        <section className="max-w-7xl mx-auto px-6 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-12">
              Built for reasoning, not reporting.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="glass-panel p-8 border-border/30"
            >
              <h3 className="text-xl font-semibold text-muted-foreground mb-6">
                Traditional Tools
              </h3>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground/50 mt-1">•</span>
                  <span>Raw metrics</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground/50 mt-1">•</span>
                  <span>Static dashboards</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground/50 mt-1">•</span>
                  <span>Manual interpretation</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground/50 mt-1">•</span>
                  <span>Easy to misread</span>
                </li>
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="glass-panel p-8 border-2 border-primary/50 bg-primary/5"
            >
              <h3 className="text-xl font-semibold text-foreground mb-6">
                Sellerev
              </h3>
              <ul className="space-y-3 text-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Question-driven</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Reasoning-first</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Structured explanations</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Built for decisions</span>
                </li>
              </ul>
            </motion.div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="max-w-7xl mx-auto px-6 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
              Sellerev Pricing
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Choose the plan that fits your journey. Start free, scale as you grow.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {/* Free Trial */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="glass-panel p-8 flex flex-col"
            >
              <h3 className="text-2xl font-bold text-foreground mb-2">FREE TRIAL</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">$0</span>
                <span className="text-muted-foreground ml-2">— 7-day free trial</span>
              </div>
              <ul className="space-y-3 text-sm text-muted-foreground mb-8 flex-1">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Guided market exploration</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Page-1 market overview</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Brand count & sponsored density</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Review and price distributions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Basic market snapshots</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Limited searches during trial</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>No Amazon account connection required</span>
                </li>
              </ul>
              <Link
                href="/auth"
                className="w-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground px-6 py-3 rounded-lg font-medium text-center hover:opacity-90 transition-opacity"
              >
                Start Free Trial
              </Link>
            </motion.div>

            {/* Starter */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="glass-panel p-8 flex flex-col"
            >
              <h3 className="text-2xl font-bold text-foreground mb-2">STARTER</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">$9.99</span>
                <span className="text-muted-foreground ml-2">/ month</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Everything in Free, plus:</p>
              <ul className="space-y-3 text-sm text-muted-foreground mb-8 flex-1">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Full Page-1 market snapshots</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Revenue & unit estimates (modeled)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Competitive pressure indicators</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Navigator access</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>ASIN comparisons</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Monthly usage limits</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Rolling analysis history</span>
                </li>
              </ul>
              <Link
                href="/auth"
                className="w-full border border-border text-foreground px-6 py-3 rounded-lg font-medium text-center hover:bg-card/50 transition-colors"
              >
                Get Started
              </Link>
            </motion.div>

            {/* Professional */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="glass-panel p-8 flex flex-col border-2 border-primary/50 bg-primary/5 relative"
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-medium">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">PROFESSIONAL</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">$24.99</span>
                <span className="text-muted-foreground ml-2">/ month</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Everything in Starter, plus:</p>
              <ul className="space-y-3 text-sm text-muted-foreground mb-8 flex-1">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Unlimited market searches</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Unlimited comparisons</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Differentiation guidance</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Page-1 gap analysis</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>FBA vs FBM fee insights</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Price compression context</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Saved seller profile & constraints</span>
                </li>
              </ul>
              <Link
                href="/auth"
                className="w-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground px-6 py-3 rounded-lg font-medium text-center hover:opacity-90 transition-opacity"
              >
                Go Professional
              </Link>
            </motion.div>

            {/* Business */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="glass-panel p-8 flex flex-col"
            >
              <h3 className="text-2xl font-bold text-foreground mb-2">BUSINESS</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">$49.99</span>
                <span className="text-muted-foreground ml-2">/ month</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Everything in Professional, plus:</p>
              <ul className="space-y-3 text-sm text-muted-foreground mb-8 flex-1">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Unlimited everything</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Advanced market structure analysis</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Brand dominance breakdowns</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Priority feature access</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Amazon OAuth connection (coming soon)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Seller account-level insights (coming soon)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Faster processing & priority support</span>
                </li>
              </ul>
              <Link
                href="/auth"
                className="w-full border border-border text-foreground px-6 py-3 rounded-lg font-medium text-center hover:bg-card/50 transition-colors"
              >
                Get Started
              </Link>
            </motion.div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="max-w-7xl mx-auto px-6 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
              Stop guessing. Start thinking clearly.
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              Sellerev helps you understand markets before you risk time or capital.
            </p>
            <Link
              href="/auth"
              className="inline-block bg-gradient-to-r from-primary to-primary-glow text-primary-foreground px-8 py-4 rounded-lg text-lg font-medium hover:opacity-90 transition-opacity"
            >
              Analyze Your First Market
            </Link>
          </motion.div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
