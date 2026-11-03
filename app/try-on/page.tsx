import type { Metadata } from "next";
import { TryOnStudio } from "@/components/try-on/try-on-studio";

export const metadata: Metadata = {
  title: "Try-on",
  description: "Your wardrobe, drawn on an avatar built from your measurements.",
};

export default function TryOnPage() {
  return <TryOnStudio />;
}
