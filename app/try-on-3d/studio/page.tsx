import type { Metadata } from "next";
import { TryOnStudio3D } from "@/components/try-on-3d/studio-3d";

export const metadata: Metadata = {
  title: "Try-on 3D",
  description: "Your wardrobe on a 3D mannequin built from your measurements.",
};

export default function TryOn3DPage() {
  return <TryOnStudio3D />;
}
