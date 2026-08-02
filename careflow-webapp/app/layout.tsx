import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

const title = "CareFlow — ระบบจัดการคลินิกชุมชน";
const description =
  "ต้นแบบระบบคลินิกชนบทที่เรียบง่าย เชื่อถือได้ และออกแบบเพื่อการดูแลที่ต่อเนื่อง";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const directHost = requestHeaders.get("host")?.trim();
  const requestedHost = forwardedHost || directHost || "localhost:3001";
  const sanitizedHost = requestedHost.replace(
    /[^a-zA-Z0-9.:[\]-]/g,
    "",
  );
  const host = sanitizedHost || "localhost:3001";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      type: "website",
      locale: "th_TH",
      siteName: "CareFlow",
      title,
      description,
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "CareFlow ระบบจัดการคลินิกชุมชน",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

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
