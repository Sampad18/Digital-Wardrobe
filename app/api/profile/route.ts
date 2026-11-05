import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { parseProfile } from "@/components/try-on/profile";

/** The owner's try-on profile, kept as a JSON file in the project (git-ignored: it holds body measurements). */
const FILE = path.join(process.cwd(), "data", "profile.json");

export async function GET() {
  await connection();
  try {
    const profile = parseProfile(JSON.parse(await readFile(FILE, "utf8")));
    if (!profile) return Response.json({ error: "Saved profile is unreadable" }, { status: 500 });
    return Response.json(profile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "No saved profile yet" }, { status: 404 });
    return Response.json({ error: "Couldn't read the saved profile" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const profile = parseProfile(await request.json().catch(() => null));
  if (!profile) return Response.json({ error: "Profile is missing fields or has out-of-range values" }, { status: 400 });
  // The 2D studio doesn't know about the 3D appearance; keep the saved one rather than dropping it.
  if (!profile.appearance) {
    const previous = parseProfile(JSON.parse(await readFile(FILE, "utf8").catch(() => "null")));
    if (previous?.appearance) profile.appearance = previous.appearance;
  }
  const saved = { ...profile, updatedAt: new Date().toISOString() };
  await mkdir(path.dirname(FILE), { recursive: true });
  // Write then rename, so a crash mid-write never leaves a half-written file behind.
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(saved, null, 2));
  await rename(tmp, FILE);
  return Response.json(saved);
}
