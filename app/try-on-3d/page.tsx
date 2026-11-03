import type { Metadata } from "next";
import { TryOnLanding } from "@/components/try-on-3d/landing";

export const metadata: Metadata = {
  title: "3D try-on",
  description: "Open your wardrobe and try every piece on a 3D mannequin built to your measurements.",
};

export default function TryOn3DLandingPage() {
  return <TryOnLanding />;
}
