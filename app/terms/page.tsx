import PublicNavigation from "../components/PublicNavigation";
import PublicFooter from "../components/PublicFooter";

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <PublicNavigation />
      
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">Terms of Use</h1>
        
        <div className="prose prose-gray max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Service Description</h2>
            <p className="text-gray-700 leading-relaxed">
              Sellerev provides Amazon seller analytics and insights to help sellers understand market opportunities, optimize listings, and make informed business decisions. Our service analyzes publicly available Amazon listing information and, when authorized, accesses seller account data through Amazon&apos;s Selling Partner API (SP-API).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Amazon Authorization</h2>
            <p className="text-gray-700 leading-relaxed">
              Sellerev uses Amazon&apos;s Selling Partner API (SP-API) to access authorized seller account data. All API access is read-only and requires explicit authorization from the seller. Access can be revoked at any time through your Amazon Seller Central account.
            </p>
            <p className="text-gray-700 leading-relaxed mt-4">
              Sellerev does not access customer PII, does not modify listings, and does not perform actions on a seller&apos;s behalf without explicit approval.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Subscription & Billing</h2>
            <p className="text-gray-700 leading-relaxed">
              Sellerev offers subscription-based access to its analytics and insights platform. Subscription terms, pricing, and billing cycles are subject to change with advance notice. Users are responsible for keeping their payment information current and will be charged according to their selected subscription plan.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. User Responsibilities</h2>
            <p className="text-gray-700 leading-relaxed">
              Users are responsible for maintaining the security of their account credentials and for all activities that occur under their account. Users must provide accurate information and comply with all applicable laws and Amazon&apos;s terms of service when using Sellerev.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. No Guarantees Disclaimer</h2>
            <p className="text-gray-700 leading-relaxed">
              Sellerev provides analytics and insights based on available data and algorithms. We do not guarantee specific business outcomes, sales results, or market performance. All recommendations and insights are provided for informational purposes only and should not be considered as financial or legal advice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Limitation of Liability</h2>
            <p className="text-gray-700 leading-relaxed">
              To the maximum extent permitted by law, Sellerev shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from your use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Governing Law</h2>
            <p className="text-gray-700 leading-relaxed">
              These Terms of Use shall be governed by and construed in accordance with the laws of Ontario, Canada, without regard to its conflict of law provisions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Contact Information</h2>
            <p className="text-gray-700 leading-relaxed">
              For questions about these Terms of Use, please contact us at{" "}
              <a href="mailto:support@sellerev.com" className="text-black underline hover:text-gray-700">
                support@sellerev.com
              </a>
              .
            </p>
          </section>

          <section className="pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

