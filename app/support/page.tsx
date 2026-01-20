"use client";

import { useState } from "react";
import PublicNavigation from "../components/PublicNavigation";
import PublicFooter from "../components/PublicFooter";

export default function SupportPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus("idle");
    setErrorMessage("");

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to send message");
      }

      setSubmitStatus("success");
      setFormData({ name: "", email: "", subject: "", message: "" });
    } catch (error) {
      setSubmitStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to send message. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <PublicNavigation />
      
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">Support</h1>
        
        <div className="space-y-8">
          <section>
            <p className="text-gray-700 leading-relaxed mb-6">
              We&apos;re here to help! Get in touch with our support team for assistance with your account, questions about features, or technical support.
            </p>
            
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Support Hours</h2>
              <p className="text-gray-700">Monday - Friday: 9:00 AM - 5:00 PM EST</p>
              <p className="text-gray-700 mt-2">
                Email: support@sellerev.com
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Contact Form</h2>
            {submitStatus === "success" && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800">
                  Thanks for reaching out! We&apos;ll respond within 24 hours.
                </p>
              </div>
            )}
            {submitStatus === "error" && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800">{errorMessage}</p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  disabled={isSubmitting}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-black disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  disabled={isSubmitting}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-black disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                  Subject (Optional)
                </label>
                <input
                  type="text"
                  id="subject"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  disabled={isSubmitting}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-black disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={6}
                  value={formData.message}
                  onChange={handleChange}
                  disabled={isSubmitting}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-black disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-black text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Sending..." : "Send Message"}
              </button>
            </form>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

