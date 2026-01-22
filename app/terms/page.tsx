"use client";

import { motion } from "framer-motion";
import PublicNavigation from "../components/PublicNavigation";
import PublicFooter from "../components/PublicFooter";

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicNavigation />
      
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 md:py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-8">Terms of Use</h1>
          
          <div className="backdrop-blur-sm bg-card/30 border border-border/50 rounded-2xl p-8 space-y-8">
            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">1. Service Description</h2>
              <p className="text-muted-foreground leading-relaxed">
              Sellerev provides Amazon seller analytics and insights to help sellers understand market opportunities, optimize listings, and make informed business decisions. Our service analyzes publicly available Amazon listing information and, when authorized, accesses seller account data through Amazon&apos;s Selling Partner API (SP-API).
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">2. Amazon Authorization</h2>
              <p className="text-muted-foreground leading-relaxed">
                Sellerev uses Amazon&apos;s Selling Partner API (SP-API) to access authorized seller account data. All API access is read-only and requires explicit authorization from the seller. Access can be revoked at any time through your Amazon Seller Central account.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
              Sellerev does not access customer PII, does not modify listings, and does not perform actions on a seller&apos;s behalf without explicit approval.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">3. Subscription & Billing</h2>
              <p className="text-muted-foreground leading-relaxed">
              Sellerev offers subscription-based access to its analytics and insights platform. Subscription terms, pricing, and billing cycles are subject to change with advance notice. Users are responsible for keeping their payment information current and will be charged according to their selected subscription plan.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">4. User Responsibilities</h2>
              <p className="text-muted-foreground leading-relaxed">
              Users are responsible for maintaining the security of their account credentials and for all activities that occur under their account. Users must provide accurate information and comply with all applicable laws and Amazon&apos;s terms of service when using Sellerev.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">5. No Guarantees Disclaimer</h2>
              <p className="text-muted-foreground leading-relaxed">
              Sellerev provides analytics and insights based on available data and algorithms. We do not guarantee specific business outcomes, sales results, or market performance. All recommendations and insights are provided for informational purposes only and should not be considered as financial or legal advice.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">6. Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
              To the maximum extent permitted by law, Sellerev shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from your use of the service.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">7. Governing Law</h2>
              <p className="text-muted-foreground leading-relaxed">
              These Terms of Use shall be governed by and construed in accordance with the laws of Ontario, Canada, without regard to its conflict of law provisions.
            </p>
          </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">8. Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about these Terms of Use, please contact us at{" "}
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

