import { NextResponse } from "next/server";
import { createFlowCharacter, listFlowCharacters } from "@/lib/db/repos/flowCharactersRepo.js";
import { listFlowCharacterImages } from "@/lib/db/repos/flowImagesRepo.js";

export const dynamic = "force-dynamic";

/** Characters with their current angle images attached. */
export async function GET() {
  const [characters, images] = await Promise.all([listFlowCharacters(), listFlowCharacterImages()]);
  const byCharacter = new Map();
  for (const image of images) {
    if (!byCharacter.has(image.characterId)) byCharacter.set(image.characterId, []);
    byCharacter.get(image.characterId).push(image);
  }
  return NextResponse.json({
    characters: characters.map((character) => ({ ...character, images: byCharacter.get(character.id) || [] })),
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const character = await createFlowCharacter(body);
    return NextResponse.json({ ...character, images: [] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 400 });
  }
}
