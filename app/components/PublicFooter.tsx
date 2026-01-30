import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="border-t border-border/50 bg-background mt-auto">
      <div className="w-full max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col gap-6">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground/90">Contact</p>
            <p>Email: <a href="mailto:support@sellerev.com" className="text-primary hover:text-primary-glow transition-colors underline">support@sellerev.com</a></p>
            <p>Support Hours: Monday – Friday, 9:00 AM – 5:00 PM EST</p>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Sellerev is a market intelligence and analytics platform built for Amazon sellers evaluating product opportunities.
          </p>
          <div className="flex flex-wrap gap-6 text-sm">
            <Link
              href="/terms"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/support"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Support
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

