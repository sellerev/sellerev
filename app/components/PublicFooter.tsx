import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto">
      <div className="w-full max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <Link
              href="/terms"
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/support"
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              Support
            </Link>
          </div>
          <p className="text-xs text-gray-500">
            Sellerev is an independent tool and is not affiliated with or endorsed by Amazon.com, Inc.
          </p>
        </div>
      </div>
    </footer>
  );
}

