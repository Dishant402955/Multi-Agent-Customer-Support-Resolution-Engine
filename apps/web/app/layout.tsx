import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Multi-Agent Support Engine",
  description: "Multi-agent customer support resolution engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Light-mode only.
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
