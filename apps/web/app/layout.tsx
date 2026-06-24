import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multi-Agent Support Engine",
  description: "Multi-agent customer support resolution engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `dark` is hard-set — this app is dark-mode only.
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <body>{children}</body>
    </html>
  );
}
