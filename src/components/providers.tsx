"use client";
import dynamic from "next/dynamic";
import { PageTransitionProvider } from "./page-transition";
import { LazyMotion, MotionConfig } from "motion/react";
const ClerkConfiguredProvider = dynamic(() =>
  import("./clerk-provider").then((m) => m.ClerkConfiguredProvider),
);
const motionFeatures = () => import("./motion-features").then((m) => m.default);
export function Providers({ children }: { children: React.ReactNode }) {
  const content = (
    <LazyMotion features={motionFeatures}>
      <MotionConfig reducedMotion="user"><PageTransitionProvider>{children}</PageTransitionProvider></MotionConfig>
    </LazyMotion>
  );
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkConfiguredProvider>{content}</ClerkConfiguredProvider>
  ) : (
    content
  );
}
