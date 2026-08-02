import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

const title = "CareFlow — ระบบจัดการคลินิกชุมชน";
const description =
  "ต้นแบบระบบคลินิกชนบทที่เรียบง่าย เชื่อถือได้ และออกแบบเพื่อการดูแลที่ต่อเนื่อง";

function canonicalMetadataBase(): URL | null {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configuredUrl) return null;
  try {
    const configured = new URL(configuredUrl);
    if ((configured.protocol !== "http:" && configured.protocol !== "https:") || configured.username || configured.password) {
      return null;
    }
    return new URL(configured.origin);
  } catch {
    return null;
  }
}

function metadataBaseFromHost(host: string | null | undefined, forwardedProtocol: string | null | undefined): URL | null {
  if (!host) return null;
  const candidateHost = host.split(",")[0]?.trim();
  if (!candidateHost || /[\s/@\\]/.test(candidateHost)) return null;
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : candidateHost.startsWith("localhost") || candidateHost.startsWith("127.0.0.1")
      ? "http"
      : "https";
  try {
    const base = new URL(`${protocol}://${candidateHost}`);
    return base.hostname ? base : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const directHost = requestHeaders.get("host")?.trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const metadataBase = canonicalMetadataBase()
    ?? metadataBaseFromHost(forwardedHost, forwardedProtocol)
    ?? metadataBaseFromHost(directHost, forwardedProtocol)
    ?? new URL("http://localhost:3001");
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
