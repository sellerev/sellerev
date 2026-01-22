"use client";

import { motion } from "framer-motion";
import PublicNavigation from "../components/PublicNavigation";
import PublicFooter from "../components/PublicFooter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicNavigation />
      
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 md:py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-8">Privacy Policy</h1>
          
          <div className="backdrop-blur-sm bg-card/30 border border-border/50 rounded-2xl p-8 space-y-8">
            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Sellerev collects the following types of information:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Email address and account information when you create an account</li>
              <li>Seller profile information you provide during onboarding</li>
              <li>Amazon account connection tokens (encrypted) when you authorize access to your Amazon Seller Central account</li>
              <li>Usage data and analytics related to your use of the service</li>
            </ul>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Amazon Data Access</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                When you authorize Sellerev to access your Amazon Seller Central account through the Selling Partner API (SP-API), we access the following non-PII data:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Product listings and catalog information</li>
              <li>Inventory levels and status</li>
              <li>Pricing and fee information</li>
              <li>Account performance metrics (aggregated, non-personal)</li>
              <li>Fulfillment information (FBA vs FBM)</li>
            </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Sellerev follows Amazon&apos;s Selling Partner API Data Protection Policy and does not access restricted or buyer personal information.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Data We Do NOT Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Sellerev does not access, collect, or store the following types of data:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Buyer names, addresses, or contact information</li>
              <li>Payment information or credit card details</li>
              <li>Order-specific buyer personal information (PII)</li>
              <li>Customer reviews or ratings tied to individual buyers</li>
              <li>Competitor sales data or proprietary Amazon datasets</li>
              <li>Restricted information as defined by Amazon SP-API policies</li>
            </ul>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                We implement industry-standard security measures to protect your data:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-4">
              <li>Encryption in transit (HTTPS/TLS) for all data transmission</li>
              <li>Encryption at rest for stored data</li>
              <li>Token-based authentication for Amazon API access</li>
              <li>Regular security audits and updates</li>
            </ul>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Amazon API Access & Revocation</h2>
              <p className="text-muted-foreground leading-relaxed">
              Your authorization to access Amazon Seller Central data is managed through Amazon&apos;s OAuth flow. You can revoke access at any time through your Amazon Seller Central account settings. Upon revocation, Sellerev will immediately stop accessing your Amazon data and will delete stored authorization tokens.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Third-Party Services</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Sellerev uses the following third-party services:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>
                  <strong className="text-foreground">Supabase:</strong> Authentication and database hosting. Supabase&apos;s privacy policy applies to data stored on their platform.
                </li>
                <li>
                  <strong className="text-foreground">OpenAI:</strong> AI-powered analysis and recommendations. Data sent to OpenAI is processed according to their privacy policy and API terms.
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We do not sell your personal information to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                You have the right to:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-4">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your account and associated data</li>
              <li>Revoke Amazon API access at any time</li>
              <li>Export your data in a portable format</li>
            </ul>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about this Privacy Policy or to exercise your rights, please contact us at{" "}
                <a href="mailto:support@sellerev.com" className="text-primary hover:text-primary-glow underline transition-colors">
                  support@sellerev.com
                </a>
                .
              </p>
            </section>

            <section className="pt-8 border-t border-border/50">
              <p className="text-sm text-muted-foreground">
                Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </section>
          </div>
        </motion.div>
      </main>

      <PublicFooter />
    </div>
  );
}

