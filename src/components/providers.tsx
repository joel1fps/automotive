"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { PageTransitionProvider } from "./page-transition";
import { LazyMotion, MotionConfig } from "motion/react";
const ClerkConfiguredProvider = dynamic(() =>
  import("./clerk-provider").then((m) => m.ClerkConfiguredProvider),
);
const motionFeatures = () => import("./motion-features").then((m) => m.default);
export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  const pathname = usePathname();
  const content = (
    <LazyMotion features={motionFeatures}>
      <MotionConfig reducedMotion="user"><PageTransitionProvider>{children}</PageTransitionProvider></MotionConfig>
    </LazyMotion>
  );
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !/^\/acompanhar(?:\/|$)/.test(pathname) ? (
    <ClerkConfiguredProvider nonce={nonce}>{content}</ClerkConfiguredProvider>
  ) : (
    content
  );
}
