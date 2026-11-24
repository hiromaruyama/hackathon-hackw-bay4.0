import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/lib/workspace-context";
import "./globals.css";

// Serif is reserved for the outreach copy a prospect will read.
const serif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Signal",
  description: "Cited account research and approved outreach for GeoFlow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={serif.variable}>
        <TooltipProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
