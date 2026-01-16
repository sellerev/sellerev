import Link from "next/link";
import PublicNavigation from "./components/PublicNavigation";
import PublicFooter from "./components/PublicFooter";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <PublicNavigation />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-6 py-20 text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Actionable Amazon Insights for Every Seller
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Sellerev gives new and experienced Amazon sellers clear market signals, product opportunity guidance, and AI-driven recommendations to improve listings, understand fees, and make smarter decisions.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-4">
            <Link
              href="/auth"
              className="bg-black text-white px-8 py-3 rounded-lg text-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Start Free
            </Link>
          </div>
          <p className="text-sm text-gray-500">No credit card required</p>
        </section>

        {/* How It Works */}
        <section className="max-w-7xl mx-auto px-6 py-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="text-center">
              <div className="bg-black text-white w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Enter a keyword or ASIN
              </h3>
              <p className="text-gray-600">
                Start your analysis by entering a product keyword or Amazon ASIN you want to explore.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-black text-white w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Sellerev analyzes market signals & listing content
              </h3>
              <p className="text-gray-600">
                Our system evaluates competition, pricing, demand indicators, and listing quality.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-black text-white w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Get clear, AI-driven recommendations
              </h3>
              <p className="text-gray-600">
                Receive actionable insights and recommendations tailored to your business goals.
              </p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-7xl mx-auto px-6 py-16">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            What Sellerev Provides
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div className="p-6 border border-gray-200 rounded-lg">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Product Opportunity Analysis
              </h3>
              <p className="text-gray-600">
                Evaluate market demand, competition levels, and revenue potential for product opportunities.
              </p>
            </div>
            <div className="p-6 border border-gray-200 rounded-lg">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Listing Analysis
              </h3>
              <p className="text-gray-600">
                Get insights on listing quality, keyword optimization, and competitive positioning.
              </p>
            </div>
            <div className="p-6 border border-gray-200 rounded-lg">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                FBA Fee Understanding
              </h3>
              <p className="text-gray-600">
                Calculate and understand Amazon FBA fees to make informed pricing decisions.
              </p>
            </div>
            <div className="p-6 border border-gray-200 rounded-lg">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Inventory Signals
              </h3>
              <p className="text-gray-600">
                Access inventory insights and recommendations for connected seller accounts.
              </p>
            </div>
            <div className="p-6 border border-gray-200 rounded-lg">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                AI-Generated Action Plans
              </h3>
              <p className="text-gray-600">
                Receive personalized, AI-driven recommendations to improve your Amazon business strategy.
              </p>
            </div>
          </div>
        </section>

        {/* Compliance Notice */}
        <section className="max-w-4xl mx-auto px-6 py-12 bg-gray-50">
          <div className="border-l-4 border-black pl-6">
            <p className="text-gray-700 leading-relaxed">
              Sellerev uses publicly visible Amazon listing information and seller-authorized account data when connected. We do not access buyer personal data, competitor sales data, or restricted Amazon datasets.
            </p>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
