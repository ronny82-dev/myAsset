import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import BottomNavWrapper from "@/components/BottomNavWrapper";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "커플 가계부",
  description: "따로 또 같이, 우리 집 경제의 모든 것",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50">
        <Providers>
          <div className="flex-1 pb-16">
            {children}
          </div>
          <BottomNavWrapper />
        </Providers>
      </body>
    </html>
  );
}
