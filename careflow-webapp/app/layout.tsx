import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "CareFlow — ระบบจัดการคลินิกชุมชน",
  description:
    "ต้นแบบระบบคลินิกชนบทที่เรียบง่าย เชื่อถือได้ และออกแบบเพื่อการดูแลที่ต่อเนื่อง",
};

export const viewport: Viewport = {
  themeColor: "#003629",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
