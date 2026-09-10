import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ILD Shutdown Plan",
  description: "Theo dõi kế hoạch và tiến độ shutdown theo từng giờ.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
